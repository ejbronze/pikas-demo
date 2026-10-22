import { z } from "zod";
import { reportErrors, reportResultSchema, type ReportKind } from "./reports";
import { transactionsErrors, transactionsResultSchema, tenderLabel, refundStatusLabel, type RefundStatus, type TransactionTender } from "./transactions";
import { todaySchema, type TodayRead } from "./today";
import { one, type PeriodFilter, type SearchParams } from "../reports/filters";
import { csvAmount, csvDocument } from "../reports/csv";

// PIKAS UX 9 Cafetería Reportes. Every report reads through an existing Cafetería read under the
// Cafetería's own authority (no migration, no new capability): cafeteria_report_read (5D sales
// summary, top products, reconciliation), cafeteria_transactions_read (5D.4) and cafeteria_today_read
// (Hoy). Totals are the database's; nothing here adds money. Page and CSV call the same loaders.
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
export type Loaded<T> = { status: "ok"; value: T } | { status: "too_many" } | { status: "error"; message?: string };

// ── Filters ───────────────────────────────────────────────────────────────────────────────────────
// payment uses stable product words in the URL and maps to the stored tender.
export const payments = { cash: "cash", pikas_cash: "student_wallet", staff_credit: "staff_credit" } as const satisfies Record<string, TransactionTender>;
export type Payment = keyof typeof payments;
export const paymentOf = (t: TransactionTender) => (Object.keys(payments) as Payment[]).find(k => payments[k] === t)!;
const salesFilters = z.object({ payment: z.enum(["cash", "pikas_cash", "staff_credit"]).nullable(), page: z.coerce.number().int().min(1).max(40000) });
export type SalesFilters = z.infer<typeof salesFilters>;
export const parseSalesFilters = (p: SearchParams) => salesFilters.safeParse({ payment: one(p.payment) || null, page: one(p.page) ?? "1" });

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────
export async function loadReport<K extends ReportKind>(client: Rpc, cafeteriaId: string, kind: K, p: PeriodFilter): Promise<Loaded<z.infer<(typeof reportResultSchema)[K]>>> {
  const { data, error } = await client.rpc("cafeteria_report_read", { p_cafeteria_id: cafeteriaId, p_kind: kind, p_period: p.period, p_from: p.from, p_to: p.to });
  if (error) return { status: "error", message: error.code === "22023" && error.message ? reportErrors[error.message] : undefined };
  const parsed = reportResultSchema[kind].safeParse(data);
  if (!parsed.success || parsed.data.cafeteria_id !== cafeteriaId || parsed.data.kind !== kind || parsed.data.period !== p.period) return { status: "error" };
  return { status: "ok", value: parsed.data as z.infer<(typeof reportResultSchema)[K]> };
}
export async function loadToday(client: Rpc, cafeteriaId: string): Promise<TodayRead | null> {
  const { data, error } = await client.rpc("cafeteria_today_read", { p_cafeteria_id: cafeteriaId });
  const parsed = todaySchema.safeParse(data);
  return !error && parsed.success && parsed.data.cafeteria_id === cafeteriaId ? parsed.data : null;
}

