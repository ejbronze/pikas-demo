import type { FinancialActor } from './financial';
import type { PosPurchaseRecord } from './pos';
export function receiptReprintAudit(purchase: PosPurchaseRecord, actor: FinancialActor, id: string, now: string, registerSessionId?: string) {
  if (!actor.active || !['pos_operator', 'cafeteria_admin'].includes(actor.role) || purchase.organizationId !== actor.organizationId || purchase.locationId !== actor.locationId) throw new Error('Recibo fuera del ámbito autorizado.');
  return { id, actor: actor.name, actorId: actor.id, action: 'Recibo reimpreso', detail: `COPIA / REIMPRESIÓN · ${purchase.id}`, createdAt: now, transactionId: purchase.id, registerId: actor.registerId, ...(registerSessionId ? { registerSessionId } : {}) };
}
