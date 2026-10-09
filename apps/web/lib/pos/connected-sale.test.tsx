import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { posContext } from "./access-context.test-fixtures";
import { bootstrapSchema, formatMinor, parseCash, paymentIssue, receiptSchema, type Checkout, type PosOperation } from "./contracts";
import { ConnectedSale, PosRequestError, requestPos } from "./connected-sale";
import { CommittedReceipt, ConnectedPosView } from "../../components/connected-pos-dashboard";

(globalThis as { React?: typeof React }).React = React;
const context = posContext();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = { session_id: id(1), cafeteria_id: context.memberships[0].cafeteria_id, register_id: id(2), assignment_id: id(3),
  register_code_snapshot: "R1", register_name_snapshot: "Caja escolar", status: "open", currency_code: "DOP" };
const product = { product_id: id(4), name: "Producto real", description: null, category_id: null, category_name: "Comida", price_minor: 12550,
  version: 7, currency_code: "DOP" };
const bootstrap = () => bootstrapSchema.parse({ context, registers: [], session, catalog: {
  cafeteria_id: session.cafeteria_id, status: "manual", currency_code: "DOP", service_shift: null, menu: null, products: [product] }, blocked: null });
const customer = { customer_id: id(5), display_name: "Estudiante autorizado", customer_type: "student" as const,
  student_code: "E-001", grade_label: "Segundo", class_label: null, restrictions: [] };
const purchaseContext = () => ({ customer_id: customer.customer_id, customer_type: "student", currency_code: "DOP", business_date: "2026-10-09",
  business_timezone: "America/Santo_Domingo", as_of: "2026-10-09T12:00:00Z", wallet: { status: "active", balance_minor: "50000" },
  daily_limit: { enabled: true, limit_minor: "40000" }, per_transaction_limit: { enabled: true, limit_minor: "30000" },
  spent_today_minor: "0", available_today_minor: "40000", restrictions: [{ type: "allergy", code: "milk", label: "Leche" }] });
const receipt = (request: Checkout) => ({ purchase_id: id(6), purchase_number: "42", purchased_at: "2026-10-09T12:10:00Z", business_date: "2026-10-09",
  business_timezone: "America/Santo_Domingo", currency_code: "DOP", total_minor: request.expected_total_minor, register_id: session.register_id,
  register_session_id: request.register_session_id, cafeteria_customer_id: request.cafeteria_customer_id, customer_type: "student", customer_name: customer.display_name,
  tender_type: request.tender.type, cash_received_minor: request.tender.type === "cash" ? request.tender.cash_received_minor : null,
  change_due_minor: request.tender.type === "cash" ? (BigInt(request.tender.cash_received_minor) - BigInt(request.expected_total_minor)).toString() : null,
  wallet_balance_after_minor: request.tender.type === "student_wallet" ? "37450" : null,
  items: request.items.map((i) => ({ product_id: i.product_id, name: "Committed product snapshot", quantity: i.quantity, product_version: i.expected_product_version,
    unit_price_minor: i.expected_unit_price_minor, line_total_minor: (BigInt(i.expected_unit_price_minor) * BigInt(i.quantity)).toString() })) });

let data: Map<string, string>;
let storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void };
let send: ReturnType<typeof vi.fn<(op: PosOperation) => Promise<unknown>>>;
let sale: ConnectedSale;
beforeEach(() => {
  data = new Map(); storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
  send = vi.fn(async (op: PosOperation) => op.operation === "bootstrap" ? bootstrap() : op.operation === "search" ? [customer] :
    op.operation === "customer" ? purchaseContext() : receipt(op.request));
  sale = new ConnectedSale(context, send, () => id(7));
});
async function prepare() { await sale.start(storage); sale.identify(); await sale.search("Estudiante"); await sale.select(customer); sale.quantity(product.product_id, 1); await sale.review(); }
const html = () => renderToStaticMarkup(<ConnectedPosView sale={sale} state={sale.getSnapshot()} />);

