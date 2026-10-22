import { describe, expect, it, vi } from "vitest";
import { cajasCsv, loadAllSales, loadReport, loadSales, parseSalesFilters, paymentsCsv, productsCsv, salesCsv } from "./sales-reports";
import { reconciliation, summary, topProducts } from "./report-fixtures";

const id = "5d100000-0000-4000-8000-000000000001", other = "5d100000-0000-4000-8000-0000000000ff", p30 = { period: "last_30_days" as const, from: null, to: null };
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const client = (impl: (fn: string, a: Record<string, unknown>) => unknown) => ({ rpc: vi.fn(async (fn: string, a: Record<string, unknown>) => impl(fn, a) as { data: unknown; error: null }) });
const sale = (n: number, over: Record<string, unknown> = {}) => ({ id: `5d400000-0000-4000-8000-${String(n).padStart(12, "0")}`, receipt_number: String(n), purchased_at: "2026-10-17T15:05:00Z", business_date: "2026-10-17",
  register_id: other, session_id: other, register_name: "Caja 1", operator_id: other, operator_name: "Cajera Ficticia", customer_name: "Estudiante Privado", customer_type: "student", tender: "cash", currency: "DOP",
  total_minor: "15000", refunded_minor: "0", remaining_minor: "15000", refund_status: "none", ...over });
const list = (total: number, a: Record<string, unknown>) => ({ cafeteria_id: id, tenant_kind: "customer", business_timezone: "America/Santo_Domingo", today: "2026-10-17", period: a.p_period, from: "2026-09-18", to: "2026-10-17",
  tender: a.p_tender, refund_status: null, receipt: null, offset: a.p_offset, page_size: 25, total_count: total, has_more: (a.p_offset as number) + 25 < total,
  data: Array.from({ length: Math.max(0, Math.min(25, total - (a.p_offset as number))) }, (_, i) => sale((a.p_offset as number) + i + 1, { tender: a.p_tender ?? "cash" })) });

describe("Cafetería report filters", () => {
  it("payment uses product words mapped to the stored tender; page is bounded; anything else is invalid", () => {
    expect(parseSalesFilters({ payment: "pikas_cash", page: "2" }).data).toEqual({ payment: "pikas_cash", page: 2 });
    expect(parseSalesFilters({}).data).toEqual({ payment: null, page: 1 });
    for (const bad of [{ payment: "student_wallet" }, { payment: "tarjeta" }, { page: "0" }, { page: "x" }, { page: "50000" }]) expect(parseSalesFilters(bad).success).toBe(false);
  });
});
describe("Cafetería report reads", () => {
  it("reads the 5D report for this cafetería, kind and period; anything else is discarded", async () => {
    const c = client(() => ({ data: { ...summary(), cafeteria_id: id }, error: null }));
    expect((await loadReport(c, id, "sales_summary", p30)).status).toBe("ok");
    expect(c.rpc).toHaveBeenCalledWith("cafeteria_report_read", { p_cafeteria_id: id, p_kind: "sales_summary", p_period: "last_30_days", p_from: null, p_to: null });
    for (const over of [{ cafeteria_id: other }, { period: "today" }, { kind: "top_products" }])
      expect((await loadReport(client(() => ({ data: { ...summary(), cafeteria_id: id, ...over }, error: null })), id, "sales_summary", p30)).status).toBe("error");
    expect(await loadReport(client(() => ({ data: null, error: { code: "22023", message: "report_range_too_long" } })), id, "sales_summary", p30)).toMatchObject({ status: "error", message: expect.stringContaining("92") });
  });
  it("a sales page is reduced: receipt, business time, caja, operator, payment, amounts — no customer names or ids", async () => {
    const c = client((_, a) => ({ data: list(1, a), error: null })), r = await loadSales(c, id, p30, "cash", 0);
    expect(c.rpc).toHaveBeenCalledWith("cafeteria_transactions_read", { p_cafeteria_id: id, p_period: "last_30_days", p_from: null, p_to: null, p_tender: "cash", p_refund_status: null, p_receipt: null, p_offset: 0 });
    if (r.status !== "ok") throw Error();
    expect(r.value.rows[0]).toEqual({ receipt: "1", date: "2026-10-17", time: "11:05", register: "Caja 1", operator: "Cajera Ficticia", tender: "cash", total_minor: "15000", refunded_minor: "0", refund_status: "none" });
    expect(JSON.stringify(r)).not.toMatch(/Estudiante Privado|customer|5d400000/);
    expect((await loadSales(client((_, a) => ({ data: { ...list(1, a), cafeteria_id: other }, error: null })), id, p30, null, 0)).status).toBe("error");
  });
  it("the CSV list is every page of the same filter, never truncated; above the cap or a moving set is refused", async () => {
    const c = client((_, a) => ({ data: list(60, a), error: null })), all = await loadAllSales(c, id, p30, "student_wallet");
    expect(all.status === "ok" && all.value.length).toBe(60); expect(c.rpc.mock.calls.map(x => x[1].p_offset)).toEqual([0, 25, 50]);
    expect((await loadAllSales(client((_, a) => ({ data: list(2001, a), error: null })), id, p30, null)).status).toBe("too_many");
    let n = 0; const moving = client((_, a) => ({ data: list(n++ === 0 ? 30 : 31, a), error: null }));
    expect(await loadAllSales(moving, id, p30, null)).toMatchObject({ status: "error", message: expect.stringContaining("cambiaron") });
  });
});
describe("Cafetería report CSV", () => {
  it("readable headings, plain decimal amounts, no ids", () => {
    const rows = [{ receipt: "7", date: "2026-10-17", time: "11:05", register: "Caja 1", operator: "Cajera", tender: "student_wallet" as const, total_minor: "15000", refunded_minor: "5000", refund_status: "partial" as const }];
    expect(salesCsv(rows)).toContain('"7","2026-10-17","11:05","Caja 1","Cajera","PIKAS Cash","150.00","50.00","Reembolso parcial"');
    const pay = paymentsCsv({ ...summary(), cafeteria_id: id } as never); expect(pay).toContain('"2026-09-18","2026-10-17","PIKAS Cash","1","50.00","50.00"'); expect(pay).toContain('"Crédito de personal","1","50.00",""');
    const prod = productsCsv({ ...topProducts(), cafeteria_id: id } as never); expect(prod).toContain('"1","Agua ficticia","20","2","18"');
    const cajas = cajasCsv({ ...reconciliation(), cafeteria_id: id } as never); expect(cajas).toContain('"Caja 1","C1","Cerrada","Cajero ficticio","2026-10-17 08:02","2026-10-17 17:03","Normal","3000.00","2975.00","-25.00","Faltante"');
    expect(cajas).toContain('"Caja 4","C4","Abierta"');
    for (const csv of [salesCsv(rows), pay, prod, cajas]) expect(csv).not.toMatch(uuid);
  });
});
