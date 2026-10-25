import { z } from "zod";
import { attentionItems, launchLabel, launchStatus, readinessSteps, type CustomerReadiness, type LaunchStatus, type Readiness, type Step, type StepKey } from "./readiness";
import { statusLabel } from "./customer-contracts";
import { one, type SearchParams } from "../reports/filters";
import { csvAmount, csvDocument } from "../reports/csv";
import { reportPeriods } from "../cafeteria/reports";

// PIKAS Platform Reportes (Reporting Consolidation; carried from paused UX 10 and reconciled).
// Clientes: puesta en marcha from platform_customer_readiness (the read behind the Inicio cockpit, so a cockpit figure
// and its report list the same customers) plus the lifecycle footprint from platform_network_report.
// Red y adopción: platform_network_report — per cafetería, the released readiness facts and period activity.
// Finanzas (resumen): platform_finance_report, platform:finance:read only.
// Real customers only unless `demo=1` is explicitly chosen; every report then says so. Lifecycle (active / suspended /
// closed), operational readiness, student service and financial activation are separate dimensions, never one score.

// ── Filters ───────────────────────────────────────────────────────────────────────────────────────
const stepKeys = ["perfil", "estructura", "administrador", "personal", "cajas", "productos", "venta"] as const satisfies readonly StepKey[];
const flag = z.enum(["", "1"]);
const customerFilters = z.object({
  q: z.string().trim().max(80),
  status: z.enum(["", "active", "suspended", "closed"]),
  readiness: z.enum(["", "configuring", "ready", "operating"]),
  step: z.enum(["", ...stepKeys]),
  attention: flag,
  demo: flag,
});
export type CustomerFilters = z.infer<typeof customerFilters>;
export const parseCustomerFilters = (p: SearchParams) => customerFilters.safeParse({ q: one(p.q) ?? "", status: one(p.status) ?? "", readiness: one(p.readiness) ?? "", step: one(p.step) ?? "",
  attention: one(p.attention) ?? "", demo: one(p.demo) ?? "" });
export const networkFilters = z.object({ period: z.enum(reportPeriods), from: z.string().nullable(), to: z.string().nullable(), demo: flag });
export const lifecycleLabel = (s: string) => statusLabel[s] ?? s;
export const stepLabel: Record<StepKey, string> = { perfil: "Perfil", estructura: "Estructura", administrador: "Administrador", personal: "Personal POS", cajas: "Cajas", productos: "Productos", venta: "Primera venta" };

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────
const count = z.number().int().min(0), day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const studentServiceStates = ["not_shared", "sharing_revoked", "identification_not_shared", "no_students", "no_students_enabled", "ready"] as const;
const periodSchema = z.object({ period: z.enum(reportPeriods), from: day, to: day, today: day, timezone: z.literal("America/Santo_Domingo") });
export const networkCafeteriaSchema = z.object({
  cafeteria_id: z.guid(), name: z.string(), school: z.string(), location: z.string(), status: z.enum(["active", "suspended", "inactive"]), operating: z.boolean(),
  registers_active: count, registers_inactive: count, registers_staffed: count, products_available: count, scheduling_enabled: z.boolean(), shifts_enabled: count,
  operationally_ready: z.boolean(), student_service: z.enum(studentServiceStates), enabled_students: count, sales: count, students_served: count, last_sale_at: z.string().nullable(),
});
export type NetworkCafeteria = z.infer<typeof networkCafeteriaSchema>;
export const networkCustomerSchema = z.object({
  account_id: z.guid(), name: z.string(), code: z.string(), status: z.string(), demo: z.boolean(), created_at: z.string(),
  schools: z.object({ active: count, other: count }), locations: z.object({ active: count, inactive: count }), cafeterias: z.array(networkCafeteriaSchema),
});
export type NetworkCustomer = z.infer<typeof networkCustomerSchema>;
export const networkReportSchema = z.object({ period: periodSchema, include_demo: z.boolean(), customers: z.array(networkCustomerSchema), truncated: z.boolean() });
export type NetworkReport = z.infer<typeof networkReportSchema>;
const minor = z.string().regex(/^-?\d+$/);
export const financeReportSchema = z.object({
  period: periodSchema,
  activations: z.array(z.object({ customer: z.string(), code: z.string(), status: z.enum(["active", "ended"]), activated_at: z.string(), ended_at: z.string().nullable(), policy_version: z.number().int(), fee_bps: z.number().int() })),
  replenishments: z.array(z.object({ method: z.enum(["bank_transfer", "cafeteria_cash"]), count, gross_minor: minor, fee_minor: minor, net_minor: minor })),
  reversals: z.object({ count, net_minor: minor }),
  settlements: z.object({ due: count, in_review: count, overdue: count, cafeterias_owe_minor: minor, pikas_owes_minor: minor, settled_in_period: count }),
  ready_periods: count,
  unsettled_obligations: z.object({ cafeterias_owe_minor: minor, pikas_owes_minor: minor, count }),
});
export type FinanceReport = z.infer<typeof financeReportSchema>;