describe("authoritative connected sale journey", () => {
  it("loads register/catalog, selects a student, refreshes context, pays wallet, displays committed receipt and resets", async () => {
    await prepare();
    expect(html()).toContain("Límite diario RD$ 400.00"); expect(html()).toContain("Leche");
    expect(html()).toContain("Total RD$ 125.50");
    await sale.checkout();
    const call = send.mock.calls.find(([op]) => op.operation === "checkout")![0];
    expect(call).toEqual({ operation: "checkout", request: { request_key: id(7), register_session_id: session.session_id,
      cafeteria_customer_id: customer.customer_id, expected_total_minor: "12550", items: [{ product_id: product.product_id, quantity: 1,
        expected_product_version: 7, expected_unit_price_minor: "12550" }], tender: { type: "student_wallet" } } });
    expect(sale.getSnapshot().receipt!.items[0].name).toBe("Committed product snapshot");
    expect(html()).toContain("Compra completada"); expect(html()).toContain("RD$ 374.50");
    expect(send.mock.calls.filter(([op]) => op.operation === "customer")).toHaveLength(3);
    await sale.reset(); expect(sale.getSnapshot().phase).toBe("entry"); expect(sale.getSnapshot().cart).toEqual([]); expect(data.size).toBe(0);
  });
  it("supports cash without debiting wallet and uses committed change", async () => {
    await prepare(); sale.setTender("cash"); sale.setCash("200.00");
    expect(html()).toContain("Cambio: RD$ 74.50");
    await sale.checkout(); expect(sale.getSnapshot().receipt!.tender_type).toBe("cash");
    expect(sale.getSnapshot().receipt!.change_due_minor).toBe("7450"); expect(html()).toContain("Recibido RD$ 200.00");
  });
  it("renders receipt lines solely from the committed snapshot, without live catalog or demo data", async () => {
    await prepare(); await sale.checkout();
    const committed = renderToStaticMarkup(<CommittedReceipt receipt={sale.getSnapshot().receipt!} />);
    expect(committed).toContain("Recibo #42"); expect(committed).toContain("Committed product snapshot");
    expect(committed).toContain("RD$ 125.50"); expect(committed).not.toContain(product.name);
  });
  it("creates a new request key only for the next sale after confirmed reset", async () => {
    let keyNumber = 10; sale = new ConnectedSale(context, send, () => id(keyNumber++));
    await prepare(); await sale.checkout(); await sale.reset();
    await sale.select(customer); sale.quantity(product.product_id, 1); await sale.review(); await sale.checkout();
    const calls = send.mock.calls.map(([op]) => op).filter((op) => op.operation === "checkout");
    expect(calls.map((op) => op.request.request_key)).toEqual([id(10), id(11)]);
  });
  it("preserves existing gallery/list, categories, cart and payment controls with no deferred mutations", async () => {
    await sale.start(storage); await sale.select(customer); sale.quantity(product.product_id, 1);
    expect(html()).toContain("Vista de galería"); expect(html()).toContain("Vista de lista");
    expect(html()).toContain("Categorías de productos"); expect(html()).toContain("Venta actual");
    expect(html()).toContain("Reducir cantidad"); expect(html()).toContain("Aumentar cantidad");
    expect(html()).toMatch(/<button[^>]*disabled=""[^>]*>Recargar saldo/);
    await sale.review(); expect(html()).toContain("Elegir efectivo"); expect(html()).toContain("Volver a productos");
    expect(send.mock.calls.map(([op]) => op.operation)).not.toContain("refund");
  });
  it("blocks when no valid open session exists, without faking a register or sale", async () => {
    send.mockResolvedValue({ ...bootstrap(), session: null, catalog: null, blocked: "No hay caja abierta" });
    await sale.start(storage); sale.identify(); await sale.select(customer); sale.quantity(product.product_id, 1); await sale.checkout();
    expect(html()).toContain("No hay caja abierta"); expect(send).toHaveBeenCalledTimes(1);
  });
  it("cannot use failed/mismatched pre-sale context", async () => {
    await sale.start(storage); send.mockResolvedValue({ ...purchaseContext(), customer_id: id(999) });
    await sale.select(customer); expect(sale.getSnapshot().purchaseContext).toBeNull(); expect(sale.getSnapshot().phase).toBe("entry");
  });
  it("revalidates context before payment and refuses a newly lowered limit", async () => {
    await sale.start(storage); await sale.select(customer); sale.quantity(product.product_id, 1);
    send.mockResolvedValue({ ...purchaseContext(), per_transaction_limit: { enabled: true, limit_minor: "100" } });
    await sale.review(); await sale.checkout();
    expect(sale.getSnapshot().notice).toContain("Límite por compra"); expect(data.size).toBe(0);
  });
  it("freezes cart/payment and reuses the exact saved request after an uncertain result", async () => {
    await prepare(); send.mockImplementationOnce(async () => { throw new Error("connection lost after commit"); });
    await sale.checkout(); const pending = structuredClone(sale.getSnapshot().pending);
    sale.quantity(product.product_id, 1); sale.setTender("cash"); await sale.reset(); await sale.checkout();
    expect(sale.getSnapshot().pending).toEqual(pending);
    await sale.retry(); const requests = send.mock.calls.filter(([op]) => op.operation === "checkout").map(([op]) => op);
    expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]); expect(sale.getSnapshot().phase).toBe("completed");
  });
  it("recovers the exact attempt after reload even with a closed register", async () => {
    await prepare(); send.mockImplementationOnce(async () => { throw new Error("lost response"); }); await sale.checkout();
    const saved = sale.getSnapshot().pending!.request;
    send.mockImplementation(async (op) => op.operation === "bootstrap" ? { ...bootstrap(), session: null, catalog: null, blocked: "Caja cerrada" } : op.operation === "checkout" ? receipt(op.request) : purchaseContext());
    sale = new ConnectedSale(context, send, () => id(99)); await sale.start(storage); await sale.retry();
    expect(send).toHaveBeenCalledWith({ operation: "checkout", request: saved }); expect(sale.getSnapshot().receipt!.purchase_id).toBe(id(6));
  });
  it("uses the receipt currency when recovering after register currency changes", async () => {
    await prepare(); sale.setTender("cash"); sale.setCash("200");
    send.mockImplementationOnce(async () => { throw new Error("lost response"); }); await sale.checkout();
    const changed = { ...bootstrap(), session: { ...bootstrap().session!, currency_code: "USD" } };
    send.mockImplementation(async (op) => op.operation === "bootstrap" ? changed : op.operation === "checkout" ? receipt(op.request) : purchaseContext());
    sale = new ConnectedSale(context, send); await sale.start(storage); await sale.retry();
    expect(html()).toContain("Recibido RD$ 200.00"); expect(html()).not.toContain("Recibido USD");
  });
  it("preserves recovery evidence until a confirmed sale is reset", async () => {
    await prepare(); await sale.checkout(); expect(data.size).toBe(1);
    sale = new ConnectedSale(context, send); await sale.start(storage); expect(sale.getSnapshot().pending).not.toBeNull();
    await sale.retry(); await sale.reset(); expect(data.size).toBe(0);
  });
  it("rejects recovery by another effective actor", async () => {
    await prepare(); send.mockImplementationOnce(async () => { throw new Error("lost"); }); await sale.checkout();
    const different = { ...context, actor: { ...context.actor, person_id: id(99) } };
    send.mockResolvedValue({ ...bootstrap(), context: different }); sale = new ConnectedSale(different, send); await sale.start(storage); await sale.retry();
    expect(sale.getSnapshot().recoveryBlocked).toBe(true); expect(send.mock.calls.filter(([op]) => op.operation === "checkout")).toHaveLength(1);
  });
  it("permits recovery for the same cashier in a renewed valid POV", async () => {
    await prepare(); send.mockImplementationOnce(async () => { throw new Error("lost"); }); await sale.checkout();
    const renewed = { ...context, pov: { ...context.pov!, session_id: id(99) } };
    send.mockImplementation(async (op) => op.operation === "bootstrap" ? { ...bootstrap(), context: renewed } : op.operation === "checkout" ? receipt(op.request) : purchaseContext());
    sale = new ConnectedSale(renewed, send); await sale.start(storage); await sale.retry(); expect(sale.getSnapshot().phase).toBe("completed");
  });
  it("clears a definitively rejected sale and reloads catalog before another attempt", async () => {
    await prepare(); send.mockImplementationOnce(async () => { throw new PosRequestError("Producto cambió", true); }); await sale.checkout();
    expect(data.size).toBe(0); expect(sale.getSnapshot().pending).toBeNull(); expect(sale.getSnapshot().phase).toBe("identity");
    expect(send.mock.lastCall![0]).toEqual({ operation: "bootstrap" });
  });
  it("does not treat a malformed receipt as a confirmed sale", async () => {
    await prepare(); send.mockResolvedValue({ total_minor: "12550" }); await sale.checkout();
    expect(sale.getSnapshot().receipt).toBeNull(); expect(sale.getSnapshot().pending).not.toBeNull(); expect(data.size).toBe(1);
  });
  it("retains receipt confirmation if the post-sale context refresh fails", async () => {
    await prepare(); send.mockImplementation(async (op) => { if (op.operation === "checkout") return receipt(op.request); throw new Error("expired session"); });
    await sale.checkout(); expect(sale.getSnapshot().phase).toBe("completed"); expect(sale.getSnapshot().notice).toContain("Compra confirmada");
  });
  it("does not issue checkout if the request journal cannot be saved", async () => {
    await prepare(); storage.setItem = () => { throw new Error("storage disabled"); }; await sale.checkout();
    expect(send.mock.calls.some(([op]) => op.operation === "checkout")).toBe(false); expect(sale.getSnapshot().notice).toContain("No se realizó el cobro");
  });
  it("blocks new sales when the saved request is corrupt", async () => {
    storage.setItem("pikas:connected-pos:pending:v1", "bad-json"); await sale.start(storage); sale.identify();
    expect(sale.getSnapshot().recoveryBlocked).toBe(true); expect(sale.getSnapshot().phase).toBe("entry");
  });
  it("suppresses double submissions while checkout is in flight", async () => {
    await prepare(); let finish!: (value: unknown) => void;
    send.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = sale.checkout(); await sale.checkout(); await sale.retry();
    expect(send.mock.calls.filter(([op]) => op.operation === "checkout")).toHaveLength(1);
    finish(receipt(sale.getSnapshot().pending!.request)); await first;
  });
});

