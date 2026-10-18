import { z } from 'zod';

// Phase 5D reporting contract (public.cafeteria_report_read): 5D.1 sales summary and 5D.2 top
// products. Totals are computed by the database; the browser only validates and formats them.
export const reportPeriods = ['today', 'last_7_days', 'last_30_days', 'custom'] as const;
export type ReportPeriod = (typeof reportPeriods)[number];
export const maxReportDays = 92;
export const reportKinds = ['sales_summary', 'top_products'] as const;
export type ReportKind = (typeof reportKinds)[number];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.string().regex(/^(0|[1-9][0-9]*)$/);
const signed = z.string().regex(/^(0|-?[1-9][0-9]*)$/);
const count = z.number().int().min(0);

export const reportDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
export function customRangeError(from: string, to: string): string | null {
  if (!isoDate.safeParse(from).success || !isoDate.safeParse(to).success) return 'Selecciona la fecha inicial y la final.';
  if (from > to) return 'La fecha inicial debe ser anterior o igual a la final.';
  if (reportDays(from, to) > maxReportDays) return `El período personalizado no puede superar ${maxReportDays} días.`;
  return null;
}

export const reportRequestSchema = z.object({
  cafeteria_id: z.guid(), kind: z.enum(reportKinds), period: z.enum(reportPeriods), from: isoDate.nullable(), to: isoDate.nullable(),
}).strict().refine(r => r.period === 'custom' ? r.from !== null && r.to !== null && customRangeError(r.from, r.to) === null : r.from === null && r.to === null);

export const salesSummarySchema = z.object({
  cafeteria_id: z.guid(), tenant_kind: z.enum(['customer', 'sandbox']), kind: z.literal('sales_summary'),
  period: z.enum(reportPeriods), from: isoDate, to: isoDate, today: isoDate, business_timezone: z.string().min(1), currency_code: z.string().min(3),
  data: z.object({
    gross_sales_minor: amount, refunds_minor: amount, net_sales_minor: signed,
    transaction_count: count, refund_count: count, average_ticket_minor: amount.nullable(),
    refunds_by_tender: z.object({ cash: amount, student_wallet: amount }).strict(),
    tenders: z.array(z.object({ tender: z.enum(['cash', 'student_wallet', 'staff_credit']), transaction_count: count, gross_sales_minor: amount }).strict()).length(3),
  }).strict(),
}).strict();
export type SalesSummary = z.infer<typeof salesSummarySchema>;

// 5D.2: event-period units. Net may be negative (refund-only period); it is never clamped.
const productRow = z.object({
  rank: z.number().int().min(1).max(10), product_id: z.guid(), product_name: z.string().min(1),
  gross_units: count, refunded_units: count, net_units: z.number().int(),
}).strict().refine(r => r.net_units === r.gross_units - r.refunded_units);
export const topProductsSchema = salesSummarySchema.omit({ kind: true, data: true }).extend({
  kind: z.literal('top_products'),
  data: z.object({ products: z.array(productRow).max(10), product_count: count, refunds_without_item_detail: count }).strict()
    .refine(d => d.products.every((p, i) => p.rank === i + 1) && d.product_count >= d.products.length),
}).strict();
export type TopProducts = z.infer<typeof topProductsSchema>;
export const reportResultSchema = { sales_summary: salesSummarySchema, top_products: topProductsSchema } as const;

// Latest-request gate: only the most recent request for a report section may update it.
export function latestGate() { let current = 0; return { next: () => ++current, isCurrent: (token: number) => token === current }; }

export const reportErrors: Record<string, string> = {
  report_range_too_long: `El período personalizado no puede superar ${maxReportDays} días.`,
  invalid_report_range: 'El período seleccionado no es válido.',
  invalid_report_period: 'El período seleccionado no es válido.',
};
