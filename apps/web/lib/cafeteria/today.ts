import { z } from 'zod';
import type { Reconciliation, SalesSummary } from './reports';

// Cafetería Hoy V1 contract (public.cafeteria_today_read). Totals, tender mix, top products and
// reconciliation still come from cafeteria_report_read; this read adds the hourly shape, the
// same-weekday/same-time baseline and the last/first sale. The browser derives presentation only
// (which comparison is meaningful, the chart window, attention wording), never financial values.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const amount = z.string().regex(/^(0|[1-9][0-9]*)$/);
const count = z.number().int().min(0);
const hour = z.object({ hour: z.number().int().min(0).max(23), today_gross_minor: amount, today_count: count, baseline_gross_minor: amount, baseline_count: count }).strict();
export const todayRequestSchema = z.object({ cafeteria_id: z.guid() }).strict();
export const todaySchema = z.object({
  cafeteria_id: z.guid(), tenant_kind: z.enum(['customer', 'sandbox']), today: isoDate, baseline_date: isoDate, as_of_local: localTime,
  business_timezone: z.string().min(1), currency_code: z.string().min(3),
  data: z.object({
    today_gross_minor: amount, today_count: count,
    baseline: z.object({ day_count: count, to_cutoff_gross_minor: amount, to_cutoff_count: count }).strict(),
    hours: z.array(hour).length(24).refine(h => h.every((x, i) => x.hour === i)),
    last_sale: z.object({ purchased_at: z.string(), purchased_local: localTime, business_date: isoDate, register_name: z.string() }).strict().nullable(),
    first_sale_date: isoDate.nullable(),
  }).strict(),
}).strict();
export type TodayRead = z.infer<typeof todaySchema>;

// Business dates are plain calendar dates; never convert them through the browser timezone.
const utcDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
export const weekdayName = (iso: string) => utcDate(iso).toLocaleDateString('es-DO', { weekday: 'long', timeZone: 'UTC' });
export const longDate = (iso: string) => { const s = utcDate(iso).toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); return s.charAt(0).toUpperCase() + s.slice(1); };
export const clock = (local: string) => local.slice(11, 16);
export const hourLabel = (h: number) => `${h}:00`;

// Same weekday last week, cut at the same local time. A percentage is shown only when both sides
// have enough sales for it to mean something; otherwise the baseline is shown as a plain amount,
// and with no baseline sales at all nothing is shown (never a fake 0 %).
export const minComparableSales = 5;
export type Comparison =
  | { kind: 'none' }
  | { kind: 'reference'; weekday: string; baselineMinor: string }
  | { kind: 'delta'; weekday: string; baselineMinor: string; percent: number };
export function comparison(t: TodayRead): Comparison {
  const b = t.data.baseline;
  if (b.day_count === 0) return { kind: 'none' };
  const weekday = weekdayName(t.baseline_date);
  if (t.data.today_count < minComparableSales || b.to_cutoff_count < minComparableSales) return { kind: 'reference', weekday, baselineMinor: b.to_cutoff_gross_minor };
  const base = Number(b.to_cutoff_gross_minor), now = Number(t.data.today_gross_minor);
  return { kind: 'delta', weekday, baselineMinor: b.to_cutoff_gross_minor, percent: Math.round(((now - base) / base) * 100) };
}

// Chart window: the school day (from 7:00) to the later of now and the last hour with activity on
// either day, widened to at least six hours so a single active hour still reads as part of a day.
export function chartWindow(t: TodayRead) {
  const active = t.data.hours.filter(h => h.today_count > 0 || h.baseline_count > 0).map(h => h.hour);
  const now = Number(t.as_of_local.slice(11, 13));
  const start = Math.min(7, ...active);
  const end = Math.min(23, Math.max(now, start + 5, ...active));
  return t.data.hours.slice(start, end + 1);
}
export function peakHour(t: TodayRead) {
  return t.data.hours.reduce<TodayRead['data']['hours'][number] | null>((best, h) => h.today_count > 0 && (!best || BigInt(h.today_gross_minor) > BigInt(best.today_gross_minor)) ? h : best, null);
}

// Share of today's gross by tender, in whole percent, from the 5D.1 tender rows.
export const tenderOrder = ['student_wallet', 'cash', 'staff_credit'] as const;
export function tenderShares(s: SalesSummary) {
  const gross = BigInt(s.data.gross_sales_minor);
  return tenderOrder.map(tender => { const row = s.data.tenders.find(x => x.tender === tender)!;
    return { tender, gross_minor: row.gross_sales_minor, count: row.transaction_count, percent: gross === 0n ? 0 : Number((BigInt(row.gross_sales_minor) * 1000n) / gross) / 10 }; });
}

// Requiere atención: only real signals PIKAS records. Open sessions started before today, and
// closes of the last 7 business days that did not balance or were closed without a cash count.
export type AttentionItem = { id: string; tone: 'serious' | 'warning'; text: string; action: 'cajas' | 'reportes' };
export function attentionItems(today: string, recon: Reconciliation | null, money: (minor: string) => string): AttentionItem[] {
  if (!recon) return [];
  const stale = recon.data.open_sessions.filter(s => s.opened_local.slice(0, 10) < today).map<AttentionItem>(s => ({ id: `open:${s.session_id}`, tone: 'serious', action: 'cajas',
    text: `${s.register_name} abierta desde el ${weekdayName(s.opened_local)} ${s.opened_local.slice(8, 10)}/${s.opened_local.slice(5, 7)}${s.operator_name ? ` (${s.operator_name})` : ''}` }));
  const closes = recon.data.closed_sessions.filter(s => s.status !== 'balanced').map<AttentionItem>(s => {
    const day = s.closed_business_date === today ? 'de hoy' : `del ${weekdayName(s.closed_business_date)}`;
    const amount = s.difference_minor ? money(s.difference_minor.replace('-', '')) : '';
    const what = s.status === 'shortage' ? `con faltante de ${amount}` : s.status === 'overage' ? `con sobrante de ${amount}` : 'sin efectivo contado';
    return { id: `close:${s.session_id}`, tone: s.status === 'uncaptured' ? 'warning' : 'serious', action: 'reportes', text: `Cierre ${day} ${what} (${s.register_name})` };
  });
  return [...stale, ...closes];
}
