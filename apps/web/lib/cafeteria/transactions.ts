import { z } from 'zod';
import { customRangeError, reportPeriods } from './reports';
import { refundReasons } from '../pos/refunds';

// Phase 5D.4 Transacciones lookup (public.cafeteria_transactions_read / cafeteria_transaction_detail).
// Filtering, pagination and refund state are computed by the database; the browser validates and
// formats. Periods are exactly those of the Phase 5D reports.
export const transactionTenders = ['cash', 'student_wallet', 'staff_credit'] as const;
export const refundStatuses = ['none', 'partial', 'full'] as const;
export type TransactionTender = (typeof transactionTenders)[number];
export type RefundStatus = (typeof refundStatuses)[number];
export const tenderLabel: Record<TransactionTender, string> = { cash: 'Efectivo', student_wallet: 'PIKAS Cash', staff_credit: 'Crédito de personal' };
export const refundStatusLabel: Record<RefundStatus, string> = { none: 'Sin reembolso', partial: 'Reembolso parcial', full: 'Reembolsada' };
export const transactionsPageSize = 25;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.string().regex(/^(0|[1-9][0-9]*)$/);
const receipt = z.string().regex(/^[1-9][0-9]{0,17}$/);

export const transactionsRequestSchema = z.object({
  operation: z.literal('list'), cafeteria_id: z.guid(),
  period: z.enum(reportPeriods).nullable(), from: isoDate.nullable(), to: isoDate.nullable(),
  tender: z.enum(transactionTenders).nullable(), refund_status: z.enum(refundStatuses).nullable(),
  receipt: receipt.nullable(), offset: z.number().int().min(0).max(1000000),
}).strict().refine(r => r.receipt !== null
  ? r.period === null && r.from === null && r.to === null && r.tender === null && r.refund_status === null
  : r.period !== null && (r.period === 'custom' ? r.from !== null && r.to !== null && customRangeError(r.from, r.to) === null : r.from === null && r.to === null));
export const detailRequestSchema = z.object({ operation: z.literal('detail'), cafeteria_id: z.guid(), purchase_id: z.guid() }).strict();
export const transactionsOperationSchema = z.union([transactionsRequestSchema, detailRequestSchema]);
export type TransactionsRequest = z.infer<typeof transactionsRequestSchema>;

const row = {
  id: z.guid(), receipt_number: amount, purchased_at: z.string(), business_date: isoDate, register_id: z.guid(), session_id: z.guid(),
  register_name: z.string(), operator_id: z.guid(), operator_name: z.string(), customer_name: z.string(), customer_type: z.string().nullable(),
  tender: z.enum(transactionTenders), currency: z.string().min(3), total_minor: amount,
  refunded_minor: amount, remaining_minor: amount, refund_status: z.enum(refundStatuses),
};
export const transactionRowSchema = z.object(row);
export const transactionsResultSchema = z.object({
  cafeteria_id: z.guid(), tenant_kind: z.enum(['customer', 'sandbox']), business_timezone: z.string().min(1), today: isoDate,
  period: z.enum(reportPeriods).nullable(), from: isoDate.nullable(), to: isoDate.nullable(),
  tender: z.enum(transactionTenders).nullable(), refund_status: z.enum(refundStatuses).nullable(), receipt: amount.nullable(),
  offset: z.number().int().min(0), page_size: z.number().int().positive(), total_count: z.number().int().min(0), has_more: z.boolean(),
  data: z.array(transactionRowSchema),
});
const refundEvent = z.object({
  ordinal: amount, occurred_at: z.string(), business_date: isoDate, amount_minor: amount, tender: z.enum(['cash', 'student_wallet']),
  reason: z.string(), notes: z.string().nullable(), authorization_mode: z.string(), actor_name: z.string(), actor_role: z.string(),
  approver_name: z.string().nullable(), register_name: z.string().nullable(), remaining_after_minor: amount,
  itemized: z.boolean(), unallocated_minor: amount, items: z.array(z.object({ name: z.string(), quantity: z.number().int().positive(), amount_minor: amount })),
});
export const transactionDetailSchema = transactionRowSchema.extend({
  cash_received_minor: amount.nullable(), change_minor: amount.nullable(), receipt: z.record(z.string(), z.unknown()).nullable(),
  items: z.array(z.object({ name: z.string(), quantity: z.number().int().positive(), unit_price_minor: amount, line_total_minor: amount,
    refunded_quantity: z.number().int().min(0), refunded_minor: amount })),
  refunds: z.array(refundEvent), unallocated_refund_minor: amount,
});
export const detailResultSchema = z.object({ cafeteria_id: z.guid(), tenant_kind: z.enum(['customer', 'sandbox']), data: transactionDetailSchema });
export type TransactionsResult = z.infer<typeof transactionsResultSchema>;
export type TransactionRow = z.infer<typeof transactionRowSchema>;
export type TransactionDetail = z.infer<typeof transactionDetailSchema>;

export const transactionsErrors: Record<string, string> = {
  invalid_report_range: 'Revisa las fechas del período.', report_range_too_long: 'El período personalizado no puede superar 92 días.',
  invalid_report_period: 'Elige un período válido.', invalid_receipt_search: 'Busca un número de recibo sin otros filtros.',
  invalid_tender: 'Método de pago no válido.', invalid_refund_status: 'Estado de reembolso no válido.', invalid_page: 'Página no válida.',
};
// Phase 5C labels; 'error' exists only on historical amount-only refunds.
export const refundReasonLabel: Record<string, string> = { ...Object.fromEntries(refundReasons), error: 'Error (reembolso histórico por monto)' };
export const authorizationLabel: Record<string, string> = { independent: 'Cajero (dentro del límite)', supervisor_approved: 'Aprobado por supervisor', supervisor_direct: 'Supervisor' };