describe("connected contract and transport safeguards", () => {
  it("enforces wallet availability, frozen status and daily/cash limits", () => {
    const pc = sale.getSnapshot().purchaseContext;
    expect(pc).toBeNull();
    const valid = studentContext();
    expect(paymentIssue({ ...valid, wallet: { status: "frozen", balance_minor: "50000" } }, 1n, "student_wallet", "")).toContain("no disponible");
    expect(paymentIssue({ ...valid, available_today_minor: "1" }, 2n, "student_wallet", "")).toContain("insuficiente");
    expect(paymentIssue({ ...valid, per_transaction_limit: { enabled: false, limit_minor: null }, spent_today_minor: "39999" }, 2n, "cash", "100")).toContain("diario");
    expect(paymentIssue(valid, 12550n, "cash", "100")).toContain("insuficiente");
  });
  it("handles money without floating point and rejects unsafe catalog numeric values", () => {
    expect(parseCash("125,50")).toBe("12550"); expect(parseCash("1.001")).toBeNull(); expect(parseCash("-1")).toBeNull();
    expect(formatMinor("9007199254740993", "DOP")).toContain(".93");
    expect(bootstrapSchema.safeParse({ ...bootstrap(), catalog: { ...bootstrap().catalog, products: [{ ...product, price_minor: Number.MAX_SAFE_INTEGER + 1 }] } }).success).toBe(false);
  });
  it("rejects a receipt whose committed totals do not balance", async () => {
    await prepare(); await sale.checkout(); expect(receiptSchema.safeParse({ ...sale.getSnapshot().receipt, total_minor: "1" }).success).toBe(false);
  });
  it("refuses offline transport and never enqueues writes", async () => {
    vi.stubGlobal("navigator", { onLine: false }); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    try { await expect(requestPos({ operation: "bootstrap" })).rejects.toThrow("sin conexión"); expect(fetchMock).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });
  it("sends an authenticated same-origin checkout with its exact key and no authority fields", async () => {
    await prepare(); await sale.checkout(); const request = sale.getSnapshot().pending!.request;
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ result: receipt(request) })); vi.stubGlobal("fetch", fetchMock);
    try {
      await requestPos({ operation: "checkout", request });
      const [url, init] = fetchMock.mock.calls[0]; expect(url).toBe("/api/pos");
      expect(init.credentials).toBe("same-origin"); expect(init.headers["Idempotency-Key"]).toBe(request.request_key);
      expect(JSON.parse(init.body)).toEqual({ operation: "checkout", request });
    } finally { vi.unstubAllGlobals(); }
  });
});
function studentContext() { return { ...purchaseContext(), customer_type: "student" as const, wallet: { status: "active" as const, balance_minor: "50000" } }; }