// ── Clientes rows ─────────────────────────────────────────────────────────────────────────────────
export type Footprint = { schools: { active: number; other: number }; locations: { active: number; inactive: number };
  cafeterias: { active: number; suspended: number; inactive: number }; registers: { active: number; inactive: number } };
export const footprintOf = (c: NetworkCustomer): Footprint => ({ schools: c.schools, locations: c.locations,
  cafeterias: { active: c.cafeterias.filter(x => x.status === "active").length, suspended: c.cafeterias.filter(x => x.status === "suspended").length, inactive: c.cafeterias.filter(x => x.status === "inactive").length },
  registers: { active: c.cafeterias.reduce((a, x) => a + x.registers_active, 0), inactive: c.cafeterias.reduce((a, x) => a + x.registers_inactive, 0) } });
export type CustomerRow = { id: string; name: string; code: string; status: string; demo: boolean; customer: CustomerReadiness | null; steps: Step[]; launch: LaunchStatus | "demo";
  complete: number; next: Step | null; attention: boolean; footprint: Footprint | null; firstSale: string | null; lastSale: string | null };
// Real customers come from the readiness read (puesta en marcha); a Demo row (only with demo=1) comes from the network read and
// has no puesta en marcha: it is a demonstration, never counted as configuring, ready or operating.
export function customerRows(r: Readiness, network: NetworkReport | null): CustomerRow[] {
  const flagged = new Set(attentionItems(r.customers).map(a => a.customer.account_id)), byId = new Map(network?.customers.map(c => [c.account_id, c]) ?? []);
  const real = r.customers.map(c => { const steps = readinessSteps(c), launch = launchStatus(c, steps), n = byId.get(c.account_id);
    return { id: c.account_id, name: c.name, code: c.code, status: c.status, demo: false, customer: c, steps, launch, complete: steps.filter(s => s.state === "complete").length,
      next: steps.find(s => s.state !== "complete") ?? null, attention: flagged.has(c.account_id), footprint: n ? footprintOf(n) : null, firstSale: c.sales.first_at, lastSale: c.sales.last_at }; });
  const demo = (network?.customers ?? []).filter(c => c.demo).map(c => ({ id: c.account_id, name: c.name, code: c.code, status: c.status, demo: true, customer: null, steps: [], launch: "demo" as const,
    complete: 0, next: null, attention: false, footprint: footprintOf(c), firstSale: null, lastSale: c.cafeterias.map(x => x.last_sale_at).filter(Boolean).sort().at(-1) ?? null }));
  return [...real, ...demo];
}
// step=X: active customers whose step X is not complete — the customers behind a "pending" count.
export function filterRows(rows: CustomerRow[], f: CustomerFilters) {
  const q = f.q.toLowerCase();
  return rows.filter(r => (f.demo === "1" || !r.demo) && (!q || `${r.name} ${r.code}`.toLowerCase().includes(q))
    && (!f.status || r.status === f.status)
    && (!f.readiness || r.launch === f.readiness)
    && (!f.step || (!r.demo && r.launch !== "inactive" && r.steps.find(s => s.key === f.step)!.state !== "complete"))
    && (!f.attention || r.attention))
    .sort((a, b) => Number(a.demo) - Number(b.demo) || a.name.localeCompare(b.name, "es") || a.code.localeCompare(b.code));
}
export const launchCounts = (rows: CustomerRow[]) => ({ configuring: rows.filter(r => r.launch === "configuring").length, ready: rows.filter(r => r.launch === "ready").length,
  operating: rows.filter(r => r.launch === "operating").length, inactive: rows.filter(r => r.launch === "inactive").length });
