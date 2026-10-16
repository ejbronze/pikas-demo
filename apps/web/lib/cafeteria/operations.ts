import { z } from 'zod';
import { minorSchema } from '../pos/contracts';
const signed = z.string().regex(/^-?(0|[1-9][0-9]*)$/);
const amount = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const purchaseSchema = z.object({ id: z.guid(), receipt_number: amount, purchased_at: z.string(), register_id: z.guid(), session_id: z.guid(), register_name: z.string(), operator_id: z.guid(), operator_name: z.string(), customer_name: z.string(), customer_type: z.string().nullable(), tender: z.enum(['cash', 'student_wallet', 'staff_credit']), currency: z.string(), total_minor: amount });
export const purchaseDetailSchema = purchaseSchema.extend({ cash_received_minor: amount.nullable(), change_minor: amount.nullable(), items: z.array(z.object({ name: z.string(), quantity: z.number().int(), unit_price_minor: amount, line_total_minor: amount })), receipt: z.record(z.string(), z.unknown()).nullable() });
export const sessionHistorySchema = z.object({ id: z.guid(), register_id: z.guid(), register_name: z.string(), register_code: z.string(), operator_id: z.guid(), operator_name: z.string(), opened_at: z.string(), status: z.enum(['open', 'closed']), version: z.number().int().positive(), currency: z.string(), closed_at: z.string().nullable(), closed_by: z.string().nullable(), close_type: z.string().nullable(), reason: z.string().nullable(), note: z.string().nullable(), counted_minor: amount.nullable(), summary: z.object({ opening_minor: amount, cash_sales_minor: amount, cash_refunds_minor: amount, cash_settlements_minor: amount, purchase_count: z.number().int(), expected_minor: signed }), difference_minor: signed.nullable(), close_snapshot: z.boolean() });
export const sessionDetailSchema = sessionHistorySchema.extend({ purchases: z.array(purchaseSchema), cash_movements: z.array(z.object({ id: z.guid(), occurred_at: z.string(), kind: z.enum(['refund', 'settlement']), amount_minor: signed })) });
const scope = { cafeteria_id: z.guid(), tenant_kind: z.enum(['customer', 'sandbox']) };
export const historyRequestSchema = z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('read'), cafeteria_id: z.guid(), kind: z.enum(['transactions', 'transaction', 'sessions', 'session']), offset: z.number().int().min(0).max(1000000), target_id: z.guid().nullable() }).strict(),
    z.object({ operation: z.literal('close'), cafeteria_id: z.guid(), session_id: z.guid(), version: z.number().int().positive(), counted_minor: minorSchema, expected_minor: signed, reason: z.enum(['operator_unavailable', 'operator_suspended', 'auth_access_lost', 'administrative_recovery', 'other']), note: z.string().trim().max(1000), request_key: z.uuid() }).strict().refine(r => r.reason !== 'other' || r.note.length > 0),
]);
export const readResultSchema = (kind: string) => z.object({ ...scope, data: kind === 'transactions' ? z.array(purchaseSchema) : kind === 'sessions' ? z.array(sessionHistorySchema) : kind === 'transaction' ? purchaseDetailSchema : sessionDetailSchema });
export const closeResultSchema = z.object({ request_key: z.uuid(), session: sessionHistorySchema });
export type PurchaseHistory = z.infer<typeof purchaseSchema>;
export type PurchaseDetail = z.infer<typeof purchaseDetailSchema>;
export type SessionHistory = z.infer<typeof sessionHistorySchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type CloseRequest = Extract<z.infer<typeof historyRequestSchema>, {
    operation: 'close';
}>;
export function money(value: string, currency = 'DOP') { const n = BigInt(value); const abs = n < 0n ? -n : n; return `${n < 0n ? '−' : ''}${currency === 'DOP' ? 'RD$' : currency} ${(abs / 100n).toLocaleString('es-DO')}.${String(abs % 100n).padStart(2, '0')}`; }
