import { describe, it, expect } from 'vitest';
import { resolveRegisterGate, resolvePosCatalog, ineligibleCartItems, cartEligibilityMessage } from './pos-operation';
import { openRegisterSession, closeRegisterSession, summarizeRegisterSession } from './register-sessions';
import { quickAccess, type FinancialActor } from './financial';
import { validateCashPurchase, type PosMenuItemRecord, type PosPurchaseRecord, type PosStudentRecord } from './pos';
import type { CafeteriaOperations } from './cafeteria';
const scope = { organizationId: 'cafeteria-demo', locationId: 'principal' };
const actor: FinancialActor = { ...scope, id: 'pos-1', name: 'Cajero', role: 'pos_operator', registerId: 'caja-1', active: true };
const register = { ...scope, id: 'caja-1', name: 'Caja 1', active: true };
const now = '2026-09-28T10:59:00-04:00';
const session = openRegisterSession({ sessions: [], register, actor, allowedRegisterIds: ['caja-1'], id: 's', openingCashMinor: 0, now });
const gateInput = { actor, registers: [register], sessions: [session], allowedRegisterIds: ['caja-1'] };
const product = (id: string): PosMenuItemRecord => ({ id, name: id, priceMinor: 0, active: true, available: true, description: '', category: 'Comida', ingredients: [], allergens: [], restrictionTags: [], imageUrl: null });
const products = ['a', 'b', 'c', 'd', 'e', 'f'].map(product);
const operations = (): CafeteriaOperations => ({ registers: [register], menus: [{ ...scope, id: 'breakfast', name: 'Desayuno', active: true }, { ...scope, id: 'lunch', name: 'Almuerzo', active: true }], menuProducts: [{ menuId: 'breakfast', productId: 'a' }, { menuId: 'breakfast', productId: 'c' }, { menuId: 'breakfast', productId: 'f' }, { menuId: 'lunch', productId: 'b' }], serviceShifts: [{ ...scope, id: 'morning', name: 'Mañana', weekdays: [1], startTime: '07:00', endTime: '11:00', enabled: true, menuId: 'breakfast' }, { ...scope, id: 'midday', name: 'Mediodía', weekdays: [1], startTime: '11:00', endTime: '14:00', enabled: true, menuId: 'lunch' }], serviceSettings: { enabled: true, timeZone: 'America/Santo_Domingo' } });
const catalog = (ops = operations(), time = now, items = products) => resolvePosCatalog({ operations: ops, now: time, products: items, scope });
const student: PosStudentRecord = { id: 'kid', preferredName: 'Kid', grade: '', code: 'PK-12345', school: '', status: 'active', walletStatus: 'active', balanceMinor: 10000, spentTodayMinor: 0, dailyLimitMinor: 10000, perTransactionLimitMinor: 10000, allergies: [], blockedProducts: [], blockedProductIds: [] };
describe('register operation gate', () => {
  it('requires an identified active POS employee', () => {
    expect(resolveRegisterGate({ ...gateInput, actor: undefined }).status).toBe('unidentified_cashier');
    expect(resolveRegisterGate({ ...gateInput, actor: { ...actor, role: 'cafeteria_admin' } }).status).toBe('unidentified_cashier');
    expect(resolveRegisterGate({ ...gateInput, actor: { ...actor, active: false } }).status).toBe('unidentified_cashier');
  });
  it('accepts the explicitly authorized open register session', () => expect(resolveRegisterGate(gateInput)).toMatchObject({ status: 'ready', session }));
  it('rejects unauthorized registers without choosing another', () => expect(resolveRegisterGate({ ...gateInput, allowedRegisterIds: ['another'] }).status).toBe('no_authorized_register'));
  it('rejects an inactive or foreign-scope register', () => {
    expect(resolveRegisterGate({ ...gateInput, registers: [{ ...register, active: false }] }).status).toBe('register_inactive');
    expect(resolveRegisterGate({ ...gateInput, registers: [{ ...register, organizationId: 'other' }] }).status).toBe('no_authorized_register');
  });
  it('distinguishes missing, conflicting and other-cashier sessions', () => {
    expect(resolveRegisterGate({ ...gateInput, sessions: [] }).status).toBe('no_open_session');
    expect(resolveRegisterGate({ ...gateInput, sessions: [session, { ...session, id: 'other' }] }).status).toBe('invalid_sessions');
    expect(resolveRegisterGate({ ...gateInput, sessions: [{ ...session, cashierId: 'other' }] }).status).toBe('other_cashier');
  });
  it('requires a new session after closure', () => {
    const closed = closeRegisterSession({ session, register, actor, allowedRegisterIds: ['caja-1'], purchases: [], events: [], expectedSummary: summarizeRegisterSession(session, [], []), countedCashMinor: 0, note: '', now, key: 'close' });
    expect(resolveRegisterGate({ ...gateInput, sessions: [closed] }).status).toBe('no_open_session');
  });
});
describe('POS catalog and cart', () => {
  it('OFF intentionally offers all eligible products, even without schedules or active menus', () => {
    const ops = operations(); ops.serviceSettings.enabled = false; ops.menus = []; ops.serviceShifts = [];
    expect(catalog(ops)).toMatchObject({ status: 'manual', products });
  });
  it('ON uses shared active menu references, including zero-priced products', () => {
    const result = catalog(); expect(result.products.map(p => p.id)).toEqual(['a', 'c', 'f']); expect(result.products[0]).toBe(products[0]);
  });
  it.each(['active', 'available', 'price'])('excludes invalid %s in both modes', field => {
    const changed = products.map(p => p.id === 'a' ? { ...p, ...(field === 'price' ? { priceMinor: -1 } : { [field]: false }) } : p);
    const ops = operations(); expect(catalog(ops, now, changed).products.map(p => p.id)).not.toContain('a');
    ops.serviceSettings.enabled = false; expect(catalog(ops, now, changed).products.map(p => p.id)).not.toContain('a');
  });
  it('does not fall back with no active service and shows next configured shift', () => {
    const result = catalog(operations(), '2026-09-28T06:59:00-04:00');
    expect(result.products).toEqual([]); expect(result.message).toContain('Próximo turno: Mañana');
  });
  it('does not fall back with an inactive assigned menu or an empty eligible menu', () => {
    const ops = operations(); ops.menus[0]!.active = false;
    expect(catalog(ops)).toMatchObject({ status: 'inactive_menu', products: [] });
    ops.menus[0]!.active = true; ops.menuProducts = [];
    expect(catalog(ops).message).toContain('No hay productos elegibles');
  });
  it('rejects ambiguous schedules rather than selecting a menu', () => {
    const ops = operations(); ops.serviceShifts[1]!.startTime = '10:00';
    expect(catalog(ops)).toMatchObject({ status: 'invalid_configuration', products: [] });
  });
  it('revalidates preserved cart at the exact adjacent shift boundary', () => {
    const cart = [{ itemId: 'a', quantity: 1 }];
    expect(ineligibleCartItems(cart, catalog().products, products)).toEqual([]);
    const issues = ineligibleCartItems(cart, catalog(operations(), '2026-09-28T11:00:00-04:00').products, products);
    expect(issues).toEqual([{ id: 'a', name: 'a' }]); expect(cartEligibilityMessage(issues)).toContain('Retira');
    expect(cart).toEqual([{ itemId: 'a', quantity: 1 }]);
  });
  it('product and menu edits invalidate the cart without changing it', () => {
    const ops = operations(); ops.menuProducts = []; const cart = [{ itemId: 'a', quantity: 1 }];
    expect(ineligibleCartItems(cart, catalog(ops).products, products)).toHaveLength(1);
    expect(ineligibleCartItems(cart, catalog(operations(), now, [{ ...products[0]!, available: false }, ...products.slice(1)]).products, products)).toHaveLength(1);
  });
  it('continues customer restriction and allergy revalidation', () => {
    const item = { ...product('a'), allergens: ['Leche'] }, cart = [{ itemId: 'a', quantity: 1 }];
    expect(validateCashPurchase(student, [item], cart).ok).toBe(true);
    expect(validateCashPurchase({ ...student, allergies: ['Leche'] }, [item], cart).ok).toBe(false);
    expect(validateCashPurchase({ ...student, blockedProductIds: ['a'] }, [item], cart).ok).toBe(false);
  });
  it('Top 5 and frequent recommendations use the eligible menu and remain deduplicated', () => {
    const purchases: PosPurchaseRecord[] = products.map((p, index) => ({ id: p.id, ...scope, studentId: 'kid', studentName: 'Kid', totalMinor: 0, status: 'completed', paymentMethod: 'cash', studentAssociation: 'student_linked', balanceImpactMinor: 0, cashRegisterImpactMinor: 0, cashReceivedMinor: 0, changeProvidedMinor: 0, cashierId: actor.id, employeeLabel: actor.name, posStationId: register.id, idempotencyKey: p.id, createdAt: index === 5 ? '2026-08-15T12:00:00Z' : now, items: [{ itemId: p.id, quantity: 1, name: p.name, unitPriceMinor: 0 }] }));
    const ranked = quickAccess(catalog().products, purchases, student, scope.organizationId, scope.locationId, now);
    expect(ranked.cafeteria.map(p => p.id)).toEqual(['a', 'c']); expect(ranked.customer.map(p => p.id)).toEqual(['f']);
    const ops = operations(); ops.serviceSettings.enabled = false;
    expect(quickAccess(catalog(ops).products, purchases, student, scope.organizationId, scope.locationId, now).cafeteria).toHaveLength(5);
  });
});
