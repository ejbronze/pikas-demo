import { classifyError, type FailureKind } from "../ux/state-classes";
import { z } from "zod";
import { readSchema, type SchoolRead } from "./contracts";
import { exportResultSchema, type ExportStudent } from "./student-export";
import { walletReportSchema, type WalletReportView } from "./wallet-report";
import { serviceRows, type ServiceRow } from "./overview";
import { reportErrors } from "../cafeteria/reports";
import { one, type PeriodFilter, type SearchParams } from "../reports/filters";
import { csvAmount, csvDocument } from "../reports/csv";

// PIKAS UX 8 School Reportes. Every report reads through an existing School read under the School's own
// authority (no migration, no new capability) and is reduced here, on the server. The page and its CSV
// call the same loader, so the export always matches what the report shows. No cafetería commercial
// data, purchases or per-student spending: School sees its students and its service relationships.
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
// UX 14: a failed load names its kind (lib/ux/state-classes) so the page can say what happened.
export type Loaded<T> = { status: "ok"; value: T } | { status: "too_many" } | { status: "error"; message?: string; kind?: FailureKind };
const statuses = ["active", "suspended", "inactive"] as const;
export const studentStatusLabel = { active: "Activo", suspended: "Suspendido", inactive: "Inactivo" } as const;

// ── Estudiantes ───────────────────────────────────────────────────────────────────────────────────
// Same filter names as the Estudiantes roster (UX 5): status, location (campus), grade.
const studentFilters = z.object({ status: z.enum(["", ...statuses]), location: z.guid().nullable(), grade: z.string().trim().min(1).max(80).nullable() });
export type StudentFilters = z.infer<typeof studentFilters>;
export const parseStudentFilters = (p: SearchParams) => studentFilters.safeParse({ status: one(p.status) ?? "", location: one(p.location) || null, grade: one(p.grade) || null });
export type StudentsReport = { rows: ExportStudent[]; counts: Record<"total" | (typeof statuses)[number], number>; byGrade: { grade: string | null; count: number }[];
  locations: { id: string; name: string }[]; grades: string[] };

// Full filtered result through school_student_export (school:students:read, at most 1,000 rows, never
// truncated); filter options from the roster read. Ordered by name for reading.
export async function loadStudentsReport(client: Rpc, schoolId: string, actorId: string, f: StudentFilters): Promise<Loaded<StudentsReport>> {
  const [exported, options] = await Promise.all([
    client.rpc("school_student_export", { p_school_id: schoolId, p_query: "", p_status: f.status, p_location_id: f.location, p_grade: f.grade }),
    client.rpc("school_student_roster", { p_school_id: schoolId, p_query: "", p_status: "", p_after: null, p_limit: 1, p_location_id: null, p_grade: null }),
  ]);
  if (exported.error?.code === "54000") return { status: "too_many" };
  const result = exportResultSchema.safeParse(exported.data), opts = readSchema.safeParse(options.data);
  if (exported.error || !result.success || result.data.school_id !== schoolId || result.data.actor_id !== actorId) return { status: "error", kind: exported.error ? classifyError(exported.error) : "temporary" };
  const rows = [...result.data.rows].sort((a, b) => a.display_name.localeCompare(b.display_name, "es") || a.student_code.localeCompare(b.student_code));
  const groups = new Map<string | null, number>(); for (const r of rows) groups.set(r.grade, (groups.get(r.grade) ?? 0) + 1);
  const byGrade = [...groups].map(([grade, count]) => ({ grade, count })).sort((a, b) => a.grade === null ? 1 : b.grade === null ? -1 : a.grade.localeCompare(b.grade, "es", { numeric: true }));
  const own = !options.error && opts.success && opts.data.scope.school_id === schoolId && opts.data.scope.actor_id === actorId;
  return { status: "ok", value: { rows, byGrade, locations: own ? opts.data.locations : [], grades: own ? opts.data.grades ?? [] : [],
    counts: { total: rows.length, active: rows.filter(r => r.status === "active").length, suspended: rows.filter(r => r.status === "suspended").length, inactive: rows.filter(r => r.status === "inactive").length } } };
}
export const studentsCsv = (rows: ExportStudent[]) => csvDocument(["Nombre completo", "Código estudiantil", "Estado", "Campus / sede", "Grado", "Sección", "Aula / grupo"],
  rows.map(r => [r.display_name, r.student_code, studentStatusLabel[r.status], r.campus, r.grade, r.class, r.homeroom]));

