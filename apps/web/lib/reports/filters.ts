import { customRangeError, reportPeriods, type ReportPeriod } from "../cafeteria/reports";

// PIKAS reporting convention (UX 8), shared by Platform, School and Cafetería reports. A report's state
// lives in the URL (?period=&from=&to= plus the report's own filters), so a dashboard figure can link to
// the exact filtered report and the report survives reload. Parameters are parsed on the server; an
// invalid value is reported, never silently widened. Sharing this convention never shares authority:
// each role's report reads only through that role's own reads.
export type SearchParams = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined) => typeof v === "string" ? v : undefined;

export const periodLabels: Record<ReportPeriod, string> = { today: "Hoy", last_7_days: "Últimos 7 días", last_30_days: "Últimos 30 días", custom: "Personalizado" };
export type PeriodFilter = { period: ReportPeriod; from: string | null; to: string | null };
export type PeriodParse = { ok: true; value: PeriodFilter } | { ok: false; invalid: boolean; error: string; draft: { from: string; to: string } };

// Hoy / Últimos 7 días / Últimos 30 días / Personalizado (at most 92 days), the accepted 5D behavior.
export function parsePeriod(params: SearchParams, fallback: ReportPeriod): PeriodParse {
  const period = one(params.period) ?? fallback, draft = { from: one(params.from) ?? "", to: one(params.to) ?? "" };
  if (!(reportPeriods as readonly string[]).includes(period)) return { ok: false, invalid: true, error: "El período no es válido.", draft };
  if (period !== "custom") return { ok: true, value: { period: period as ReportPeriod, from: null, to: null } };
  const error = customRangeError(draft.from, draft.to);
  return error ? { ok: false, invalid: false, error, draft } : { ok: true, value: { period: "custom", ...draft } };
}

// Builds a report URL from its filters; empty values are left out so the URL stays readable.
export function reportHref(path: string, params: Record<string, string | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  return `${path}?${query}`;
}

// Business dates are plain calendar dates; never convert them through a browser timezone.
export const reportDay = (iso: string) => iso.split("-").reverse().join("/");
export const generatedAt = (date = new Date()) => date.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
