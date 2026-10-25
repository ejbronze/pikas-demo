import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ require: vi.fn(), read: vi.fn(), identity: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../../lib/platform/customer-console", () => ({ requirePlatform: mocks.require, readPlatform: mocks.read }));
vi.mock("../../../lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.identity }));
vi.mock("../../../lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
(globalThis as { React?: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import Landing from "./page";
import Clientes from "./clientes/page";
import Red from "./red/page";
import Finanzas from "./finanzas/page";
import { GET as clientesCsv } from "./clientes/csv/route";
import { GET as redCsv } from "./red/csv/route";
import { GET as finanzasCsv } from "./finanzas/csv/route";
import { readinessFixture as fx } from "../../../lib/platform/readiness-fixtures";
import { networkTotals, readinessGap, type NetworkCafeteria, type NetworkCustomer, type NetworkReport } from "../../../lib/platform/reports";

// Platform Reportes (Reporting Consolidation): authority per report, Demo excluded by default, exports = page scope.
const ops = "platform:customer:operations:read", fin = "platform:finance:read", uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const u = (n: number) => `7e00d000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const readiness = (truncated = false) => ({ truncated, sandbox: [{ account_id: u(999), name: "Colegio Horizonte", status: "active" }],
  customers: [fx(1, "empty", { name: "Colegio Ficticio Uno" }), fx(2, "configured", { name: "Colegio Ficticio Dos" }), fx(3, "configured", { name: "Colegio Ficticio Tres", sales: { first_at: "2026-10-10T14:00:00Z", last_at: "2026-10-20T14:00:00Z" } }),
    fx(4, "configured", { name: "Colegio Ficticio Cuatro", status: "suspended" })] });
const caf = (n: number, p: Partial<NetworkCafeteria> = {}): NetworkCafeteria => ({ cafeteria_id: u(100 + n), name: `Cafetería Ficticia ${n}`, school: "Colegio", location: "Sede", status: "active", operating: true,
  registers_active: 1, registers_inactive: 0, registers_staffed: 1, products_available: 5, scheduling_enabled: false, shifts_enabled: 0, operationally_ready: true, student_service: "ready",
  enabled_students: 40, sales: 12, students_served: 9, last_sale_at: "2026-10-20T14:00:00Z", ...p });
const cust = (n: number, p: Partial<NetworkCustomer> = {}): NetworkCustomer => ({ account_id: u(n), name: `Colegio Ficticio ${n}`, code: `COL-${n}`, status: "active", demo: false, created_at: "2026-10-01T12:00:00Z",
  schools: { active: 1, other: 0 }, locations: { active: 1, inactive: 0 }, cafeterias: [caf(n)], ...p });
const network = (demo = false, truncated = false): NetworkReport => ({ period: { period: "last_30_days", from: "2026-09-25", to: "2026-10-24", today: "2026-10-24", timezone: "America/Santo_Domingo" }, include_demo: demo, truncated,
  customers: [cust(1, { name: "Colegio Ficticio Uno", cafeterias: [caf(1, { registers_staffed: 0, operationally_ready: false, student_service: "not_shared", enabled_students: 0, sales: 0, students_served: 0, last_sale_at: null })] }),
    cust(2, { name: "Colegio Ficticio Dos", cafeterias: [caf(2, { sales: 0, students_served: 0, last_sale_at: null }), caf(22, { status: "inactive", operating: false, operationally_ready: false })], locations: { active: 1, inactive: 1 } }),
    cust(3, { name: "Colegio Ficticio Tres" }), cust(4, { name: "Colegio Ficticio Cuatro", status: "suspended" }),
    ...(demo ? [cust(999, { name: "Colegio Horizonte", code: "COLEGIO-HORIZONTE", demo: true, cafeterias: [caf(999, { registers_staffed: 0, operationally_ready: false, sales: 0, students_served: 0, last_sale_at: null })] })] : [])] });
const finance = () => ({ period: network().period, activations: [{ customer: "Colegio Ficticio Tres", code: "COL-3", status: "active", activated_at: "2026-10-01T12:00:00Z", ended_at: null, policy_version: 1, fee_bps: 300 }],
  replenishments: [{ method: "cafeteria_cash", count: 2, gross_minor: "300000", fee_minor: "9000", net_minor: "291000" }], reversals: { count: 0, net_minor: "0" },
  settlements: { due: 1, in_review: 1, overdue: 1, cafeterias_owe_minor: "250000", pikas_owes_minor: "400000", settled_in_period: 3 }, ready_periods: 2,
  unsettled_obligations: { cafeterias_owe_minor: "100000", pikas_owes_minor: "75000", count: 4 } });
const reads = (demoFlag: () => boolean) => async (_s: unknown, cap: string, fn: string, args: Record<string, unknown>) => {
  void demoFlag; if (fn === "platform_customer_readiness") return { kind: "ready", value: readiness() };
  if (fn === "platform_network_report") return { kind: "ready", value: network(args.p_include_demo === true) };
  if (fn === "platform_finance_report") return { kind: "ready", value: finance() };
  throw Error(`unexpected ${cap} ${fn}`);
};
const session = (caps = [ops]) => mocks.require.mockResolvedValue({ identity: { person: { id: u(500), displayName: "Operadora" } }, capabilities: caps });
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const page = async (P: (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>, sp: Record<string, string> = {}) => renderToStaticMarkup(await P({ searchParams: Promise.resolve(sp) }));
const req = (q: string, site = "same-origin") => new Request(`http://localhost/x?${q}`, { headers: { "sec-fetch-site": site } });
const rpcFor = (fn: string, args: Record<string, unknown>) => ({ data: fn === "platform_customer_readiness" ? readiness() : fn === "platform_network_report" ? network(args.p_include_demo === true) : finance(), error: null });
beforeEach(() => { vi.clearAllMocks(); session(); mocks.read.mockImplementation(reads(() => false));
  mocks.identity.mockResolvedValue({ status: "ready", platform: { capabilities: [ops] } }); mocks.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => rpcFor(fn, args)); });

describe("Reportes landing", () => {
  it("lists only the reports the role can open; neither authority is an umbrella", async () => {
    let t = text(renderToStaticMarkup(await Landing())); expect(t).toMatch(/Clientes .*Red y adopción/); expect(t).not.toContain("Finanzas (resumen)"); expect(t).toContain("Incluir Demo");
    session([fin]); t = text(renderToStaticMarkup(await Landing())); expect(t).toContain("Finanzas (resumen)"); expect(t).not.toContain("Red y adopción");
    session(["platform:tenant:lifecycle:read", "platform:team:manage"]); expect(text(renderToStaticMarkup(await Landing()))).toContain("No tienes permiso");
  });
});

describe("Reportes / Clientes", () => {
  it("real customers only by default: lifecycle, puesta en marcha and footprint from the two reads", async () => {
    const h = await page(Clientes), t = text(h);
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), ops, "platform_customer_readiness", { p_account_id: null }, expect.anything());
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), ops, "platform_network_report", expect.objectContaining({ p_include_demo: false }), expect.anything());
    expect(t).toContain("clientes reales (sin Demo)"); expect(t).not.toContain("Horizonte"); expect(t).toContain("Demo Excluida");
    expect(t).toMatch(/Activos 3 1 suspendido/); expect(t).toMatch(/Ciclo de vida .*Activo 3 clientes .*Suspendido 1 cliente .*Cerrado 0 clientes/);
    expect(t).toContain("1 sede (+1 inactiva)"); expect(t).toContain("1 cafetería activa · 1 inactiva"); expect(t).not.toMatch(uuid);
    expect(h).toContain('href="/platform/reportes/clientes/csv?"');
  });
  it("Incluir Demo: Horizonte appears tagged, the page says Demo is included, and it never counts as puesta en marcha", async () => {
    const h = await page(Clientes, { demo: "1" }), t = text(h);
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), ops, "platform_network_report", expect.objectContaining({ p_include_demo: true }), expect.anything());
    expect(t).toContain("Incluye datos de demostración (Demo)"); expect(t).toMatch(/Colegio Horizonte Demo/); expect(t).toContain("Demo (no se cuenta)"); expect(t).toContain("clientes reales y Demo");
    expect(t).toMatch(/Listos para operar 1 /); expect(h).toContain('href="/platform/reportes/clientes/csv?demo=1"');
  });
  it("filters never widen: lifecycle, readiness and invalid values", async () => {
    let t = text(await page(Clientes, { status: "suspended" })); expect(t).toContain("Colegio Ficticio Cuatro"); expect(t).toContain("1 cliente"); expect(t).not.toContain("Colegio Ficticio Dos");
    t = text(await page(Clientes, { readiness: "operating" })); expect(t).toContain("Colegio Ficticio Tres"); expect(t).not.toContain("Colegio Ficticio Uno");
    for (const bad of [{ status: "deleted" }, { demo: "yes" }, { readiness: "live" }] as Record<string, string>[]) expect(text(await page(Clientes, bad))).toContain("Los filtros no son válidos");
  });
  it("a read failure is a state, not a page", async () => {
    mocks.read.mockResolvedValue({ kind: "forbidden", failure: "permission" }); expect(text(await page(Clientes))).toContain("No tienes permiso");
  });
});

