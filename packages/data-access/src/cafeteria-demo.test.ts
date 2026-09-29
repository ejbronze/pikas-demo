import { describe, expect, it } from 'vitest';
import { migrateCafeteriaDemoState, CAFETERIA_DEMO_SCHEMA_REVISION } from './cafeteria-demo';
import { DEFAULT_POS_POLICY } from './financial';
import type { PosMenuItemRecord } from './pos';

const product: PosMenuItemRecord = { id: 'old-id', name: 'Producto existente', description: '', category: 'Merienda', priceMinor: 0, available: false, allergens: ['Gluten'], ingredients: [], restrictionTags: [], imageUrl: null };
const legacy = () => ({
  menuItems: [product], students: [{ id: 'student', balance: 2450, spentToday: 160 }],
  purchases: [{ id: 'purchase', items: [{ itemId: product.id, unitPriceMinor: 1500 }], cashierId: 'pos-1' }],
  events: [{ id: 'refund', type: 'refund', amountMinor: 500, originalPurchaseId: 'purchase' }],
  transactions: [{ id: 'ledger' }], orders: [{ id: 'order' }],
  posPolicy: { ...DEFAULT_POS_POLICY, partialRefunds: true }, shiftStartedAt: '2026-09-01T08:00:00-04:00',
  administration: {
    cafeteria: { name: 'Existente' }, audit: [{ id: 'audit' }], memberships: [{ id: 'membership' }], partnerships: [{ id: 'partnership' }],
    users: [
      { id: 'pos-1', role: 'pos_operator', status: 'active' },
      { id: 'pos-2', role: 'pos_operator', status: 'suspended' },
      { id: 'ca-1', role: 'cafeteria_admin', status: 'active' },
    ],
  },
});

describe('compatible cafeteria demo migration', () => {
  it('adds revision and manual catalog mode without fabricating menus or history', () => {
    const migrated = migrateCafeteriaDemoState(legacy());
    expect(migrated.schemaRevision).toBe(CAFETERIA_DEMO_SCHEMA_REVISION);
    expect(migrated.cafeteriaOperations).toMatchObject({ menus: [], menuProducts: [], serviceShifts: [], serviceSettings: { enabled: false, timeZone: 'America/Santo_Domingo' } });
  });
  it('preserves every financial, student, policy and historical field', () => {
    const before = legacy(), migrated = migrateCafeteriaDemoState(before);
    for (const key of ['students', 'purchases', 'events', 'transactions', 'orders', 'posPolicy', 'shiftStartedAt'] as const) expect(migrated[key]).toEqual(before[key]);
    for (const key of ['cafeteria', 'audit', 'memberships', 'partnerships'] as const) expect(migrated.administration[key]).toEqual(before.administration[key]);
    expect(migrated.menuItems).toEqual([{ ...product, active: true }]);
    expect(migrated.menuItems[0]!.available).toBe(false);
  });
  it('adds only the existing primary register and defaults POS roles without admin authority', () => {
    const migrated = migrateCafeteriaDemoState(legacy());
    expect(migrated.cafeteriaOperations.registers).toEqual([{ id: 'caja-1', name: 'Caja 1', organizationId: 'cafeteria-demo', locationId: 'principal', active: true }]);
    expect(migrated.administration.users[0]).toMatchObject({ role: 'pos_operator', posRole: 'cashier', allowedRegisterIds: ['caja-1'] });
    expect(migrated.administration.users[1]).toMatchObject({ status: 'suspended', allowedRegisterIds: [] });
    expect(migrated.administration.users[2]).toEqual(legacy().administration.users[2]);
  });
  it('preserves explicit deactivation, supervisor role, status and register restrictions', () => {
    const before = { ...legacy(), menuItems: [{ ...product, active: false }], administration: { ...legacy().administration, users: [{ id: 'pos-1', role: 'pos_operator', status: 'suspended', posRole: 'supervisor' as const, allowedRegisterIds: [] }] } };
    const migrated = migrateCafeteriaDemoState(before);
    expect(migrated.menuItems).toEqual(before.menuItems);
    expect(migrated.administration.users).toEqual(before.administration.users);
  });
  it('preserves configured menus, shifts, settings and intentionally empty registers', () => {
    const state = migrateCafeteriaDemoState(legacy());
    const scope = { organizationId: 'cafeteria-demo', locationId: 'principal' };
    state.cafeteriaOperations.menus = [{ ...scope, id: 'menu', name: 'Existente', active: false }];
    state.cafeteriaOperations.menuProducts = [{ menuId: 'menu', productId: product.id }];
    state.cafeteriaOperations.serviceShifts = [{ ...scope, id: 'service', name: 'Servicio', menuId: 'menu', weekdays: [1], startTime: '08:00', endTime: '09:00', enabled: false }];
    state.cafeteriaOperations.serviceSettings.enabled = true;
    state.cafeteriaOperations.registers = [];
    expect(migrateCafeteriaDemoState(state)).toEqual(state);
  });
  it('is idempotent, does not mutate input, and preserves unknown legacy fields', () => {
    const before = { ...legacy(), futureMetadata: { retained: true } }, snapshot = structuredClone(before);
    const once = migrateCafeteriaDemoState(before);
    expect(migrateCafeteriaDemoState(once)).toEqual(once);
    expect(before).toEqual(snapshot);
    expect(once.futureMetadata).toEqual(before.futureMetadata);
  });
  it('adds missing foundation collections without replacing those already present', () => {
    const migrated = migrateCafeteriaDemoState({ ...legacy(), cafeteriaOperations: { registers: [] } });
    expect(migrated.cafeteriaOperations.registers).toEqual([]);
    expect(migrated.cafeteriaOperations.serviceShifts).toEqual([]);
  });
  it.each([-1, 0.5, CAFETERIA_DEMO_SCHEMA_REVISION + 1])('rejects incompatible revision %s without rewriting state', schemaRevision => {
    const before = { ...legacy(), schemaRevision }, snapshot = structuredClone(before);
    expect(() => migrateCafeteriaDemoState(before)).toThrow('Revisión del estado demo no compatible');
    expect(before).toEqual(snapshot);
  });
});
