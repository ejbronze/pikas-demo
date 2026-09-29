import { describe, expect, it } from 'vitest';
import { BUSINESS_TIME_ZONE } from './financial';
import { resolveCafeteriaService, setServiceSchedulingEnabled, validateCafeteriaMenus, validateServiceShifts, type CafeteriaMenu, type CafeteriaOperations, type ServiceShift } from './cafeteria';
import type { PosMenuItemRecord } from './pos';

const scope = { organizationId: 'cafeteria-demo', locationId: 'principal' };
const menu: CafeteriaMenu = { ...scope, id: 'breakfast', name: 'Desayuno', active: true };
const product: PosMenuItemRecord = { id: 'fruit', name: 'Fruta', description: '', category: 'Frutas', priceMinor: 0, active: true, available: true, allergens: [], ingredients: [], restrictionTags: [], imageUrl: null };
const shift: ServiceShift = { ...scope, id: 'morning', name: 'Mañana', menuId: menu.id, weekdays: [1, 2, 3, 4, 5], startTime: '07:00', endTime: '10:00', enabled: true };
const operations = (): CafeteriaOperations => ({ menus: [menu], menuProducts: [{ menuId: menu.id, productId: product.id }], serviceShifts: [shift], serviceSettings: { enabled: true, timeZone: BUSINESS_TIME_ZONE }, registers: [] });
const resolve = (ops = operations(), now = '2026-09-25T08:00:00-04:00', products: PosMenuItemRecord[] = [product]) => resolveCafeteriaService({ operations: ops, now, products, scope });

describe('cafeteria menus', () => {
  it('references one product from multiple menus without copying it', () => {
    const second = { ...menu, id: 'lunch' };
    expect(validateCafeteriaMenus([menu, second], [{ menuId: menu.id, productId: product.id }, { menuId: second.id, productId: product.id }], [product])).toEqual({ ok: true });
  });
  it('rejects duplicate menu IDs and duplicate memberships', () => {
    expect(validateCafeteriaMenus([menu, menu], [], [product]).ok).toBe(false);
    const link = { menuId: menu.id, productId: product.id };
    expect(validateCafeteriaMenus([menu], [link, link], [product]).ok).toBe(false);
  });
  it('rejects dangling menu/product references and blank menu names', () => {
    expect(validateCafeteriaMenus([menu], [{ menuId: 'missing', productId: product.id }], [product]).ok).toBe(false);
    expect(validateCafeteriaMenus([menu], [{ menuId: menu.id, productId: 'missing' }], [product]).ok).toBe(false);
    expect(validateCafeteriaMenus([{ ...menu, name: ' ' }], [], []).ok).toBe(false);
  });
});

describe('service schedule validation', () => {
  it('allows adjacent enabled shifts', () => {
    expect(validateServiceShifts([shift, { ...shift, id: 'later', startTime: '10:00', endTime: '12:00' }], [menu])).toEqual({ ok: true });
  });
  it('rejects overlapping enabled shifts, including the same menu', () => {
    expect(validateServiceShifts([shift, { ...shift, id: 'overlap', startTime: '09:59' }], [menu]).ok).toBe(false);
  });
  it('allows overlapping times on distinct weekdays or disabled shifts', () => {
    expect(validateServiceShifts([shift, { ...shift, id: 'weekend', weekdays: [6, 7] }], [menu]).ok).toBe(true);
    expect(validateServiceShifts([shift, { ...shift, id: 'disabled', enabled: false }], [menu]).ok).toBe(true);
  });
  it('enforces one service per cafeteria even across locations, without blocking other cafeterias', () => {
    const otherMenu = { ...menu, id: 'other-menu', locationId: 'patio' };
    const otherShift = { ...shift, id: 'other-shift', locationId: 'patio', menuId: otherMenu.id };
    expect(validateServiceShifts([shift, otherShift], [menu, otherMenu]).ok).toBe(false);
    const ops = operations(); ops.menus.push(otherMenu); ops.serviceShifts.push(otherShift);
    expect(resolve(ops).status).toBe('invalid_configuration');
    expect(validateServiceShifts([shift, { ...otherShift, organizationId: 'other' }], [menu, { ...otherMenu, organizationId: 'other' }]).ok).toBe(true);
  });
  it.each([
    { startTime: '22:00', endTime: '06:00' },
    { startTime: '07:00', endTime: '07:00' },
    { startTime: '7:00' }, { endTime: '24:00' }, { endTime: '10:60' },
    { weekdays: [] }, { weekdays: [0] }, { weekdays: [8] }, { weekdays: [1.5] }, { weekdays: [1, 1] },
  ])('rejects invalid or overnight shift %j', patch => {
    expect(validateServiceShifts([{ ...shift, ...patch }], [menu]).ok).toBe(false);
  });
  it('requires a same-scope menu and unique shift IDs', () => {
    expect(validateServiceShifts([shift], []).ok).toBe(false);
    expect(validateServiceShifts([shift], [{ ...menu, locationId: 'other' }]).ok).toBe(false);
    expect(validateServiceShifts([shift, { ...shift, enabled: false }], [menu]).ok).toBe(false);
  });
  it('does not let an inactive menu excuse overlapping enabled shifts', () => {
    expect(validateServiceShifts([shift, { ...shift, id: 'other' }], [{ ...menu, active: false }]).ok).toBe(false);
  });
});