describe("Reportes / Red y adopción", () => {
  it("defines every figure, keeps readiness, student service and use apart, and reads the Santo Domingo period", async () => {
    const h = await page(Red), t = text(h);
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), ops, "platform_network_report", { p_period: "last_30_days", p_from: null, p_to: null, p_include_demo: false }, expect.anything());
    expect(t).toMatch(/Clientes activos 3 /); expect(t).toMatch(/Cafeterías en operación 3 /); expect(t).toContain("Ventas en el período 12");
    expect(t).toMatch(/Lista para operar 2 de 3/); expect(h).toMatch(/width:66\.6\d*%/); expect(h).toMatch(/width:33\.3\d*%/); // bars scale to the 3 cafeterías, not to the largest bar expect(t).toMatch(/Servicio a estudiantes listo 2 de 3/); expect(t).toMatch(/Con ventas en el período 1 de 3/);
    expect(t).toContain("no se suman en una puntuación"); expect(t).toContain("Una primera venta no la vuelve «lista»"); expect(t).toContain("Ninguna caja tiene personal asignado");
    expect(t).toContain("Zona horaria Santo Domingo"); expect(t).toContain("25/09/2026 – 24/10/2026"); expect(t).not.toContain("Horizonte"); expect(t).not.toMatch(/RD\$/);
    expect(t).toMatch(/2 cafeterías en operación no registraron ventas en el período/); expect(h).toContain('href="/platform/reportes/red?period=last_30_days&amp;demo=1"');
  });
  it("custom period and Demo flow through to the read; invalid values are refused, never widened", async () => {
    await page(Red, { period: "custom", from: "2026-10-01", to: "2026-10-07", demo: "1" });
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), ops, "platform_network_report", { p_period: "custom", p_from: "2026-10-01", p_to: "2026-10-07", p_include_demo: true }, expect.anything());
    expect(text(await page(Red, { period: "this_year" }))).toContain("El período no es válido"); expect(text(await page(Red, { demo: "2" }))).toContain("Los filtros no son válidos");
    expect(text(await page(Red, { period: "custom", from: "2026-01-01", to: "2026-10-01" }))).toContain("no puede superar 92 días");
  });
  it("metric definitions (pure): operating cafeterías of active customers; reasons in setup order", () => {
    const t = networkTotals(network(true));
    expect([t.customers, t.demoCustomers, t.cafeterias, t.ready, t.studentService, t.withSales, t.customersWithSales]).toEqual([4, 1, 4, 2, 3, 1, 1]);
    expect(readinessGap(caf(1, { operationally_ready: false, registers_active: 0 }))).toBe("Sin caja activa");
    expect(readinessGap(caf(1, { operationally_ready: false, products_available: 0 }))).toBe("Sin productos disponibles");
    expect(readinessGap(caf(1, { operationally_ready: false, scheduling_enabled: true, shifts_enabled: 0 }))).toBe("Usa turnos y no tiene ninguno habilitado");
    expect(readinessGap(caf(1))).toBeNull();
  });
});