// One page of sales (25), reduced for the report: receipt, time, caja, operator, payment, amounts and
// refund state. Customer names and internal ids stay on the server.
export type SaleRow = { receipt: string; date: string; time: string; register: string; operator: string; tender: TransactionTender; total_minor: string; refunded_minor: string; refund_status: RefundStatus };
export type SalesPage = { total: number; page_size: number; offset: number; rows: SaleRow[]; timezone: string };
const clockIn = (iso: string, tz: string) => new Intl.DateTimeFormat("es-DO", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
export async function loadSales(client: Rpc, cafeteriaId: string, p: PeriodFilter, tender: TransactionTender | null, offset: number): Promise<Loaded<SalesPage>> {
  const { data, error } = await client.rpc("cafeteria_transactions_read", { p_cafeteria_id: cafeteriaId, p_period: p.period, p_from: p.from, p_to: p.to, p_tender: tender, p_refund_status: null, p_receipt: null, p_offset: offset });
  if (error) return { status: "error", message: error.code === "22023" && error.message ? transactionsErrors[error.message] : undefined };
  const r = transactionsResultSchema.safeParse(data);
  if (!r.success || r.data.cafeteria_id !== cafeteriaId || r.data.period !== p.period || r.data.tender !== tender || r.data.offset !== offset || r.data.receipt !== null || r.data.refund_status !== null) return { status: "error" };
  const tz = r.data.business_timezone;
  return { status: "ok", value: { total: r.data.total_count, page_size: r.data.page_size, offset, timezone: tz, rows: r.data.data.map(x => ({ receipt: x.receipt_number, date: x.business_date, time: clockIn(x.purchased_at, tz),
    register: x.register_name, operator: x.operator_name, tender: x.tender, total_minor: x.total_minor, refunded_minor: x.refunded_minor, refund_status: x.refund_status })) } };
}

// The full filtered list for CSV: every page of the same read, never truncated. Above the cap, or if
// the set changed while paging (a sale landed mid-export), the export is refused instead of guessed.
export const salesExportLimit = 2000;
export async function loadAllSales(client: Rpc, cafeteriaId: string, p: PeriodFilter, tender: TransactionTender | null): Promise<Loaded<SaleRow[]>> {
  const first = await loadSales(client, cafeteriaId, p, tender, 0);
  if (first.status !== "ok") return first;
  if (first.value.total > salesExportLimit) return { status: "too_many" };
  const offsets = []; for (let o = first.value.page_size; o < first.value.total; o += first.value.page_size) offsets.push(o);
  const pages: Loaded<SalesPage>[] = [first];
  for (let i = 0; i < offsets.length; i += 8) pages.push(...await Promise.all(offsets.slice(i, i + 8).map(o => loadSales(client, cafeteriaId, p, tender, o))));
  if (pages.some(x => x.status !== "ok" || x.value.total !== first.value.total)) return { status: "error", message: "Las ventas cambiaron mientras se exportaban. Intenta de nuevo." };
  const rows = pages.flatMap(x => x.status === "ok" ? x.value.rows : []);
  if (new Set(rows.map(r => r.receipt)).size !== first.value.total || rows.length !== first.value.total) return { status: "error", message: "Las ventas cambiaron mientras se exportaban. Intenta de nuevo." };
  return { status: "ok", value: rows };
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────────
type Summary = z.infer<(typeof reportResultSchema)["sales_summary"]>;
type Products = z.infer<(typeof reportResultSchema)["top_products"]>;
type Recon = z.infer<(typeof reportResultSchema)["reconciliation"]>;
export const salesCsv = (rows: SaleRow[]) => csvDocument(["Recibo", "Fecha de operación", "Hora", "Caja", "Operador", "Método de pago", "Total (RD$)", "Reembolsado (RD$)", "Reembolso"],
  rows.map(r => [r.receipt, r.date, r.time, r.register, r.operator, tenderLabel[r.tender], csvAmount(r.total_minor), csvAmount(r.refunded_minor), refundStatusLabel[r.refund_status]]));
export const paymentsCsv = (s: Summary) => csvDocument(["Desde", "Hasta", "Método de pago", "Transacciones", "Ventas brutas (RD$)", "Reembolsos (RD$)"],
  s.data.tenders.map(t => [s.from, s.to, tenderLabel[t.tender], String(t.transaction_count), csvAmount(t.gross_sales_minor),
    t.tender === "staff_credit" ? null : csvAmount(s.data.refunds_by_tender[t.tender])]));
export const productsCsv = (r: Products) => csvDocument(["Desde", "Hasta", "Posición", "Producto", "Unidades vendidas", "Unidades reembolsadas", "Unidades netas"],
  r.data.products.map(p => [r.from, r.to, String(p.rank), p.product_name, String(p.gross_units), String(p.refunded_units), String(p.net_units)]));
export const closeStatusLabel = { balanced: "Cuadrada", shortage: "Faltante", overage: "Sobrante", uncaptured: "Sin conteo registrado" } as const;
export const cajasCsv = (r: Recon) => csvDocument(["Caja", "Código", "Estado", "Operador", "Abierta", "Cerrada", "Tipo de cierre", "Efectivo esperado (RD$)", "Efectivo contado (RD$)", "Diferencia (RD$)", "Resultado"],
  [...r.data.open_sessions.map(s => [s.register_name, s.register_code, "Abierta", s.operator_name, s.opened_local.replace("T", " "), null, null, csvAmount(s.expected_minor), null, null, null]),
   ...r.data.closed_sessions.map(s => [s.register_name, s.register_code, "Cerrada", s.operator_name, s.opened_local.replace("T", " "), s.closed_local.replace("T", " "), s.close_type === "normal" ? "Normal" : "Excepcional",
     s.expected_minor === null ? null : csvAmount(s.expected_minor), csvAmount(s.counted_minor), s.difference_minor === null ? null : csvAmount(s.difference_minor), closeStatusLabel[s.status]])]);