// ── PIKAS Cash ────────────────────────────────────────────────────────────────────────────────────
// school_wallet_report (school:wallets:read): period aggregates from the school's wallet ledger. The
// per-cafetería breakdown is validated with the whole result and then dropped (UX 7 boundary).
export async function loadWalletReport(client: Rpc, schoolId: string, p: PeriodFilter): Promise<Loaded<WalletReportView>> {
  const { data, error } = await client.rpc("school_wallet_report", { p_school_id: schoolId, p_period: p.period, p_from: p.from, p_to: p.to });
  if (error) return { status: "error", kind: classifyError(error), message: error.code === "22023" && error.message ? reportErrors[error.message] : undefined };
  const parsed = walletReportSchema.safeParse(data);
  if (!parsed.success || parsed.data.school_id !== schoolId || parsed.data.period !== p.period) return { status: "error", kind: "temporary" };
  const { cafeterias, ...report } = parsed.data; void cafeterias;
  return { status: "ok", value: report };
}
// The movement lines, in reading order; the last line is the period's net movement.
export function walletLines(r: WalletReportView) {
  const m = r.movements, neg = (v: string) => v === "0" ? "0" : `-${v}`;
  return [
    { key: "replenishments", label: "Recargas", count: m.replenishments.count, minor: m.replenishments.amount_minor },
    { key: "reversals", label: "Reversiones de recarga", count: m.reversals.count, minor: neg(m.reversals.amount_minor) },
    { key: "net_replenished", label: "Recargas netas", count: null, minor: m.net_replenished_minor, subtotal: true },
    { key: "purchases", label: "Compras con PIKAS Cash", count: m.purchases.count, minor: neg(m.purchases.amount_minor) },
    { key: "refunds", label: "Reembolsos a PIKAS Cash", count: m.refunds.count, minor: m.refunds.amount_minor },
    { key: "adjustment_credits", label: "Ajustes administrativos (aumentos)", count: m.adjustment_credits.count, minor: m.adjustment_credits.amount_minor },
    { key: "adjustment_debits", label: "Ajustes administrativos (disminuciones)", count: m.adjustment_debits.count, minor: neg(m.adjustment_debits.amount_minor) },
    ...(m.historical_adjustments.count > 0 ? [{ key: "historical", label: "Ajustes históricos", count: m.historical_adjustments.count, minor: m.historical_adjustments.net_minor }] : []),
  ] as { key: string; label: string; count: number | null; minor: string; subtotal?: boolean }[];
}
export const walletCsv = (r: WalletReportView) => csvDocument(["Desde", "Hasta", "Concepto", "Movimientos", "Monto (RD$)"],
  [...walletLines(r).map(l => [r.from, r.to, l.label, l.count === null ? "" : String(l.count), csvAmount(l.minor)]),
   [r.from, r.to, "Movimiento neto del período", String(r.movements.entry_count), csvAmount(r.movements.net_movement_minor)]]);

// ── Cafeterías conectadas ─────────────────────────────────────────────────────────────────────────
// school_admin_read 'cafeterias' (school:sharing:read): the school's service relationships. Student
// names in the read are reduced to a count (UX 4 serviceRows); no sales, products or caja data exists here.
export const shareCategories = { basic_identification: "Identificación básica", student_code: "Código estudiantil", placement: "Grado y campus", dietary_restrictions: "Restricciones alimentarias" } as const;
export type ServiceReportRow = ServiceRow & { shared: string[] };
type CafeteriaReadRow = Extract<NonNullable<SchoolRead["rows"]>[number], { sharing_status: unknown }>;
export async function loadServiceReport(client: Rpc, schoolId: string, actorId: string): Promise<Loaded<ServiceReportRow[]>> {
  const r = await client.rpc("school_admin_read", { p_school_id: schoolId, p_section: "cafeterias", p_query: "", p_status: "", p_after: null, p_limit: 50 });
  const p = readSchema.safeParse(r.data);
  if (r.error || !p.success || p.data.scope.school_id !== schoolId || p.data.scope.actor_id !== actorId) return { status: "error", kind: r.error ? classifyError(r.error) : "temporary" };
  const raw = (p.data.rows ?? []).filter((x): x is CafeteriaReadRow => "sharing_status" in x);
  const rows = serviceRows(raw).map((s, i) => ({ ...s, shared: s.sharing ? raw[i].categories.filter((c): c is keyof typeof shareCategories => c in shareCategories).map(c => shareCategories[c]) : [] }));
  return { status: "ok", value: rows.sort((a, b) => a.name.localeCompare(b.name, "es")) };
}
export const enabledText = (r: ServiceRow) => r.enabled_capped ? `${r.enabled_students}+` : String(r.enabled_students);
export const serviceCsv = (rows: ServiceReportRow[]) => csvDocument(["Cafetería", "Sede", "Estado", "Compartición con el colegio", "Información compartida", "Estudiantes habilitados"],
  rows.map(r => [r.name, r.location, r.active ? "Activa" : "Inactiva", r.sharing ? "Activa" : "Sin compartición", r.shared.join("; "), enabledText(r)]));