export const lifecycleCounts = (rows: CustomerRow[]) => ({ active: rows.filter(r => r.status === "active").length, suspended: rows.filter(r => r.status === "suspended").length,
  closed: rows.filter(r => r.status === "closed").length, other: rows.filter(r => !["active", "suspended", "closed"].includes(r.status)).length });
export const launchText = (r: CustomerRow) => r.launch === "demo" ? "Demo (no se cuenta)" : r.launch === "inactive" ? "Fuera de operación" : launchLabel[r.launch];

// ── Red y adopción ────────────────────────────────────────────────────────────────────────────────
// Over cafeterías EN OPERACIÓN (active cafetería, in an active sede of an active colegio) of ACTIVE customers.
// Each figure is its own released definition; none is folded into a score:
//   lista para operar   — ≥1 caja activa con personal de caja activo asignado, ≥1 producto disponible y, si la cafetería
//                         usa turnos, ≥1 turno habilitado (never "had a first sale");
//   servicio a estudiantes listo — the UX 13B rule: the colegio shares the cafetería with «Identificación básica» and has
//                         enabled at least one active student;
//   con ventas          — ≥1 confirmed purchase whose business date falls in the period.
export type NetworkRow = { customer: NetworkCustomer; cafeteria: NetworkCafeteria };
export function networkRows(r: NetworkReport): NetworkRow[] {
  return r.customers.filter(c => c.status === "active").flatMap(c => c.cafeterias.filter(x => x.operating).map(x => ({ customer: c, cafeteria: x })))
    .sort((a, b) => Number(a.customer.demo) - Number(b.customer.demo) || a.customer.name.localeCompare(b.customer.name, "es") || a.cafeteria.name.localeCompare(b.cafeteria.name, "es"));
}
export function networkTotals(r: NetworkReport) {
  const active = r.customers.filter(c => c.status === "active"), rows = networkRows(r);
  return {
    customers: active.length, demoCustomers: active.filter(c => c.demo).length,
    schools: active.reduce((a, c) => a + c.schools.active, 0), locations: active.reduce((a, c) => a + c.locations.active, 0),
    cafeterias: rows.length, registers: rows.reduce((a, x) => a + x.cafeteria.registers_active, 0), staffedRegisters: rows.reduce((a, x) => a + x.cafeteria.registers_staffed, 0),
    ready: rows.filter(x => x.cafeteria.operationally_ready).length, studentService: rows.filter(x => x.cafeteria.student_service === "ready").length,
    enabledStudents: rows.reduce((a, x) => a + x.cafeteria.enabled_students, 0),
    withSales: rows.filter(x => x.cafeteria.sales > 0).length, sales: rows.reduce((a, x) => a + x.cafeteria.sales, 0),
    customersWithSales: active.filter(c => c.cafeterias.some(x => x.operating && x.sales > 0)).length,
    dormant: rows.filter(x => x.cafeteria.sales === 0), rows,
  };
}
export const studentServiceLabel: Record<NetworkCafeteria["student_service"], string> = {
  ready: "Listo", no_students_enabled: "Sin estudiantes habilitados", no_students: "El colegio no tiene estudiantes", identification_not_shared: "Sin «Identificación básica»",
  sharing_revoked: "Compartición revocada", not_shared: "No compartida",
};
// Why a cafetería is not operationally ready, in the order the released setup map asks for it.
export function readinessGap(x: NetworkCafeteria): string | null {
  if (x.operationally_ready) return null;
  if (x.registers_active === 0) return "Sin caja activa";
  if (x.registers_staffed === 0) return "Ninguna caja tiene personal asignado";
  if (x.products_available === 0) return "Sin productos disponibles";
  if (x.scheduling_enabled && x.shifts_enabled === 0) return "Usa turnos y no tiene ninguno habilitado";
  return "No está en operación";
}

