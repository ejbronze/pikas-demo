import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn(), wallet: vi.fn(), redirect: vi.fn((u: string) => { throw Object.assign(new Error("redirect"), { url: u }); }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: () => { throw new Error("not found"); }, usePathname: () => "/admin/escuela/reportes" }));
vi.mock("../../../../lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("../../../../lib/auth/school-access", () => ({ resolveSchoolAccess: mocks.access }));
vi.mock("../../../../lib/wallet/access", () => ({ readSchoolWalletAccess: mocks.wallet }));
vi.mock("../../../../components/connected-school-shell", () => ({ ConnectedSchoolShell: ({ children, walletNav }: { children: React.ReactNode; walletNav: boolean }) => <div data-wallet-nav={String(walletNav)}>{children}</div> }));
(globalThis as { React?: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import Landing from "./page";
import Students from "./estudiantes/page";
import Wallet from "./pikas-cash/page";
import Cafeterias from "./cafeterias/page";
import { GET as studentsCsv } from "./estudiantes/csv/route";
import { GET as walletCsv } from "./pikas-cash/csv/route";
import { GET as cafeteriasCsv } from "./cafeterias/csv/route";
import { walletReport } from "../../../../lib/school/report-fixtures";

const school = "4d800000-0000-4000-8000-000000000001", actor = "4d800000-0000-4000-8000-0000000000aa", other = "4d800000-0000-4000-8000-0000000000ff";
const scope = (school_id = school) => ({ actor_id: actor, membership_id: actor, role: "school_admin", account_id: actor, school_id, account_name: "Cuenta", school_name: "Colegio", tenant_kind: "customer" });
const exportRows = [{ student_code: "E1", first_name: "Ana", last_name: "Ficticia", display_name: "Ana Ficticia", status: "active", campus: "Sede Norte", grade: "4to", class: "A", homeroom: null },
  { student_code: "E2", first_name: "Beto", last_name: "Ficticio", display_name: "Beto Ficticio", status: "suspended", campus: "Sede Norte", grade: "5to", class: "B", homeroom: "Aula 2" }];
const cafes = [{ id: "4d800000-0000-4000-8000-0000000000c1", name: "Cafetería Norte", location: "Sede Norte", status: "active", sharing_status: "active", categories: ["student_code"], customer_count: 2,
  customers: [{ student_id: "4d800000-0000-4000-8000-000000000101", display_name: "Ana Ficticia", status: "active" }] }];
const north = { id: "4d800000-0000-4000-8000-0000000000b1", name: "Sede Norte" }, south = { id: "4d800000-0000-4000-8000-0000000000b2", name: "Sede Sur" };
const reads = (over: { exportSchool?: string; report?: Record<string, unknown>; locations?: { id: string; name: string }[]; grades?: string[] } = {}) => mocks.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => ({ error: null, data:
  fn === "school_student_export" ? { school_id: over.exportSchool ?? school, actor_id: actor, rows: exportRows }
  : fn === "school_student_roster" ? { scope: scope(), locations: over.locations ?? [north], grades: over.grades ?? ["4to", "5to"], rows: [], next_cursor: null }
  : fn === "school_wallet_report" ? walletReport({ period: args.p_period, ...(args.p_period === "custom" ? { from: args.p_from, to: args.p_to } : {}), ...over.report })
  : { scope: scope(), locations: [], rows: cafes } }));
const page = async (P: (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>, sp: Record<string, string> = {}) => renderToStaticMarkup(await P({ searchParams: Promise.resolve({ school, ...sp }) }));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const get = (route: (r: Request) => Promise<Response>, query: string, site = "same-origin") => route(new Request(`http://localhost/x?${query}`, { headers: { "sec-fetch-site": site } }));
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ status: "authorized", context: { person_id: actor, display_name: "Admin", schools: [{ school_id: school, school_name: "Colegio Ficticio", account_id: actor, account_name: "Cuenta", tenant_kind: "customer" }] } });
  mocks.wallet.mockResolvedValue({ read: true }); reads(); });