describe('active service and saleable product resolution', () => {
  it.each([
    ['2026-09-25T06:59:59-04:00', 'no_active_service'],
    ['2026-09-25T07:00:00-04:00', 'active'],
    ['2026-09-25T09:59:59-04:00', 'active'],
    ['2026-09-25T10:00:00-04:00', 'no_active_service'],
    ['2026-09-26T08:00:00-04:00', 'no_active_service'],
  ])('uses inclusive start/exclusive end and weekday at %s', (now, status) => {
    expect(resolve(operations(), now).status).toBe(status);
  });
  it('switches to the adjacent service exactly at its start', () => {
    const ops = operations();
    ops.serviceShifts.push({ ...shift, id: 'next', startTime: '10:00', endTime: '12:00' });
    const resolved = resolve(ops, '2026-09-25T14:00:00Z');
    expect(resolved.status).toBe('active');
    expect(resolved.shift?.id).toBe('next');
  });
  it('uses Santo Domingo weekday/minutes, including midnight and Sunday', () => {
    const ops = operations();
    ops.serviceShifts = [{ ...shift, weekdays: [7], startTime: '00:00', endTime: '01:00' }];
    expect(resolve(ops, '2026-09-27T03:59:59Z').status).toBe('no_active_service');
    expect(resolve(ops, '2026-09-27T04:00:00Z').status).toBe('active');
    expect(resolve(ops, '2026-09-27T05:00:00Z').status).toBe('no_active_service');
  });
  it('OFF offers manual catalog without changing shifts and ON restores their configuration', () => {
    const ops = operations(), snapshot = structuredClone(ops);
    const off = setServiceSchedulingEnabled(ops, false);
    expect(resolve(off)).toMatchObject({ status: 'manual', products: [product] });
    expect(off.serviceShifts).toEqual(snapshot.serviceShifts);
    expect(ops).toEqual(snapshot);
    expect(resolve(setServiceSchedulingEnabled(off, true)).status).toBe('active');
  });
  it('fails closed for overlaps when reenabled', () => {
    const ops = operations();
    ops.serviceShifts.push({ ...shift, id: 'overlap' });
    expect(resolve(setServiceSchedulingEnabled(ops, true))).toMatchObject({ status: 'invalid_configuration', products: [] });
  });
  it('never falls back to all products when schedules are empty or disabled', () => {
    const ops = operations();
    ops.serviceShifts = [];
    expect(resolve(ops)).toMatchObject({ status: 'no_active_service', products: [] });
    ops.serviceShifts = [{ ...shift, enabled: false }];
    expect(resolve(ops).products).toEqual([]);
  });
  it('returns no products for inactive menus or empty memberships', () => {
    const ops = operations();
    ops.menus = [{ ...menu, active: false }];
    expect(resolve(ops)).toMatchObject({ status: 'inactive_menu', products: [] });
    ops.menus = [menu]; ops.menuProducts = [];
    expect(resolve(ops)).toMatchObject({ status: 'active', products: [] });
  });
  it('includes only member products that are active and available, allowing RD$0', () => {
    const ops = operations();
    const products = [product, { ...product, id: 'inactive', active: false }, { ...product, id: 'unavailable', available: false }, { ...product, id: 'outside' }];
    ops.menuProducts = products.slice(0, 3).map(p => ({ menuId: menu.id, productId: p.id }));
    expect(resolve(ops, undefined, products).products).toEqual([product]);
  });
  it('rejects invalid prices from saleability without changing product records', () => {
    for (const priceMinor of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(resolve(undefined, undefined, [{ ...product, priceMinor }]).products).toEqual([]);
  });
  it('supports legacy products with no active flag', () => {
    const legacy = { ...product }; delete legacy.active;
    expect(resolve(undefined, undefined, [legacy]).products).toEqual([legacy]);
  });
  it('does not expose another cafeteria catalog', () => {
    expect(resolveCafeteriaService({ operations: operations(), products: [product], now: '2026-09-25T08:00:00-04:00', scope: { ...scope, organizationId: 'other' } })).toMatchObject({ status: 'no_active_service', products: [] });
  });
  it('fails closed for dangling memberships or a missing menu', () => {
    const ops = operations(); ops.menuProducts.push({ menuId: menu.id, productId: 'missing' });
    expect(resolve(ops).status).toBe('invalid_configuration');
    ops.menuProducts = []; ops.menus = [];
    expect(resolve(ops).status).toBe('invalid_configuration');
  });
  it.each(['invalid', '2026-09-25T08:00:00'])('requires a valid explicit instant: %s', now => {
    expect(resolve(operations(), now).status).toBe('invalid_configuration');
  });
  it('is deterministic and does not mutate inputs', () => {
    const ops = operations(), snapshot = structuredClone(ops);
    expect(resolve(ops)).toEqual(resolve(ops));
    expect(ops).toEqual(snapshot);
  });
});