// ── CSV (same rows, same scope as the page; human identifiers, no internal ids) ────────────────────
const localDay = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }) : null;
export const customersCsv = (rows: CustomerRow[]) => csvDocument(["Cliente", "Código", "Demo", "Ciclo de vida", "Puesta en marcha", "Pasos completos", "Siguiente paso", "Colegios activos", "Sedes activas",
  "Sedes inactivas", "Cafeterías activas", "Cafeterías suspendidas", "Cafeterías inactivas", "Cajas activas", "Cajas inactivas", "Primera venta", "Última venta"],
  rows.map(r => [r.name, r.code, r.demo ? "Sí" : "No", lifecycleLabel(r.status), launchText(r), r.demo ? null : `${r.complete} de ${r.steps.length}`,
    r.demo || r.launch === "inactive" || !r.next ? null : r.next.label, ...(r.footprint ? [String(r.footprint.schools.active), String(r.footprint.locations.active), String(r.footprint.locations.inactive),
      String(r.footprint.cafeterias.active), String(r.footprint.cafeterias.suspended), String(r.footprint.cafeterias.inactive), String(r.footprint.registers.active), String(r.footprint.registers.inactive)]
      : [null, null, null, null, null, null, null, null]), localDay(r.firstSale), localDay(r.lastSale)]));
export const networkCsv = (r: NetworkReport) => csvDocument(["Desde", "Hasta", "Cliente", "Código", "Demo", "Colegio", "Sede", "Cafetería", "Lista para operar", "Motivo", "Servicio a estudiantes",
  "Estudiantes habilitados", "Cajas activas", "Cajas con personal", "Productos disponibles", "Ventas en el período", "Estudiantes atendidos", "Última venta"],
  networkRows(r).map(({ customer: c, cafeteria: x }) => [r.period.from, r.period.to, c.name, c.code, c.demo ? "Sí" : "No", x.school, x.location, x.name, x.operationally_ready ? "Sí" : "No",
    readinessGap(x), studentServiceLabel[x.student_service], String(x.enabled_students), String(x.registers_active), String(x.registers_staffed), String(x.products_available),
    String(x.sales), String(x.students_served), localDay(x.last_sale_at)]));
export const financeCsv = (f: FinanceReport) => csvDocument(["Desde", "Hasta", "Concepto", "Cantidad", "Monto (RD$)"], [
  ...f.replenishments.map(r => [f.period.from, f.period.to, r.method === "cafeteria_cash" ? "Recargas en efectivo (bruto)" : "Transferencias verificadas (bruto)", String(r.count), csvAmount(r.gross_minor)]),
  ...f.replenishments.map(r => [f.period.from, f.period.to, r.method === "cafeteria_cash" ? "Cargo PIKAS · efectivo" : "Cargo PIKAS · transferencias", String(r.count), csvAmount(r.fee_minor)]),
  [f.period.from, f.period.to, "Reversiones", String(f.reversals.count), csvAmount(f.reversals.net_minor)],
  [f.period.from, f.period.to, "Liquidaciones pendientes: las cafeterías deben a PIKAS", String(f.settlements.due + f.settlements.in_review), csvAmount(f.settlements.cafeterias_owe_minor)],
  [f.period.from, f.period.to, "Liquidaciones pendientes: PIKAS debe a las cafeterías", null, csvAmount(f.settlements.pikas_owes_minor)],
  [f.period.from, f.period.to, "Obligaciones sin liquidar: las cafeterías deben", String(f.unsettled_obligations.count), csvAmount(f.unsettled_obligations.cafeterias_owe_minor)],
  [f.period.from, f.period.to, "Obligaciones sin liquidar: PIKAS debe", null, csvAmount(f.unsettled_obligations.pikas_owes_minor)],
]);
