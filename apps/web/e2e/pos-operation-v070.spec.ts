import { test, expect, type Page } from '@playwright/test';
import { invoke, snapshot, demoKey } from './helpers';
async function cashier(page: Page) {
  await page.context().request.post('/api/auth/login', { form: { role: 'pos', identifier: 'cafeteria@demo.pikas.do', password: 'pikas-demo' } });
  await page.goto('/pos'); await expect(page.getByLabel('Estado de caja').filter({ visible: true })).toContainText('Online');
}
async function admin(page: Page) {
  await page.context().request.post('/api/auth/admin-login', { form: { identifier: 'admin.cafeteria@demo.pikas.do', password: 'pikas-demo' } });
  await page.goto('/admin/cafeteria/menus'); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
async function open(page: Page, cash = '0') {
  await page.goto('/pos/caja'); await page.getByLabel('Fondo inicial (RD$)').fill(cash);
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Confirmar apertura' }).click();
  await expect(page.getByRole('heading', { name: 'Cerrar caja' })).toBeVisible();
  await page.goto('/pos');
}
const sale = (page: Page, id = 'menu-pasta', key = 'sale') => invoke(page, 'checkoutPos', [null, [{ itemId: id, quantity: 1 }], key, 'cash', 20000, true]);
async function change(page: Page, mutate: (state: any) => void) {
  const state = await snapshot(page); mutate(state);
  await page.evaluate(({ state, demoKey }) => localStorage.setItem(demoKey, JSON.stringify(state)), { state, demoKey });
  // Same-window fixtures explicitly dispatch the notification normally delivered to another tab.
  await page.evaluate(key => window.dispatchEvent(new StorageEvent('storage', { key })), demoKey);
}
async function configure(page: Page) {
  await admin(page);
  const scope = { organizationId: 'cafeteria-demo', locationId: 'principal' };
  for (const [id, name, ids] of [['breakfast', 'Desayuno', ['menu-pasta']], ['lunch', 'Almuerzo', ['menu-sandwich']]] as const)
    expect((await invoke(page, 'adminSaveCafeteriaMenu', [{ ...scope, id, name, active: true }, ids])).ok).toBe(true);
  for (const [id, menuId, startTime, endTime] of [['morning', 'breakfast', '07:00', '11:00'], ['midday', 'lunch', '11:00', '14:00']])
    expect((await invoke(page, 'adminSaveServiceShift', [{ ...scope, id, name: id === 'morning' ? 'Mañana' : 'Mediodía', menuId, startTime, endTime, weekdays: [1], enabled: true }])).ok).toBe(true);
  expect((await invoke(page, 'adminSetServiceScheduling', [true, false])).ok).toBe(true);
}
test('explicit drawer gate, authorization and inactive/other-cashier states', async ({ page }) => {
  test.setTimeout(60000); await cashier(page);
  await expect(page.getByRole('link', { name: 'Abrir caja', exact: true })).toBeVisible();
  expect((await sale(page)).ok).toBe(false);
  expect((await invoke(page, 'replenishPos', ['sofia', 100, 'no-session'])).ok).toBe(false);
  await open(page); expect((await invoke(page, 'openRegister', [0, 'duplicate'])).ok).toBe(false);
  const session = (await snapshot(page)).registerSessions[0];
  await change(page, state => { state.administration.users.find((u: any) => u.id === 'pos-1').allowedRegisterIds = []; });
  await expect(page.getByText('No tienes autorización para esta caja. Solicita acceso a una caja activa.')).toBeVisible(); expect((await sale(page)).ok).toBe(false);
  expect((await invoke(page, 'openRegister', [0, 'unauthorized'])).ok).toBe(false);
  await change(page, state => { state.administration.users.find((u: any) => u.id === 'pos-1').allowedRegisterIds = ['caja-1']; state.cafeteriaOperations.registers[0].active = false; });
  await expect(page.getByText('La caja está inactiva. Consulta con administración.')).toBeVisible(); expect((await sale(page)).ok).toBe(false);
  expect((await invoke(page, 'openRegister', [0, 'inactive'])).ok).toBe(false);
  await change(page, state => { state.cafeteriaOperations.registers[0].active = true; state.registerSessions[0].cashierId = 'other'; });
  await expect(page.getByText('Esta caja está abierta por otro cajero.')).toBeVisible(); expect((await sale(page)).ok).toBe(false);
  await change(page, state => { state.registerSessions[0] = session; }); await page.reload();
  expect((await snapshot(page)).registerSessions[0]).toEqual(session); expect((await sale(page)).ok).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Deactivation stops sales, but the owning authorized cashier can still reconcile the drawer.
  await change(page, state => { state.cafeteriaOperations.registers[0].active = false; });
  await page.goto('/pos/caja'); await page.getByLabel('Efectivo contado (RD$)').fill('180');
  await page.getByRole('button', { name: 'Revisar cierre' }).click(); page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Confirmar cierre' }).click();
  await expect(page.getByText('Sin sesión abierta.')).toBeVisible();
  expect((await snapshot(page)).registerSessions[0].status).toBe('closed');
});
test('scheduled menu switches at boundary, preserves cart and rejects stale checkout', async ({ page }) => {
  test.setTimeout(90000); await page.clock.setFixedTime(new Date('2026-09-28T10:59:00-04:00'));
  await configure(page); await cashier(page); await open(page);
  await page.getByRole('button', { name: 'No usuario', exact: true }).click();
  await expect(page.locator('.pos-product-tile')).toHaveCount(1);
  await page.getByRole('button', { name: 'Añadir al carrito' }).click();
  await page.getByRole('button', { name: 'Continuar al pago' }).click();
  await page.getByRole('button', { name: 'Monto exacto' }).click();
  await page.clock.setFixedTime(new Date('2026-09-28T11:00:00-04:00'));
  await expect(page.getByRole('alert').filter({ hasText: 'Retira' })).toContainText('Pasta con pollo');
  await expect(page.getByRole('button', { name: 'Confirmar venta', exact: true })).toBeDisabled();
  const result = await sale(page); expect(result.ok).toBe(false); expect(result.message).toContain('Pasta con pollo');
  expect((await snapshot(page)).purchases).toHaveLength(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pikas:pos-cart:v1')!).cart)).toHaveLength(1);
  await page.getByRole('button', { name: /Volver|Modificar/ }).click();
  await expect(page.locator('.pos-product-tile')).toHaveCount(1); await expect(page.locator('.pos-product-tile')).toContainText('Sándwich integral');
  await page.getByRole('button', { name: 'Reducir cantidad' }).click();
  await page.clock.setFixedTime(new Date('2026-09-28T14:00:00-04:00'));
  await expect(page.getByText(/No hay un turno de servicio activo/)).toBeVisible();
  await expect(page.locator('.pos-product-tile')).toHaveCount(0);
  await page.screenshot({ path: `/tmp/pikas-no-service-${test.info().project.name}.png`, fullPage: true });
});
test('manual mode, recommendations and configuration changes revalidate preserved cart', async ({ page }) => {
  test.setTimeout(90000); await page.clock.setFixedTime(new Date('2026-09-28T10:00:00-04:00'));
  await configure(page); await cashier(page); await open(page);
  expect((await sale(page, 'menu-pasta', 'rank')).ok).toBe(true);
  await page.getByRole('button', { name: 'No usuario', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Top 5 cafetería' }).locator('../..')).toContainText('Pasta con pollo');
  await page.locator('.pos-product-tile').getByRole('button', { name: 'Añadir al carrito' }).click();
  await change(page, state => { state.menuItems.find((p: any) => p.id === 'menu-pasta').available = false; });
  await expect(page.locator('.pos-product-tile')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Top 5 cafetería' })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Retira' })).toContainText('Pasta con pollo');
  await expect(page.getByRole('button', { name: 'Continuar al pago' })).toBeDisabled();
  await change(page, state => { state.menuItems.find((p: any) => p.id === 'menu-pasta').available = true; state.cafeteriaOperations.menus[0].active = false; });
  await expect(page.getByText('El menú del turno de servicio está inactivo.')).toBeVisible();
  await change(page, state => { state.cafeteriaOperations.serviceSettings.enabled = false; state.menuItems.find((p: any) => p.id === 'menu-pasta').priceMinor = 0; });
  await expect(page.getByText(/Modo manual/)).toBeVisible(); await expect(page.locator('.pos-product-tile')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Continuar al pago' })).toBeEnabled();
  expect((await sale(page, 'menu-pasta', 'zero')).ok).toBe(true);
  expect((await snapshot(page)).purchases[0].totalMinor).toBe(0);
  // Changing the customer preserves cart but validates the new customer's restrictions.
  await page.getByRole('button', { name: 'Reducir cantidad' }).click();
  await page.getByRole('article').filter({ hasText: 'Pizza escolar' }).getByRole('button', { name: 'Añadir al carrito' }).click();
  await page.getByRole('button', { name: 'Cambiar cliente' }).click(); await page.getByRole('button', { name: 'Usuario PIKAS', exact: true }).click();
  await page.getByLabel('Código estudiantil / NFC').fill('PK-10982'); await page.getByRole('button', { name: 'Comprobar estudiante' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /alergia/ })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar al pago' }).click(); await expect(page.getByRole('button', { name: 'Confirmar venta', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('closed drawer rejects money movement, refund uses the next processing session, recovery stays valid', async ({ page }) => {
  test.setTimeout(90000); await cashier(page); await open(page);
  expect((await sale(page, 'menu-pasta', 'cash')).ok).toBe(true);
  expect((await invoke(page, 'checkoutPos', ['mateo', [{ itemId: 'menu-sandwich', quantity: 1 }], 'wallet', 'student_wallet'])).ok).toBe(true);
  expect((await invoke(page, 'replenishPos', ['sofia', 5000, 'topup'])).ok).toBe(true);
  let state = await snapshot(page); const original = state.purchases.find((p: any) => p.idempotencyKey === 'cash'), first = state.registerSessions[0];
  expect(state.purchases.every((p: any) => p.registerSessionId === first.id)).toBe(true); expect(state.events[0].registerSessionId).toBe(first.id);
  await page.goto('/pos/caja'); await page.getByLabel('Efectivo contado (RD$)').fill('230'); await page.getByRole('button', { name: 'Revisar cierre' }).click();
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Confirmar cierre' }).click(); await expect(page.getByRole('heading', { name: 'Abrir caja' })).toBeVisible();
  state = await snapshot(page); const closed = state.registerSessions[0]; expect(closed.expectedCashMinor).toBe(23000);
  expect((await sale(page, 'menu-pasta', 'blocked')).ok).toBe(false); expect((await invoke(page, 'replenishPos', ['sofia', 100, 'blocked-topup'])).ok).toBe(false);
  expect((await sale(page, 'menu-pasta', 'cash')).duplicate).toBe(true);
  await admin(page); expect((await invoke(page, 'refundPos', [original.id, 18000, 'Devolución', 'refund'])).ok).toBe(false);
  await cashier(page); await open(page, '500'); const second = (await snapshot(page)).registerSessions[0];
  await admin(page); expect((await invoke(page, 'refundPos', [original.id, 18000, 'Devolución', 'refund'])).ok).toBe(true);
  state = await snapshot(page); expect(state.events[0].registerSessionId).toBe(second.id); expect(state.registerSessions.find((s: any) => s.id === closed.id)).toEqual(closed);
  expect(state.purchases.find((p: any) => p.id === original.id)).toEqual(original);
});
test('an in-flight session refresh cannot re-enable checkout after going offline', async ({ page, context }) => {
  await cashier(page); await open(page);
  await page.getByRole('button', { name: 'No usuario', exact: true }).click();
  await page.getByRole('article').filter({ hasText: 'Pasta con pollo' }).getByRole('button', { name: 'Añadir al carrito' }).click();
  await page.getByRole('button', { name: 'Continuar al pago' }).click(); await page.getByRole('button', { name: 'Monto exacto' }).click();
  let release!: () => void; const pendingResponse = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/demo/session', async route => { await pendingResponse; await route.fulfill({ json: { role: 'pos_operator' } }); });
  const refresh = invoke(page, 'retryConnection');
  await expect(page.getByLabel('Estado de caja').filter({ visible: true })).toContainText('Connecting');
  await context.setOffline(true); release(); await refresh;
  await expect(page.getByRole('button', { name: 'Confirmar venta', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Estado de caja').filter({ visible: true })).toContainText('Offline');
  expect((await sale(page)).ok).toBe(false);
});
