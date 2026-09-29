import { describe, it, expect } from 'vitest';
import { openRegisterSession, closeRegisterSession, activeRegisterSessionId, assertSessionAttribution, summarizeRegisterSession } from './register-sessions';
import { receiptReprintAudit } from './receipt-reprint';
import { migrateCafeteriaDemoState } from './cafeteria-demo';
import type { FinancialActor, FinancialEvent } from './financial';
import type { PosPurchaseRecord } from './pos';
const scope = { organizationId: 'cafeteria-demo', locationId: 'principal' };
const register = { ...scope, id: 'caja-1', name: 'Caja 1', active: true };
const actor: FinancialActor = { ...scope, id: 'pos-1', name: 'Caja Demo', role: 'pos_operator', registerId: 'caja-1', active: true };
const opening = { sessions: [], register, actor, allowedRegisterIds: ['caja-1'], id: 'session', now: '2026-09-28T08:00:00-04:00', openingCashMinor: 10000 };
const open = () => openRegisterSession(opening);
const sale = (id: string, cash = true, session: string | undefined = 'session'): PosPurchaseRecord => ({ ...scope, id, registerSessionId: session, createdAt: '2026-09-28T09:00:00-04:00', cashierId: actor.id, employeeLabel: actor.name, posStationId: register.id, studentId: null, studentName: 'No usuario', items: [{ itemId: 'p', name: 'Histórico', quantity: 1, unitPriceMinor: 2000 }], totalMinor: 2000, status: 'completed', paymentMethod: cash ? 'cash' : 'student_wallet', studentAssociation: cash ? 'general_sale' : 'required', balanceImpactMinor: cash ? 0 : -2000, cashRegisterImpactMinor: cash ? 2000 : 0, cashReceivedMinor: cash ? 5000 : null, changeProvidedMinor: cash ? 3000 : null, idempotencyKey: id });
const event = (id: string, type: 'refund' | 'replenishment', cash = true): FinancialEvent => ({ ...scope, id, type, registerSessionId: 'session', registerId: register.id, studentId: null, originalPurchaseId: type === 'refund' ? 'cash' : null, amountMinor: 500, cashImpactMinor: cash ? type === 'refund' ? -500 : 500 : 0, walletImpactMinor: cash && type === 'refund' ? 0 : 500, balanceBeforeMinor: null, balanceAfterMinor: null, destination: cash && type === 'refund' ? 'cash' : 'wallet', reason: 'Demo', actorId: actor.id, actorName: actor.name, approvedBy: null, approvedByName: null, createdAt: '2026-09-28T10:00:00-04:00', idempotencyKey: id });
const purchases = [sale('cash'), sale('wallet', false), { ...sale('legacy'), registerSessionId: undefined }];
const events = [event('topup', 'replenishment'), event('refund', 'refund'), event('wallet-refund', 'refund', false)];
const closeInput = () => ({ session: open(), register, actor, allowedRegisterIds: ['caja-1'], purchases, events, expectedSummary: summarizeRegisterSession(open(), purchases, events), countedCashMinor: 12000, note: '', now: '2026-09-28T11:00:00-04:00', key: 'close' });
describe('register sessions', () => {
  it('opens with explicit cashier and register snapshots; accepts RD$0', () => {
    expect(openRegisterSession({ ...opening, openingCashMinor: 0 })).toMatchObject({ status: 'open', openingCashMinor: 0, cashierId: 'pos-1', registerName: 'Caja 1' });
  });
  it.each([-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid opening %s', openingCashMinor => expect(() => openRegisterSession({ ...opening, openingCashMinor })).toThrow());
  it('prevents a second session and makes opening retries idempotent', () => {
    const session = open();
    expect(() => openRegisterSession({ ...opening, sessions: [session], id: 'another' })).toThrow('ya tiene');
    expect(openRegisterSession({ ...opening, sessions: [session] })).toBe(session);
    expect(() => openRegisterSession({ ...opening, sessions: [session], openingCashMinor: 0 })).toThrow('reutilizada');
  });
  it('checks cashier authority, register access, scope and active status', () => {
    expect(() => openRegisterSession({ ...opening, allowedRegisterIds: [] })).toThrow('autorizada');
    expect(() => openRegisterSession({ ...opening, actor: { ...actor, role: 'cafeteria_admin' } })).toThrow('autorizada');
    expect(() => openRegisterSession({ ...opening, register: { ...register, active: false } })).toThrow('inactiva');
    expect(() => openRegisterSession({ ...opening, actor: { ...actor, organizationId: 'other' } })).toThrow();
  });
  it('uses explicit attribution only, excludes wallet and cash change from drawer revenue', () => {
    expect(summarizeRegisterSession(open(), purchases, events)).toMatchObject({ salesMinor: 4000, cashSalesMinor: 2000, walletSalesMinor: 2000, replenishmentsMinor: 500, cashReplenishmentsMinor: 500, refundsMinor: 1000, cashRefundsMinor: 500, expectedCashMinor: 12000, transactionCount: 5, purchaseIds: ['cash', 'wallet'] });
    expect(summarizeRegisterSession(open(), [{ ...sale('wrong'), organizationId: 'other' }], [])).toMatchObject({ expectedCashMinor: 10000, transactionCount: 0 });
  });
  it('attributes current operations, never old transactions or closed sessions', () => {
    expect(activeRegisterSessionId([], actor)).toBeUndefined();
    expect(activeRegisterSessionId([open()], actor)).toBe('session');
    expect(() => activeRegisterSessionId([open()], { ...actor, id: 'other' })).toThrow('otro cajero');
    const closed = closeRegisterSession(closeInput());
    expect(activeRegisterSessionId([closed], actor)).toBeUndefined();
    expect(() => assertSessionAttribution([closed], closed.id, scope, register.id, opening.now)).toThrow('cerrada');
    expect(() => assertSessionAttribution([open()], 'session', scope, register.id, '2020-01-01')).toThrow();
  });
  it('closes and freezes reconciliation; later activity cannot change it', () => {
    const closed = closeRegisterSession(closeInput());
    expect(closed).toMatchObject({ status: 'closed', expectedCashMinor: 12000, countedCashMinor: 12000, differenceMinor: 0 });
    expect(Object.isFrozen(closed)).toBe(true);
    expect(summarizeRegisterSession(closed, [...purchases, sale('later')], [])).toEqual(closeInput().expectedSummary);
    expect(closeRegisterSession({ ...closeInput(), session: closed })).toBe(closed);
    expect(() => closeRegisterSession({ ...closeInput(), session: closed, countedCashMinor: 0 })).toThrow('cerrada');
  });
  it.each([11000, 13000])('records discrepancies in either direction (%s) with a required reason', countedCashMinor => {
    expect(() => closeRegisterSession({ ...closeInput(), countedCashMinor })).toThrow('motivo');
    expect(closeRegisterSession({ ...closeInput(), countedCashMinor, note: 'Conteo real' })).toMatchObject({ differenceMinor: countedCashMinor - 12000, closingNote: 'Conteo real' });
  });
  it('rejects stale closing review and closure by another cashier', () => {
    expect(() => closeRegisterSession({ ...closeInput(), purchases: [...purchases, sale('concurrent')] })).toThrow('actividad cambió');
    expect(() => closeRegisterSession({ ...closeInput(), actor: { ...actor, id: 'other' } })).toThrow('Solo el cajero');
    expect(() => closeRegisterSession({ ...closeInput(), countedCashMinor: -1 })).toThrow('monto');
  });
  it('allows a suspended owner with revoked register access to reconcile only their own session', () => {
    const inactive = { ...actor, active: false, name: 'Renamed' };
    expect(() => openRegisterSession({ ...opening, actor: inactive })).toThrow('autorizada');
    const closed = closeRegisterSession({ ...closeInput(), actor: inactive, allowedRegisterIds: [], register: { ...register, active: false } });
    expect(closed).toMatchObject({ status: 'closed', cashierId: actor.id, cashierName: actor.name });
    for (const denied of [{ ...inactive, id: 'other' }, { ...inactive, role: 'cafeteria_admin' as const }, { ...inactive, organizationId: 'other' }, { ...inactive, locationId: 'other' }]) {
      expect(() => closeRegisterSession({ ...closeInput(), actor: denied })).toThrow();
    }
  });
  it('migrates revision 1 additively without invented sessions or historical attribution', () => {
    const old = { schemaRevision: 1, purchases, events, menuItems: [], administration: { users: [] }, shiftStartedAt: opening.now };
    const migrated = migrateCafeteriaDemoState(old);
    expect(migrated.schemaRevision).toBe(3); expect(migrated.registerSessions).toEqual([]);
    expect(migrated.purchases).toBe(purchases); expect(migrated.events).toBe(events);
    expect(migrated.cafeteriaOperations.registers[0]?.id).toBe('caja-1');
    expect(migrateCafeteriaDemoState(migrated)).toEqual(migrated);
    const configured = { ...migrated, registerSessions: [closeRegisterSession(closeInput())] };
    expect(migrateCafeteriaDemoState(configured).registerSessions).toBe(configured.registerSessions);
  });
});
describe('receipt reprints', () => {
  it('creates only an audit record with original transaction and current actor context', () => {
    const purchase = sale('original'), snapshot = structuredClone(purchase);
    const audit = receiptReprintAudit(purchase, actor, 'audit', opening.now, 'session');
    expect(audit).toMatchObject({ transactionId: 'original', actorId: 'pos-1', registerId: 'caja-1', registerSessionId: 'session', createdAt: opening.now, action: 'Recibo reimpreso' });
    expect(audit.detail).toContain('COPIA / REIMPRESIÓN'); expect(purchase).toEqual(snapshot);
    expect(audit).not.toHaveProperty('cashImpactMinor');
  });
  it('rejects cross-scope, inactive and unauthorized actors', () => {
    for (const denied of [{ ...actor, role: 'parent' as const }, { ...actor, active: false }, { ...actor, organizationId: 'other' }]) expect(() => receiptReprintAudit(sale('p'), denied, 'id', opening.now)).toThrow('autorizado');
  });
});
