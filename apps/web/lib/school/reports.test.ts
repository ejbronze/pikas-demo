import { describe, expect, it, vi } from "vitest";
import { walletReport } from "./report-fixtures";
import { loadServiceReport, loadStudentsReport, loadWalletReport, parseStudentFilters, serviceCsv, studentsCsv, walletCsv, walletLines } from "./reports";

const school = "4d800000-0000-4000-8000-000000000001", actor = "4d800000-0000-4000-8000-0000000000aa", other = "4d800000-0000-4000-8000-0000000000ff", loc = "4d800000-0000-4000-8000-0000000000b1";
const scope = (school_id = school, actor_id = actor) => ({ actor_id, membership_id: actor, role: "school_admin", account_id: actor, school_id, account_name: "Cuenta", school_name: "Colegio", tenant_kind: "customer" });
const row = (name: string, code: string, status: "active" | "suspended" | "inactive" = "active", grade: string | null = "4to") => ({ student_code: code, first_name: name, last_name: "Ficticia", display_name: `${name} Ficticia`, status, campus: grade ? "Sede Norte" : null, grade, class: grade ? "A" : null, homeroom: null as string | null });
const client = (impl: (fn: string, args: Record<string, unknown>) => unknown) => ({ rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => impl(fn, args) as { data: unknown; error: null }) });
describe("Reportes / Estudiantes loader", () => {
  const rows = [row("Zoe", "E3", "suspended", "5to"), row("Ana", "E1"), row("Beto", "E2", "inactive", null)];
  const rpc = (exportScope = school, rosterScope = scope()) => client(fn => fn === "school_student_export" ? { data: { school_id: exportScope, actor_id: actor, rows }, error: null }
    : { data: { scope: rosterScope, locations: [{ id: loc, name: "Sede Norte" }], grades: ["4to", "5to"], rows: [], next_cursor: null }, error: null });
  it("reads the full filtered result with the URL filters; summary, grade groups and rows reconcile", async () => {
    const c = rpc(), r = await loadStudentsReport(c, school, actor, { status: "", location: loc, grade: "4to" });
    expect(c.rpc).toHaveBeenCalledWith("school_student_export", { p_school_id: school, p_query: "", p_status: "", p_location_id: loc, p_grade: "4to" });
    if (r.status !== "ok") throw Error(r.status);
    expect(r.value.rows.map(x => x.display_name)).toEqual(["Ana Ficticia", "Beto Ficticia", "Zoe Ficticia"]);
    expect(r.value.counts).toEqual({ total: 3, active: 1, suspended: 1, inactive: 1 });
    expect(r.value.byGrade).toEqual([{ grade: "4to", count: 1 }, { grade: "5to", count: 1 }, { grade: null, count: 1 }]);
    expect(r.value.byGrade.reduce((a, g) => a + g.count, 0)).toBe(r.value.counts.total);
    expect(r.value.grades).toEqual(["4to", "5to"]); expect(r.value.locations).toEqual([{ id: loc, name: "Sede Norte" }]);
  });
  it("another school's export is discarded; another school's options are not shown", async () => {
    expect((await loadStudentsReport(rpc(other), school, actor, { status: "", location: null, grade: null })).status).toBe("error");
    const r = await loadStudentsReport(rpc(school, scope(other)), school, actor, { status: "", location: null, grade: null });
    expect(r.status === "ok" && r.value.locations).toEqual([]);
  });
  it("over 1,000 students is reported, never truncated", async () => {
    const c = client(fn => fn === "school_student_export" ? { data: null, error: { code: "54000", message: "student_export_limit" } } : { data: null, error: null });
    expect((await loadStudentsReport(c, school, actor, { status: "", location: null, grade: null })).status).toBe("too_many");
  });
  it("filters: status/location/grade only; invalid values are rejected", () => {
    expect(parseStudentFilters({ status: "active", grade: "4to" }).data).toEqual({ status: "active", location: null, grade: "4to" });
    expect(parseStudentFilters({ status: "deleted" }).success).toBe(false); expect(parseStudentFilters({ location: "x" }).success).toBe(false);
    expect(parseStudentFilters({ grade: "x".repeat(81) }).success).toBe(false);
  });
  it("CSV: readable headings, report rows only, no internal identifiers", () => {
    const csv = studentsCsv(rows);
    expect(csv.split("\r\n")[0]).toBe('﻿"Nombre completo","Código estudiantil","Estado","Campus / sede","Grado","Sección","Aula / grupo"');
    expect(csv).toContain('"Zoe Ficticia","E3","Suspendido","Sede Norte","5to","A",""'); expect(csv).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe("Reportes / PIKAS Cash loader", () => {
  it("drops the per-cafetería breakdown after validating the whole result", async () => {
    const c = client(() => ({ data: walletReport(), error: null })), r = await loadWalletReport(c, school, { period: "last_30_days", from: null, to: null });
    expect(c.rpc).toHaveBeenCalledWith("school_wallet_report", { p_school_id: school, p_period: "last_30_days", p_from: null, p_to: null });
    expect(r.status).toBe("ok"); expect(JSON.stringify(r)).not.toMatch(/Cafetería Comercial|spent_minor|cafeterias|purchase_count/);
  });
  it("discards another school's report, another period, and a sales-bearing result", async () => {
    for (const over of [{ school_id: other }, { period: "today" }, { gross_sales_minor: "1" }])
      expect((await loadWalletReport(client(() => ({ data: walletReport(over), error: null })), school, { period: "last_30_days", from: null, to: null })).status).toBe("error");
  });
  it("range errors keep their message", async () => {
    const c = client(() => ({ data: null, error: { code: "22023", message: "report_range_too_long" } }));
    expect(await loadWalletReport(c, school, { period: "custom", from: "2026-01-01", to: "2026-10-01" })).toMatchObject({ status: "error", message: expect.any(String) });
  });
  it("movement lines reconcile to the period's net movement; CSV carries only those lines", async () => {
    const r = await loadWalletReport(client(() => ({ data: walletReport(), error: null })), school, { period: "last_30_days", from: null, to: null });
    if (r.status !== "ok") throw Error();
    const lines = walletLines(r.value).filter(l => !l.subtotal), sum = lines.reduce((a, l) => a + BigInt(l.minor), 0n);
    expect(String(sum)).toBe(r.value.movements.net_movement_minor);
    expect(String(walletLines(r.value).filter(l => ["replenishments", "reversals"].includes(l.key)).reduce((a, l) => a + BigInt(l.minor), 0n))).toBe(r.value.movements.net_replenished_minor);
    const csv = walletCsv(r.value);
    expect(csv).toContain('"2026-09-22","2026-10-21","Compras con PIKAS Cash","2","-115.00"'); expect(csv).toContain('"Movimiento neto del período","10","134.00"');
    expect(csv).not.toMatch(/Cafetería|cafeter/i);
  });
});

describe("Reportes / Cafeterías conectadas loader", () => {
  const cafe = (name: string, sharing: "active" | "revoked", n: number) => ({ id: `4d800000-0000-4000-8000-0000000000${name.length}`, name, location: "Sede Norte", status: "active", sharing_status: sharing,
    categories: ["student_code", "basic_identification", "unknown_category"], customer_count: 999, customers: Array.from({ length: n }, (_, i) => ({ student_id: `4d800000-0000-4000-8000-${String(i).padStart(12, "0")}`, display_name: `Estudiante Privado ${i}`, status: "active" })) });
  const rpc = (s = scope()) => client(() => ({ data: { scope: s, locations: [], rows: [cafe("Cafetería Sur", "revoked", 0), cafe("Cafetería Norte", "active", 100)] }, error: null }));
  it("reduces student names to a count; shared information only while sharing is active", async () => {
    const c = rpc(), r = await loadServiceReport(c, school, actor);
    expect(c.rpc).toHaveBeenCalledWith("school_admin_read", expect.objectContaining({ p_school_id: school, p_section: "cafeterias" }));
    if (r.status !== "ok") throw Error();
    expect(r.value.map(x => [x.name, x.sharing, x.enabled_students, x.enabled_capped, x.shared])).toEqual([["Cafetería Norte", true, 100, true, ["Código estudiantil", "Identificación básica"]], ["Cafetería Sur", false, 0, false, []]]);
    const out = JSON.stringify(r) + serviceCsv(r.value);
    expect(out).not.toMatch(/Estudiante Privado|customer_count|999|unknown_category/); expect(serviceCsv(r.value)).toContain('"Cafetería Norte","Sede Norte","Activa","Activa","Código estudiantil; Identificación básica","100+"');
  });
  it("another school or another actor is discarded", async () => {
    expect((await loadServiceReport(rpc(scope(other)), school, actor)).status).toBe("error");
    expect((await loadServiceReport(rpc(scope(school, other)), school, actor)).status).toBe("error");
  });
});
