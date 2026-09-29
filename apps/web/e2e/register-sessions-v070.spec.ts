import { test, expect, type Page } from '@playwright/test';
import { invoke, snapshot } from './helpers';
async function cashier(page: Page) {
  await page.goto('/login'); await page.getByRole('tab', { name: 'Cafetería' }).click();
  await page.getByRole('button', { name: /Entrar como cafetería/ }).click();
  await expect(page.getByRole('link', { name: 'Caja', exact: true })).toBeVisible();
}
async function admin(page: Page, path = '/admin/cafeteria/cajas') {
  await page.goto('/admin/login'); await page.getByLabel('Correo demo').filter({ visible: true }).fill('admin.cafeteria@demo.pikas.do');
  await page.getByRole('button', { name: 'Entrar a administración' }).click(); await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
const cashSale = (page: Page, key: string) => invoke(page, 'checkoutPos', [null, [{ itemId: 'menu-pasta', quantity: 1 }], key, 'cash', 20000, true]);
async function open(page: Page, value = '100') {
  await page.goto('/pos/caja'); await page.getByLabel('Fondo inicial (RD$)').fill(value);
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Confirmar apertura' }).click();
  await expect(page.getByRole('heading', { name: 'Cerrar caja' })).toBeVisible();
}
test('cashier opens, reconciles cash and wallet activity, closes with discrepancy, Admin sees immutable history', async ({ page }) => {
  test.setTimeout(90000);
  await cashier(page); expect((await cashSale(page, 'without-session')).ok).toBe(false);
  await open(page);
  expect((await invoke(page, 'openRegister', [0, 'second'])).ok).toBe(false);
  expect((await cashSale(page, 'session-cash')).ok).toBe(true);
  expect((await invoke(page, 'checkoutPos', ['mateo', [{ itemId: 'menu-sandwich', quantity: 1 }], 'wallet', 'student_wallet'])).ok).toBe(true);
  expect((await invoke(page, 'replenishPos', ['sofia', 5000, 'topup'])).ok).toBe(true);
  let state = await snapshot(page); const session = state.registerSessions[0];
  expect(state.purchases.filter((p: { registerSessionId?: string }) => p.registerSessionId === session.id)).toHaveLength(2);
  await admin(page, '/admin/cafeteria/transacciones');
  expect((await invoke(page, 'refundPos', [state.purchases.find((p: { idempotencyKey: string }) => p.idempotencyKey === 'session-cash').id, 18000, 'Devolución demo', 'refund'])).ok).toBe(true);
  await cashier(page); await page.goto('/pos/caja');
  const summary = page.getByRole('region', { name: 'Resumen de sesión' });
  await expect(summary).toContainText('150.00'); // 100 opening + 180 cash + 50 topup - 180 refund
  await expect(summary).toContainText('120.00'); // wallet sale is separate
  await page.getByLabel('Efectivo contado (RD$)').fill('149');
  await page.getByRole('button', { name: 'Revisar cierre' }).click();
  expect((await snapshot(page)).registerSessions[0].status).toBe('open'); // browser requires discrepancy note
  await page.getByLabel('Motivo de diferencia').fill('Faltante confirmado');
  await page.getByRole('button', { name: 'Revisar cierre' }).click();
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Confirmar cierre' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir caja' })).toBeVisible();
  state = await snapshot(page); const closed = state.registerSessions[0];
  expect(closed).toMatchObject({ status: 'closed', expectedCashMinor: 15000, countedCashMinor: 14900, differenceMinor: -100 });
  expect((await cashSale(page, 'after-close')).ok).toBe(false);
  state = await snapshot(page); expect(state.registerSessions[0]).toEqual(closed);
  await admin(page); await page.getByRole('button', { name: /Ver cierre/ }).click();
  await expect(page.getByRole('region', { name: 'Resumen de sesión' })).toContainText('Faltante confirmado');
  expect((await invoke(page, 'closeRegister', [closed.id, 15000, '', closed.summary, 'forced'])).ok).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/pikas-cajas-${test.info().project.name}.png`, fullPage: true });
});
test('zero opening, stale close review and retry protection', async ({ page }) => {
  test.setTimeout(60000); await cashier(page); await open(page, '0');
  await page.getByLabel('Efectivo contado (RD$)').fill('0'); await page.getByRole('button', { name: 'Revisar cierre' }).click();
  expect((await cashSale(page, 'racing-sale')).ok).toBe(true);
  await page.getByLabel('Motivo de diferencia').fill('Conteo antes de la nueva venta');
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Confirmar cierre' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'actividad cambió' })).toBeVisible();
  await page.getByLabel('Efectivo contado (RD$)').fill('180'); await page.getByRole('button', { name: 'Revisar cierre' }).click();
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Confirmar cierre' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir caja' })).toBeVisible();
  const state = await snapshot(page), closed = state.registerSessions[0];
  expect(closed.differenceMinor).toBe(0);
  expect((await cashSale(page, 'racing-sale')).duplicate).toBe(true);
  expect((await snapshot(page)).purchases).toEqual(state.purchases);
});
test('receipt copy preserves original values, refunds and ledger; records audit only', async ({ page }) => {
  test.setTimeout(90000); await cashier(page); await open(page, '0');
  expect((await cashSale(page, 'print-sale')).ok).toBe(true);
  let state = await snapshot(page); const original = state.purchases[0];
  await admin(page, '/admin/cafeteria/transacciones');
  const product = state.menuItems.find((p: { id: string }) => p.id === 'menu-pasta');
  expect((await invoke(page, 'adminUpdateMenu', [{ ...product, name: 'Nombre cambiado', priceMinor: 25000 }, product])).ok).toBe(true);
  expect((await invoke(page, 'refundPos', [original.id, 18000, 'Reembolso de prueba', 'print-refund'])).ok).toBe(true);
  state = await snapshot(page);
  await page.getByRole('button').filter({ hasText: original.id }).click();
  const detail = page.getByRole('region', { name: 'Detalle de transacción' });
  await expect(detail).toContainText('Pasta con pollo'); await expect(detail).toContainText('180.00'); await expect(detail).toContainText('Reembolsada');
  await page.evaluate(() => { (window as unknown as { print: () => void }).print = () => { document.body.dataset.printCalls = String(Number(document.body.dataset.printCalls ?? '0') + 1); }; });
  await detail.getByRole('button', { name: 'Reimprimir recibo', exact: true }).click();
  await expect(detail).toContainText('COPIA / REIMPRESIÓN');
  await expect(page.locator('body')).toHaveAttribute('data-print-calls', '1');
  const after = await snapshot(page);
  expect(after.purchases).toEqual(state.purchases); expect(after.events).toEqual(state.events); expect(after.transactions).toEqual(state.transactions);
  expect(after.registerSessions).toEqual(state.registerSessions);
  expect(after.administration.audit[0]).toMatchObject({ transactionId: original.id, actorId: 'ca-1', action: 'Recibo reimpreso', registerId: 'caja-1', registerSessionId: state.registerSessions[0].id });
  await expect(detail).toContainText(original.employeeLabel); await expect(detail).toContainText(original.posStationId); await expect(detail).toContainText(original.id);
  await page.emulateMedia({ media: 'print' });
  await expect(detail.getByText('COPIA / REIMPRESIÓN', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Reimprimir recibo', exact: true })).toBeHidden();
  await page.screenshot({ path: `/tmp/pikas-receipt-${test.info().project.name}.png`, fullPage: true });
});