describe("Reportes / Finanzas (resumen)", () => {
  it("requires platform:finance:read before any read; a customer-operations viewer never sees finance", async () => {
    expect(text(await page(Finanzas))).toContain("No tienes permiso para consultar finanzas"); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("summarises activation, replenishments, obligations and settlements; actions stay in Finanzas", async () => {
    session([fin]); const h = await page(Finanzas), t = text(h);
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), fin, "platform_finance_report", { p_period: "last_30_days", p_from: null, p_to: null }, expect.anything());
    for (const s of ["Clientes con activación financiera 1", "Colegio Ficticio Tres", "Recargas en el período RD$ 3,000.00", "cargo PIKAS RD$ 90.00", "Liquidaciones pendientes 2", "1 vencida",
      "Las cafeterías deben enviar a PIKAS RD$ 2,500.00", "PIKAS debe pagar a las cafeterías RD$ 4,000.00", "Semanas por liquidar 2", "sin compensar entre cafeterías", "el cargo no se recalcula"]) expect(t).toContain(s);
    expect(h).toContain('href="/platform/finanzas/liquidaciones"'); expect(h).not.toMatch(/<button[^>]*>(Confirmar|Calcular|Poner en revisión)/);
  });
});

describe("Report CSV routes: the page's scope, enforced on the server", () => {
  it("Clientes CSV excludes Demo by default and includes it only when asked; no internal ids", async () => {
    let res = await clientesCsv(req("")), body = await res.text();
    expect(res.status).toBe(200); expect(body).not.toContain("Horizonte"); expect(body).not.toMatch(uuid); expect(res.headers.get("X-Pikas-Export-Rows")).toBe("4");
    expect(mocks.rpc).toHaveBeenCalledWith("platform_network_report", expect.objectContaining({ p_include_demo: false }));
    res = await clientesCsv(req("demo=1")); body = await res.text(); expect(body).toMatch(/"Colegio Horizonte","COLEGIO-HORIZONTE","Sí"/); expect(res.headers.get("Content-Disposition")).toContain("reporte-clientes-con-demo-");
    res = await clientesCsv(req("status=suspended")); expect(res.headers.get("X-Pikas-Export-Rows")).toBe("1");
  });
  it("refuses cross-site, signed-out, wrong authority, invalid filters, database refusals and a truncated network", async () => {
    expect((await clientesCsv(req("", "cross-site"))).status).toBe(403);
    mocks.identity.mockResolvedValueOnce({ status: "unauthenticated" }); expect((await clientesCsv(req(""))).status).toBe(401);
    mocks.identity.mockResolvedValueOnce({ status: "ready", platform: { capabilities: [fin] } }); expect((await clientesCsv(req(""))).status).toBe(403);
    mocks.identity.mockResolvedValueOnce({ status: "ready", platform: null }); expect((await redCsv(req(""))).status).toBe(403);
    expect((await clientesCsv(req("status=gone"))).status).toBe(400); expect((await redCsv(req("period=forever"))).status).toBe(400);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "customer_operations_authority_required" } }); expect((await redCsv(req(""))).status).toBe(403);
    mocks.rpc.mockResolvedValueOnce({ data: network(false, true), error: null }); expect((await redCsv(req(""))).status).toBe(413);
  });
  it("Red CSV: one row per operating cafetería of active customers, with the period", async () => {
    const res = await redCsv(req("period=today")), body = await res.text();
    expect(mocks.rpc).toHaveBeenCalledWith("platform_network_report", { p_period: "today", p_from: null, p_to: null, p_include_demo: false });
    expect(res.headers.get("X-Pikas-Export-Rows")).toBe("3"); expect(body).toContain('"Ninguna caja tiene personal asignado"'); expect(body).not.toMatch(uuid);
  });
  it("Finanzas CSV needs finance read; amounts are plain decimals", async () => {
    expect((await finanzasCsv(req(""))).status).toBe(403);
    mocks.identity.mockResolvedValue({ status: "ready", platform: { capabilities: [fin] } });
    const res = await finanzasCsv(req("")), body = await res.text();
    expect(res.status).toBe(200); expect(body).toContain('"Recargas en efectivo (bruto)","2","3000.00"'); expect(body).toContain('"Liquidaciones pendientes: PIKAS debe a las cafeterías","","4000.00"');
  });
});
