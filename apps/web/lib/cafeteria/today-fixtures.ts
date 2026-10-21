import type { TodayRead } from './today';
// Fictional Cafetería Hoy read for focused tests: Tuesday 2026-10-20 at 12:40 in Santo Domingo.
// `today` / `baseline` are hour → [gross minor, count].
export const todayId = '4d300000-0000-4000-8000-000000000001';
export function todayRead({ today = {}, baseline = {}, cutoff = [0, 0], asOf = '2026-10-20T12:40', lastSale = null, firstSale = null }: {
  today?: Record<number, [number, number]>; baseline?: Record<number, [number, number]>; cutoff?: [number, number]; asOf?: string;
  lastSale?: TodayRead['data']['last_sale']; firstSale?: string | null;
} = {}): TodayRead {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, today_gross_minor: String(today[hour]?.[0] ?? 0), today_count: today[hour]?.[1] ?? 0,
    baseline_gross_minor: String(baseline[hour]?.[0] ?? 0), baseline_count: baseline[hour]?.[1] ?? 0 }));
  return { cafeteria_id: todayId, tenant_kind: 'customer', today: asOf.slice(0, 10), baseline_date: '2026-10-13', as_of_local: asOf, business_timezone: 'America/Santo_Domingo', currency_code: 'DOP',
    data: { today_gross_minor: String(hours.reduce((s, h) => s + Number(h.today_gross_minor), 0)), today_count: hours.reduce((s, h) => s + h.today_count, 0),
      baseline: { day_count: hours.reduce((s, h) => s + h.baseline_count, 0), to_cutoff_gross_minor: String(cutoff[0]), to_cutoff_count: cutoff[1] },
      hours, last_sale: lastSale, first_sale_date: firstSale } };
}
