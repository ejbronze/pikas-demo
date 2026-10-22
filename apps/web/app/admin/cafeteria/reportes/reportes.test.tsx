import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn(), redirect: vi.fn((u: string) => { throw Object.assign(new Error("redirect"), { url: u }); }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: () => { throw new Error("not found"); }, usePathname: () => "/admin/cafeteria/reportes" }));
vi.mock("../../../../lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("../../../../lib/auth/cafeteria-access", () => ({ resolveCafeteriaAccess: mocks.access }));
vi.mock("../../../../components/connected-cafeteria-shell", () => ({ ConnectedCafeteriaShell: ({ children, reportsNav }: { children: React.ReactNode; reportsNav: boolean }) => <div data-reports-nav={String(reportsNav)}>{children}</div> }));
(globalThis as { React?: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import Landing from "./page";
import Ventas from "./ventas/page";
import Pagos from "./pagos/page";
import Productos from "./productos/page";
import Cajas from "./cajas/page";
import { GET as ventasCsv } from "./ventas/csv/route";
import { GET as cajasCsv } from "./cajas/csv/route";
import { cafeteriaRead, id } from "../../../../lib/cafeteria/test-fixtures";
import { reconciliation, summary, topProducts } from "../../../../lib/cafeteria/report-fixtures";

const other = "4d300000-0000-4000-8000-0000000000ff";
const caps = { sales: ["cafeteria:pos:purchases:read"], all: ["cafeteria:pos:purchases:read", "cafeteria:pos:sessions:read"] };
const ctx = (tenant_kind = "customer", pov?: unknown) => ({ status: "authorized", context: { person_id: id, display_name: "Admin", ...(pov ? { pov } : {}), cafeterias: [{ cafeteria_id: id, cafeteria_name: "Cafetería Ficticia", account_name: "Cuenta", school_name: "Colegio Ficticio", location_name: "Sede", tenant_kind }] } });
const sale = (n: number, tender: string) => ({ id: `4d400000-0000-4000-8000-${String(n).padStart(12, "0")}`, receipt_number: String(n), purchased_at: "2026-10-17T15:05:00Z", business_date: "2026-10-17", register_id: other, session_id: other,
  register_name: "Caja 1", operator_id: other, operator_name: "Cajera Ficticia", customer_name: "Estudiante Privado", customer_type: "student", tender, currency: "DOP", total_minor: "5000", refunded_minor: "0", remaining_minor: "5000", refund_status: "none" });
const reads = (capabilities = caps.all, tenant = "customer") => mocks.rpc.mockImplementation(async (fn: string, a: Record<string, unknown>) => ({ error: null, data:
  fn === "cafeteria_admin_read" ? { ...cafeteriaRead(), scope: { ...cafeteriaRead().scope, tenant_kind: tenant, capabilities } }
  : fn === "cafeteria_report_read" ? { ...(a.p_kind === "top_products" ? topProducts([{ name: "Empanada de pollo con queso y orégano de la casa, tamaño familiar", gross: 9, refunded: 1 }, { name: "Jugo", gross: 4, refunded: 0 }]) : a.p_kind === "reconciliation" ? reconciliation() : summary()),
      cafeteria_id: id, period: a.p_period, ...(a.p_period === "custom" ? { from: a.p_from, to: a.p_to } : {}) }
  : fn === "cafeteria_transactions_read" ? { cafeteria_id: id, tenant_kind: "customer", business_timezone: "America/Santo_Domingo", today: "2026-10-17", period: a.p_period, from: "2026-09-18", to: "2026-10-17",
      tender: a.p_tender, refund_status: null, receipt: null, offset: a.p_offset, page_size: 25, total_count: a.p_tender ? 1 : 3, has_more: false, data: a.p_tender ? [sale(1, a.p_tender as string)] : [sale(1, "cash"), sale(2, "student_wallet"), sale(3, "staff_credit")] }
  : null }));
const page = async (P: (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>, sp: Record<string, string> = {}) => renderToStaticMarkup(await P({ searchParams: Promise.resolve({ cafeteria: id, ...sp }) }));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const reportCalls = () => mocks.rpc.mock.calls.filter(c => c[0] !== "cafeteria_admin_read");
const get = (route: (r: Request) => Promise<Response>, q: string, site = "same-origin") => route(new Request(`http://localhost/x?${q}`, { headers: { "sec-fetch-site": site } }));
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue(ctx()); reads(); });

describe("Cafetería Reportes pages", () => {
  it("landing lists only reports this role can open", async () => {
    expect(text(await page(Landing))).toMatch(/Reportes .*¿qué quieres analizar\? .*Ventas .*Métodos de pago .*Productos .*Cajas y cierres/);
    reads(caps.sales); const t = text(await page(Landing)); expect(t).toContain("Productos"); expect(t).not.toContain("Cajas y cierres");
  });
  it("authority: unauthenticated → login; another cafetería → back to Cafetería", async () => {
    mocks.access.mockResolvedValueOnce({ status: "unauthenticated" }); await expect(page(Landing)).rejects.toMatchObject({ url: "/login?next=%2Fadmin%2Fcafeteria" });
    await expect(page(Ventas, { cafeteria: other })).rejects.toMatchObject({ url: "/admin/cafeteria" });
  });
  it("sandbox tenants and roles without sales access get no financial read", async () => {
    mocks.access.mockResolvedValue(ctx("sandbox")); reads(caps.all, "sandbox");
    for (const P of [Landing, Ventas, Pagos, Productos, Cajas]) expect(text(await page(P))).toContain("no están disponibles en el entorno sandbox");
    expect(reportCalls()).toEqual([]);
    mocks.access.mockResolvedValue(ctx()); reads([]); vi.clearAllMocks(); reads([]);
    expect(text(await page(Ventas))).toContain("Tu rol no tiene acceso a reportes"); expect(reportCalls()).toEqual([]);
    reads(caps.sales); expect(text(await page(Cajas))).toContain("historial de cajas"); expect(reportCalls()).toEqual([]);
  });
  it("Ventas: period and payment come from the URL; the payment summary and list come from the same filter and agree", async () => {
    const h = await page(Ventas, { period: "today", payment: "pikas_cash" }), t = text(h);
    expect(mocks.rpc).toHaveBeenCalledWith("cafeteria_report_read", expect.objectContaining({ p_kind: "sales_summary", p_period: "today" }));
    expect(mocks.rpc).toHaveBeenCalledWith("cafeteria_transactions_read", expect.objectContaining({ p_period: "today", p_tender: "student_wallet", p_offset: 0 }));
    expect(t).toMatch(/Período Hoy .*Método de pago PIKAS Cash/); expect(t).toMatch(/Transacciones 1 pagadas con PIKAS Cash/); expect(t).toContain("1 venta con PIKAS Cash");
    expect(h).toContain(`href="/admin/cafeteria/reportes/ventas/csv?cafeteria=${id}&amp;period=today&amp;payment=pikas_cash"`);
    expect(t).not.toMatch(/Estudiante Privado/); expect(t).not.toMatch(uuid); expect(h).toContain("rpt-print-footer");
  });
  it("Ventas: page 2 asks for offset 25; invalid payment, page or period is an error with no read", async () => {
    await page(Ventas, { page: "2" }); expect(mocks.rpc).toHaveBeenCalledWith("cafeteria_transactions_read", expect.objectContaining({ p_offset: 25, p_tender: null }));
    vi.clearAllMocks(); reads();
    for (const sp of [{ payment: "student_wallet" }, { page: "0" }, { period: "ayer" }] as Record<string, string>[]) expect(text(await page(Ventas, sp))).toContain("Los filtros no son válidos");
    expect(reportCalls()).toEqual([]);
    expect(text(await page(Ventas, { period: "custom", from: "2026-01-01", to: "2026-10-17" }))).toContain("92 días"); expect(reportCalls()).toEqual([]);
  });
  it("Métodos de pago: each method opens Ventas filtered to it for the same period; totals equal the summary", async () => {
    const h = await page(Pagos, { period: "last_7_days" }), t = text(h);
    expect(h).toContain(`href="/admin/cafeteria/reportes/ventas?cafeteria=${id}&amp;period=last_7_days&amp;payment=pikas_cash"`);
    expect(t).toMatch(/Total 3 RD\$ 200\.00 100%/);
  });
  it("Productos and Cajas render their reads; long names stay whole; no ids", async () => {
    const p = text(await page(Productos)); expect(p).toContain("Empanada de pollo con queso y orégano de la casa, tamaño familiar"); expect(p).toMatch(/Productos con actividad 2/); expect(p).not.toMatch(uuid);
    const c = text(await page(Cajas, { period: "last_7_days" })); expect(c).toMatch(/Cierres 3 .*Cuadrados 1 .*Con diferencia 2/); expect(c).toContain("Faltante"); expect(c).not.toMatch(uuid);
    expect(mocks.rpc).toHaveBeenCalledWith("cafeteria_report_read", expect.objectContaining({ p_kind: "reconciliation", p_period: "last_7_days" }));
  });
});
describe("Cafetería Reportes CSV", () => {
  it("authority: unauthenticated 401, another cafetería 403, cross-site 403, sandbox 403 — all before any read", async () => {
    mocks.access.mockResolvedValueOnce({ status: "unauthenticated" }); expect((await get(ventasCsv, `cafeteria=${id}`)).status).toBe(401);
    expect((await get(ventasCsv, `cafeteria=${other}`)).status).toBe(403); expect((await get(ventasCsv, `cafeteria=${id}`, "cross-site")).status).toBe(403);
    mocks.access.mockResolvedValue(ctx("sandbox")); expect((await get(cajasCsv, `cafeteria=${id}`)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("Ventas CSV is the same filtered list as the report", async () => {
    const r = await get(ventasCsv, `cafeteria=${id}&period=today&payment=cash`), body = await r.text();
    expect(r.headers.get("X-Pikas-Export-Rows")).toBe("1"); expect(mocks.rpc).toHaveBeenCalledWith("cafeteria_transactions_read", expect.objectContaining({ p_period: "today", p_tender: "cash" }));
    expect(body).toContain('"1","2026-10-17","11:05","Caja 1","Cajera Ficticia","Efectivo","50.00","0.00","Sin reembolso"'); expect(body).not.toMatch(/Estudiante Privado/); expect(body).not.toMatch(uuid);
    expect((await get(ventasCsv, `cafeteria=${id}&payment=tarjeta`)).status).toBe(400);
  });
});