describe("School Reportes pages", () => {
  it("landing lists only reports this role can open", async () => {
    let t = text(await page(Landing)); expect(t).toMatch(/Reportes.*Estudiantes.*PIKAS Cash.*Cafeterías conectadas/);
    mocks.wallet.mockResolvedValue({ read: false }); t = text(await page(Landing));
    expect(t).toContain("Estudiantes"); expect(t).not.toContain("PIKAS Cash"); expect(t).not.toMatch(/próximamente|coming soon/i);
  });
  it("authority: unauthenticated → login; unknown school → back to School; sandbox POV → the server read decides PIKAS Cash (Demo Lab)", async () => {
    mocks.access.mockResolvedValueOnce({ status: "unauthenticated" }); await expect(page(Landing)).rejects.toMatchObject({ url: "/login?next=%2Fadmin%2Fescuela" });
    await expect(page(Students, { school: other })).rejects.toMatchObject({ url: "/admin/escuela" });
    mocks.access.mockResolvedValue({ status: "authorized", context: { person_id: actor, display_name: "P", pov: { role: "school_admin" }, schools: [{ school_id: school, school_name: "Colegio", account_id: actor, account_name: "C", tenant_kind: "sandbox" }] } });
    mocks.wallet.mockResolvedValueOnce({ school_id: school, read: false, replenish: false, reverse: false, adjust: false });
    expect(text(await page(Wallet))).not.toContain("no están habilitados en este punto de vista"); expect(mocks.wallet).toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(c => c[0])).not.toContain("school_wallet_report");
  });
  it("Estudiantes: URL filters reach the read; header shows them; summary reconciles with the rows; CSV keeps the filters", async () => {
    const h = await page(Students, { status: "active", grade: "4to" }), t = text(h);
    expect(mocks.rpc).toHaveBeenCalledWith("school_student_export", { p_school_id: school, p_query: "", p_status: "active", p_location_id: null, p_grade: "4to" });
    expect(t).toMatch(/Estado Activo Grado 4to Generado/); expect(t).toMatch(/Estudiantes 2 .*Activos 1 .*Suspendidos 1 .*Inactivos 0/);
    expect(h).toContain(`href="/admin/escuela/reportes/estudiantes/csv?school=${school}&amp;status=active&amp;grade=4to"`);
    expect(h).toContain(`/admin/escuela/reportes/estudiantes?school=${school}&amp;status=active&amp;grade=5to`); // grade bar → same report, that grade
    expect(t).not.toMatch(uuid); expect(h).toContain('data-print="hide"'); expect(h).toContain("rpt-generated");
  });
  it("Estudiantes filter summary lists only the dimensions the report offers (screen and print share it)", async () => {
    const pills = (h: string) => [...h.matchAll(/<div><dt>([^<]+)<\/dt><dd>([^<]+)<\/dd><\/div>/g)].map(m => `${m[1]} ${m[2]}`);
    let h = await page(Students); // one campus, grades exist
    expect(pills(h)).toEqual(["Estado Todos", "Grado Todos"]); expect(h).not.toContain('name="location"'); expect(h).toContain('name="grade"');
    reads({ locations: [north, south] }); h = await page(Students);
    expect(pills(h)).toEqual(["Estado Todos", "Campus Todos", "Grado Todos"]); expect(h).toContain('name="location"');
    h = await page(Students, { location: south.id, status: "suspended" });
    expect(pills(h)).toEqual(["Estado Suspendido", "Campus Sede Sur", "Grado Todos"]);
    reads({ grades: [] }); h = await page(Students);
    expect(pills(h)).toEqual(["Estado Todos"]); expect(h).not.toContain('name="grade"');
    h = await page(Students, { grade: "4to" }); expect(pills(h)).toEqual(["Estado Todos", "Grado 4to"]); // a grade already in the URL stays documented
  });
  it("every report carries one generated timestamp, in the header and the print-only footer", async () => {
    for (const P of [Students, Wallet, Cafeterias]) {
      const h = await page(P), header = h.match(/class="rpt-generated"><dt>Generado<\/dt><dd>([^<]+)<\/dd>/)?.[1], footer = h.match(/class="rpt-print-footer">Generado por PIKAS · ([^<]+)<\/p>/)?.[1];
      expect(header).toBeTruthy(); expect(footer).toBe(header); expect(h.match(/rpt-print-footer/g)).toHaveLength(1);
    }
  });
  it("Estudiantes: invalid filters are an error, never a wider report; another school's export is discarded", async () => {
    expect(text(await page(Students, { status: "borrado" }))).toContain("Los filtros no son válidos"); expect(mocks.rpc).not.toHaveBeenCalled();
    reads({ exportSchool: other }); expect(text(await page(Students))).toContain("No pudimos cargar el reporte de estudiantes");
  });
  it("PIKAS Cash: period from the URL; movement table; no per-cafetería breakdown, products or rankings", async () => {
    const h = await page(Wallet, { period: "custom", from: "2026-09-01", to: "2026-09-30" }), t = text(h);
    expect(mocks.rpc).toHaveBeenCalledWith("school_wallet_report", { p_school_id: school, p_period: "custom", p_from: "2026-09-01", p_to: "2026-09-30" });
    expect(t).toMatch(/Período Personalizado .*Fechas 01\/09\/2026 al 30\/09\/2026/); expect(t).toContain("Movimiento neto del período"); expect(t).toContain("Compras con PIKAS Cash");
    expect(t).not.toMatch(/¿Dónde se usó|Cafetería Comercial|spent|más vendido|producto|Top/i); expect(t).not.toMatch(uuid);
    expect(h).toContain(`href="/admin/escuela/reportes/pikas-cash/csv?school=${school}&amp;period=custom&amp;from=2026-09-01&amp;to=2026-09-30"`);
  });
  it("PIKAS Cash: a too-long range is checked before the read; an unknown period is invalid", async () => {
    expect(text(await page(Wallet, { period: "custom", from: "2026-01-01", to: "2026-10-01" }))).toContain("92 días"); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(text(await page(Wallet, { period: "ayer" }))).toContain("Los filtros no son válidos");
  });
  it("PIKAS Cash without wallet authority: no read, no report", async () => {
    mocks.wallet.mockResolvedValue({ read: false });
    const t = text(await page(Wallet)); expect(t).toContain("Tu rol no tiene acceso a los reportes de PIKAS Cash"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("Cafeterías conectadas: relationships and counts only; no student names, sales or cajas", async () => {
    const t = text(await page(Cafeterias));
    expect(t).toMatch(/Cafetería Norte .*Sede Norte .*Activa .*Activa .*Código estudiantil .*1/); expect(t).not.toMatch(/Ana Ficticia|RD\$|caja|ingreso|producto/i); expect(t).not.toMatch(uuid);
  });
});

describe("School Reportes CSV", () => {
  it("authority: unauthenticated 401, another school 403, cross-site 403 before any read", async () => {
    mocks.access.mockResolvedValueOnce({ status: "unauthenticated" }); expect((await get(studentsCsv, `school=${school}`)).status).toBe(401);
    expect((await get(studentsCsv, `school=${other}`)).status).toBe(403); expect((await get(cafeteriasCsv, `school=${school}`, "cross-site")).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("Estudiantes CSV is the same filtered result as the report", async () => {
    const r = await get(studentsCsv, `school=${school}&status=suspended`), body = await r.text();
    expect(r.headers.get("Content-Type")).toContain("text/csv"); expect(r.headers.get("X-Pikas-Export-Rows")).toBe("2"); expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("school_student_export", expect.objectContaining({ p_status: "suspended" }));
    expect(body).toContain('"Ana Ficticia","E1","Activo","Sede Norte","4to","A",""'); expect(body).not.toMatch(uuid);
    expect((await get(studentsCsv, `school=${school}&status=x`)).status).toBe(400);
  });
  it("PIKAS Cash CSV needs wallet authority and carries no cafetería data", async () => {
    const body = await (await get(walletCsv, `school=${school}&period=last_7_days`)).text();
    expect(body).toContain("Movimiento neto del período"); expect(body).not.toMatch(/Cafetería|spent|purchase_count/i);
    mocks.wallet.mockResolvedValue({ read: false }); vi.mocked(mocks.rpc).mockClear();
    expect((await get(walletCsv, `school=${school}`)).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await get(walletCsv, `school=${school}&period=custom&from=2026-01-01&to=2026-10-01`)).status).toBe(403);
  });
  it("Cafeterías CSV: no student names or identifiers", async () => {
    const body = await (await get(cafeteriasCsv, `school=${school}`)).text();
    expect(body).toContain('"Cafetería Norte","Sede Norte","Activa","Activa","Código estudiantil","1"'); expect(body).not.toMatch(/Ana Ficticia/); expect(body).not.toMatch(uuid);
  });
});
