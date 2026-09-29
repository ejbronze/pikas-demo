import type { CafeteriaRegister, CafeteriaScope } from './cafeteria';
import { cashReconciliation, type FinancialActor, type FinancialEvent } from './financial';
import type { PosPurchaseRecord } from './pos';

export type RegisterSessionSummary = Readonly<{
  salesMinor: number; cashSalesMinor: number; walletSalesMinor: number;
  replenishmentsMinor: number; cashReplenishmentsMinor: number; refundsMinor: number; cashRefundsMinor: number;
  transactionCount: number; expectedCashMinor: number; purchaseIds: readonly string[]; eventIds: readonly string[];
}>;
type SessionBase = Readonly<CafeteriaScope & {
  id: string; registerId: string; registerName: string; cashierId: string; cashierName: string;
  openedAt: string; openingCashMinor: number;
}>;
export type RegisterSession = SessionBase & (
  { readonly status: 'open' } |
  { readonly status: 'closed'; readonly closedAt: string; readonly countedCashMinor: number;
    readonly expectedCashMinor: number; readonly differenceMinor: number; readonly closingNote: string;
    readonly closingKey: string; readonly summary: RegisterSessionSummary }
);
const sameScope = (a: CafeteriaScope, b: { organizationId?: string; locationId?: string }) => a.organizationId === b.organizationId && a.locationId === b.locationId;
const money = (amount: number) => { if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Indica un monto RD$ válido, mayor o igual a cero.'); };
function authorize(actor: FinancialActor, register: CafeteriaRegister, allowedRegisterIds: readonly string[]) {
  if (!actor.active || actor.role !== 'pos_operator' || !sameScope(register, actor) || actor.registerId !== register.id || !allowedRegisterIds.includes(register.id)) throw new Error('Caja no autorizada para este cajero.');
}
export function openRegisterSession(input: { sessions: readonly RegisterSession[]; register: CafeteriaRegister; actor: FinancialActor; allowedRegisterIds: readonly string[]; id: string; now: string; openingCashMinor: number }): RegisterSession {
  const { sessions, register, actor, openingCashMinor } = input;
  authorize(actor, register, input.allowedRegisterIds); money(openingCashMinor);
  if (!input.id.trim() || !Number.isFinite(Date.parse(input.now))) throw new Error('Sesión de caja no válida.');
  const duplicate = sessions.find(s => s.id === input.id);
  if (duplicate) {
    if (!sameScope(duplicate, actor) || duplicate.registerId !== register.id || duplicate.cashierId !== actor.id || duplicate.openingCashMinor !== openingCashMinor) throw new Error('Clave de apertura reutilizada.');
    return duplicate;
  }
  if (!register.active) throw new Error('La caja está inactiva.');
  if (sessions.some(s => sameScope(s, register) && s.registerId === register.id && s.status === 'open')) throw new Error('Esta caja ya tiene una sesión abierta.');
  return Object.freeze({ id: input.id, registerId: register.id, registerName: register.name, organizationId: register.organizationId, locationId: register.locationId, cashierId: actor.id, cashierName: actor.name, openedAt: input.now, openingCashMinor, status: 'open' });
}
/** Optional attribution is resolved under the same lock as the financial write. Never infer it from old records. */
export function activeRegisterSessionId(sessions: readonly RegisterSession[], actor: FinancialActor): string | undefined {
  if (!actor.active || !['pos_operator', 'cafeteria_admin'].includes(actor.role)) return undefined;
  const open = sessions.filter(s => sameScope(s, actor) && s.registerId === actor.registerId && s.status === 'open');
  if (open.length > 1) throw new Error('Configuración de caja inválida: varias sesiones abiertas.');
  if (open[0] && actor.role === 'pos_operator' && open[0].cashierId !== actor.id) throw new Error('La sesión abierta pertenece a otro cajero.');
  return open[0]?.id;
}
export function assertSessionAttribution(sessions: readonly RegisterSession[], sessionId: string, scope: CafeteriaScope, registerId: string, now: string) {
  const session = sessions.find(s => s.id === sessionId);
  if (!session || session.status !== 'open' || !sameScope(session, scope) || session.registerId !== registerId || !Number.isFinite(Date.parse(now)) || Date.parse(now) < Date.parse(session.openedAt)) throw new Error('No se puede atribuir actividad a una sesión cerrada o no válida.');
}
export function summarizeRegisterSession(session: RegisterSession, purchases: readonly PosPurchaseRecord[], events: readonly FinancialEvent[]): RegisterSessionSummary {
  if (session.status === 'closed') return session.summary;
  const sales = purchases.filter(p => p.registerSessionId === session.id && sameScope(session, p) && p.posStationId === session.registerId);
  const activity = events.filter(e => e.registerSessionId === session.id && sameScope(session, e) && e.registerId === session.registerId);
  const cash = cashReconciliation(sales, activity);
  const total = (rows: readonly { amountMinor: number }[]) => rows.reduce((sum, row) => sum + row.amountMinor, 0);
  const summary = {
    salesMinor: sales.reduce((n, p) => n + p.totalMinor, 0), cashSalesMinor: cash.grossCashSales,
    walletSalesMinor: sales.filter(p => p.paymentMethod === 'student_wallet').reduce((n, p) => n + p.totalMinor, 0),
    replenishmentsMinor: total(activity.filter(e => e.type === 'replenishment')), cashReplenishmentsMinor: cash.cashReplenishments,
    refundsMinor: total(activity.filter(e => e.type === 'refund')), cashRefundsMinor: cash.cashRefunds,
    transactionCount: sales.length + activity.filter(e => e.type !== 'void').length,
    expectedCashMinor: session.openingCashMinor + cash.expectedCash,
    purchaseIds: Object.freeze(sales.map(p => p.id).sort()), eventIds: Object.freeze(activity.map(e => e.id).sort()),
  };
  for (const value of Object.values(summary)) if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Totales de sesión fuera de rango.');
  return Object.freeze(summary);
}
export function closeRegisterSession(input: { session: RegisterSession; register: CafeteriaRegister; actor: FinancialActor; allowedRegisterIds: readonly string[]; purchases: readonly PosPurchaseRecord[]; events: readonly FinancialEvent[]; expectedSummary: RegisterSessionSummary; countedCashMinor: number; note: string; now: string; key: string }): RegisterSession {
  const { session, actor, countedCashMinor } = input;
  // Revoked operational access must not strand the owner's existing cash session.
  // This exception only reconciles/closes; it grants no sale, opening or override authority.
  if (actor.role !== 'pos_operator' || !sameScope(input.register, actor) || actor.registerId !== input.register.id) throw new Error('Caja no autorizada para este cajero.');
  money(countedCashMinor);
  if (!sameScope(session, actor) || session.cashierId !== actor.id || session.registerId !== input.register.id) throw new Error('Solo el cajero de esta sesión puede cerrarla.');
  if (session.status === 'closed') {
    if (session.closingKey === input.key && session.countedCashMinor === countedCashMinor && session.closingNote === input.note.trim()) return session;
    throw new Error('La sesión ya está cerrada y no puede modificarse.');
  }
  if (!input.key.trim() || !Number.isFinite(Date.parse(input.now)) || Date.parse(input.now) < Date.parse(session.openedAt)) throw new Error('Cierre no válido.');
  const summary = summarizeRegisterSession(session, input.purchases, input.events);
  if (JSON.stringify(summary) !== JSON.stringify(input.expectedSummary)) throw new Error('La actividad cambió. Revisa el resumen actualizado antes de cerrar.');
  const differenceMinor = countedCashMinor - summary.expectedCashMinor;
  if (!Number.isSafeInteger(differenceMinor)) throw new Error('Diferencia fuera de rango.');
  if (differenceMinor !== 0 && !input.note.trim()) throw new Error('Indica el motivo de la diferencia para cerrar.');
  if (input.note.trim().length > 1000) throw new Error('El motivo debe tener como máximo 1000 caracteres.');
  return Object.freeze({ ...session, status: 'closed', closedAt: input.now, countedCashMinor, expectedCashMinor: summary.expectedCashMinor, differenceMinor, closingNote: input.note.trim(), closingKey: input.key, summary });
}
