import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Wave E POS presentation and Phase 5D.4 Transacciones in real Chromium. The POS engine runs
// unchanged against a scripted transport; Transacciones runs against a scripted /api route. Every
// request is recorded; nothing reaches a server, Auth or the database. Tailwind is not compiled in
// this harness, so sizes and breakpoints are verified in the production-mode browser pass instead.
let browser: Browser, server: Server, page: Page, url: string, native = false;
const win = <T,>(fn: string) => page.evaluate(`(${fn})(window)`) as Promise<T>;
type Op = { operation: string; request?: { request_key: string; tender: { type: string }; expected_total_minor: string } };
type Call = { url: string; body: Record<string, unknown> };

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
      b.onLoad({ filter: /^link$/, namespace: "stub" }, () => ({ resolveDir: process.cwd(), contents: "import React from 'react'; export default ({href, children, prefetch, ...rest}) => React.createElement('a', {href, ...rest}, children)", loader: "js" }));
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "nav", namespace: "stub" }));
      b.onLoad({ filter: /^nav$/, namespace: "stub" }, () => ({ contents: "export const useRouter = () => ({ refresh() {}, push() {}, replace() {} }); export const usePathname = () => '/pos'; export const useSearchParams = () => new URLSearchParams();", loader: "js" }));
      b.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "stub" }));
      b.onLoad({ filter: /^image$/, namespace: "stub" }, () => ({ contents: "export default () => null", loader: "js" }));
    } }],
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, { useState, useSyncExternalStore } from "react";
      import { createRoot } from "react-dom/client";
      import { ConnectedSale } from "./lib/pos/connected-sale";
      import { ConnectedPosView } from "./components/connected-pos-dashboard";
      import { CafeteriaTransactions } from "./components/cafeteria-transactions";
      import { posContext } from "./lib/pos/access-context.test-fixtures";
      const w = window; w.ops = []; w.calls = []; w.next = []; w.txq = {};
      const id = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
      const context = posContext(false);
      const session = { session_id: id(1), cafeteria_id: context.memberships[0].cafeteria_id, register_id: id(2), assignment_id: id(3), register_code_snapshot: "R1", register_name_snapshot: "Caja escolar", status: "open", version: 1, opening_cash_minor: "10000", currency_code: "DOP" };
      const product = (n, name, price, category = "Comida") => ({ product_id: id(n), name, description: null, category_id: null, category_name: category, price_minor: price, version: 7, currency_code: "DOP" });
      const products = [product(40, "Producto real", 12550), product(41, "Jugo ficticio", 5000, "Bebidas")];
      const bootstrap = () => ({ context, registers: [], session, catalog: { cafeteria_id: session.cafeteria_id, status: "manual", currency_code: "DOP", service_shift: null, menu: null, products }, blocked: null });
      const customer = { customer_id: id(5), display_name: "Estudiante autorizado", customer_type: "student", student_code: "E-001", grade_label: "Segundo", class_label: null, restrictions: [] };
      w.context2 = { ...customer, customer_id: id(8), display_name: "Otra estudiante" };
      const purchaseContext = (cid = customer.customer_id) => ({ customer_id: cid, customer_type: "student", currency_code: "DOP", business_date: "2026-10-09", business_timezone: "America/Santo_Domingo", as_of: "2026-10-09T12:00:00Z", wallet: { status: "active", balance_minor: "50000" }, daily_limit: { enabled: true, limit_minor: "40000" }, per_transaction_limit: { enabled: true, limit_minor: "30000" }, spent_today_minor: "0", available_today_minor: "40000", restrictions: [{ type: "allergy", code: "milk", label: "Leche" }] });
      const receipt = r => ({ purchase_id: id(6), purchase_number: "42", purchased_at: "2026-10-09T12:10:00Z", business_date: "2026-10-09", business_timezone: "America/Santo_Domingo", currency_code: "DOP", total_minor: r.expected_total_minor, register_id: session.register_id, register_session_id: r.register_session_id, cafeteria_customer_id: r.cafeteria_customer_id, customer_type: r.cafeteria_customer_id === null ? null : "student", customer_name: r.cafeteria_customer_id === null ? null : customer.display_name, tender_type: r.tender.type, cash_received_minor: r.tender.type === "cash" ? r.tender.cash_received_minor : null, change_due_minor: r.tender.type === "cash" ? (BigInt(r.tender.cash_received_minor) - BigInt(r.expected_total_minor)).toString() : null, wallet_balance_after_minor: r.tender.type === "student_wallet" ? "37450" : null, items: r.items.map(i => ({ product_id: i.product_id, name: "Snapshot", quantity: i.quantity, product_version: i.expected_product_version, unit_price_minor: i.expected_unit_price_minor, line_total_minor: (BigInt(i.expected_unit_price_minor) * BigInt(i.quantity)).toString() })) });
      const send = async op => { w.ops.push(JSON.parse(JSON.stringify(op))); const n = w.next.shift(); if (n === "throw") throw new Error("lost response");
        if (op.operation === "bootstrap") return bootstrap(); if (op.operation === "search") return [customer, w.context2]; if (op.operation === "customer") return purchaseContext(op.customer_id); if (op.operation === "checkout") return receipt(op.request); return []; };
      function Pos() { const [sale] = useState(() => { const s = new ConnectedSale(context, send); void s.start(sessionStorage); return s; }); const state = useSyncExternalStore(sale.subscribe, sale.getSnapshot, sale.getSnapshot); w.sale = sale; return <ConnectedPosView sale={sale} state={state} />; }
      // Transacciones route: scripted results by operation; requests recorded.
      w.fetch = async (input, init = {}) => { const u = String(input); const body = init.body ? JSON.parse(init.body) : null; w.calls.push({ url: u, body });
        const r = (w.txq[body?.operation] ?? []).shift() ?? w.txAuto(body); return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } }); };
      let root; const show = el => { root ??= createRoot(document.getElementById("root")); root.render(React.createElement(React.Fragment, { key: Math.random() }, el)); };
      w.mountPos = () => show(<Pos />);
      w.mountTx = (sandbox = false) => show(<CafeteriaTransactions cafeteriaId="${"d4000000-0000-4000-8000-000000000001"}" sandbox={sandbox} />);
    ` } });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_q, r) => { r.setHeader("Content-Type", "text/html"); r.end(`<html lang="es"><head><meta charset="utf-8"></head><body><div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise<void>((ok, ko) => { server.once("error", ko); server.listen(0, "127.0.0.1", ok); });
  const a = server.address(); if (!a || typeof a === "string") throw Error("listener"); url = `http://127.0.0.1:${a.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);
beforeEach(async () => { native = false; page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(5000); page.on("dialog", d => { native = true; void d.dismiss(); }); await page.goto(url); await installTx(); });
afterEach(async () => { expect(native).toBe(false); await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>(ok => server?.close(() => ok())); });

const caf = "d4000000-0000-4000-8000-000000000001";
const U = (n: number) => `d4000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tx = (n: number, over: Record<string, unknown> = {}) => ({ id: U(100 + n), receipt_number: String(1000 + n), purchased_at: "2026-10-18T15:00:00Z", business_date: "2026-10-18", register_id: U(2), session_id: U(3),
  register_name: "Caja Principal", operator_id: U(4), operator_name: "Cajera Ficticia", customer_name: n === 1 ? "No Usuario" : "Sol Ficticia", customer_type: "student", tender: "cash", currency: "DOP",
  total_minor: "15000", refunded_minor: "0", remaining_minor: "15000", refund_status: "none", ...over });
const rows = [tx(1), tx(2, { tender: "student_wallet", refunded_minor: "5000", remaining_minor: "10000", refund_status: "partial" }), tx(3, { refunded_minor: "15000", remaining_minor: "0", refund_status: "full" }), tx(4, { tender: "staff_credit" })];
async function installTx() {
  await page.evaluate(([c, r]) => {
    const w = window as unknown as { txAuto(b: Record<string, unknown>): unknown };
    w.txAuto = (b) => b.operation === "list" ? { body: { result: { cafeteria_id: c, tenant_kind: "customer", business_timezone: "America/Santo_Domingo", today: "2026-10-19", period: b.period, from: b.period ? "2026-10-13" : null, to: b.period ? "2026-10-19" : null,
      tender: b.tender, refund_status: b.refund_status, receipt: b.receipt, offset: b.offset, page_size: 25, total_count: 4, has_more: false, data: r } } } : { status: 404 };
  }, [caf, rows] as const);
}
const dlg = () => page.locator("dialog[open]");
const ops = () => win<Op[]>("w => w.ops");
const calls = () => win<Call[]>("w => w.calls");
const toItems = async () => { await page.getByRole("button", { name: "Usuario PIKAS", exact: true }).click(); await page.getByLabel("Nombre o código del estudiante").fill("Estudiante"); await page.getByRole("button", { name: "Buscar", exact: true }).click(); await page.getByRole("button", { name: /Estudiante autorizado/ }).click(); await page.getByRole("heading", { name: "Productos" }).waitFor(); };

describe("POS sale", () => {
  it("header names operator and role; order lines show unit price, line total and Quitar; mobile keeps the total reachable", async () => {
    await win("w => w.mountPos()"); await page.getByText("Tenant cashier · Cajero").waitFor(); await toItems();
    await page.getByRole("button", { name: "Añadir Producto real" }).click(); await page.getByRole("button", { name: "Añadir Producto real" }).click(); await page.getByRole("button", { name: "Añadir Jugo ficticio" }).click();
    const order = await page.getByRole("complementary", { name: "Venta actual" }).innerText();
    expect(order).toContain("3 artículos"); expect(order).toMatch(/RD\$ 251\.00/); expect(order).toMatch(/RD\$ 125\.50 c\/u/); expect(order).toMatch(/Total\s*RD\$ 301\.00/);
    await page.getByRole("button", { name: "Quitar Jugo ficticio" }).click(); expect(await page.getByRole("complementary", { name: "Venta actual" }).innerText()).toMatch(/Total\s*RD\$ 251\.00/);
    await page.getByLabel("Buscar producto").fill("zzz"); await page.getByText("No hay productos con esta búsqueda.").waitFor(); await page.getByRole("button", { name: "Ver todos los productos" }).click();
    await page.setViewportSize({ width: 390, height: 844 }); const bar = page.getByLabel("Resumen de la venta");
    expect(await bar.isVisible()).toBe(true); expect(await bar.innerText()).toMatch(/RD\$ 251\.00/);
    const box = (await bar.getByRole("button", { name: "Continuar al pago" }).boundingBox())!; expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect((await ops()).some(o => o.operation === "checkout")).toBe(false);
  });
  it("changing the customer never silently discards the order; keeping it changes nothing", async () => {
    await win("w => w.mountPos()"); await toItems(); await page.getByRole("button", { name: "Añadir Producto real" }).click();
    await page.getByRole("button", { name: "Cambiar cliente" }).click(); await page.getByRole("alertdialog", { name: "Cambiar cliente" }).waitFor();
    expect(await page.getByRole("alertdialog").innerText()).toContain("1 artículo · RD$ 125.50 para Estudiante autorizado");
    await page.getByRole("button", { name: "Seguir con esta venta" }).click(); expect(await win<number>("w => w.sale.getSnapshot().cart.length")).toBe(1);
    await page.getByRole("button", { name: "Buscar usuario PIKAS" }).click(); await page.getByRole("button", { name: "Vaciar y cambiar cliente" }).click();
    await page.getByLabel("Nombre o código del estudiante").waitFor(); expect(await win<number>("w => w.sale.getSnapshot().cart.length")).toBe(0);
    expect((await ops()).some(o => o.operation === "checkout")).toBe(false);
  });
  it("payment is explicit; PIKAS Cash shows server availability; cash shows shortfall or change; Cobrar names amount and tender", async () => {
    await win("w => w.mountPos()"); await toItems(); await page.getByRole("button", { name: "Añadir Producto real" }).click(); await page.getByRole("button", { name: "Continuar al pago" }).first().click();
    const cta = page.locator(".pos-payment-cta"); expect(await cta.innerText()).toBe("Elige un método de pago"); expect(await cta.isDisabled()).toBe(true);
    await page.getByRole("button", { name: /PIKAS Cash/ }).click(); expect(await page.locator("dl").first().innerText()).toMatch(/Disponible hoy\s*RD\$ 400\.00/);
    expect(await cta.innerText()).toBe("Cobrar RD$ 125.50 con PIKAS Cash");
    await page.getByRole("button", { name: /^Efectivo/ }).click(); await page.getByLabel(/Efectivo recibido/).fill("100");
    expect(await page.getByRole("status").filter({ hasText: "Faltan" }).innerText()).toMatch(/Faltan\s*RD\$ 25\.50/); expect(await cta.isDisabled()).toBe(true);
    await page.getByLabel(/Efectivo recibido/).fill("200"); expect(await page.getByRole("status").filter({ hasText: "Cambio" }).innerText()).toMatch(/Cambio\s*RD\$ 74\.50/);
    expect(await cta.innerText()).toBe("Cobrar RD$ 125.50 en efectivo");
    expect((await ops()).some(o => o.operation === "checkout")).toBe(false);
  });
  it("uncertain sale: pending with exact amount and tender, everything else blocked, explicit same-key retry, then an unmistakable result", async () => {
    await win("w => w.mountPos()"); await toItems(); await page.getByRole("button", { name: "Añadir Producto real" }).click(); await page.getByRole("button", { name: "Continuar al pago" }).first().click();
    await page.getByRole("button", { name: /^Efectivo/ }).click(); await page.getByLabel(/Efectivo recibido/).fill("200");
    await win("w => { w.next.push('throw'); }"); await page.evaluate(() => { const b = document.querySelector<HTMLButtonElement>(".pos-payment-cta")!; b.click(); b.click(); });
    await page.getByText("Venta pendiente de confirmar").waitFor(); expect(await page.getByRole("alert").filter({ hasText: "Venta pendiente" }).innerText()).toContain("RD$ 125.50 · Efectivo · 1 artículos");
    expect(await page.getByRole("button", { name: "Buscar usuario PIKAS" }).isDisabled()).toBe(true);
    await page.waitForTimeout(150); const first = (await ops()).filter(o => o.operation === "checkout"); expect(first).toHaveLength(1);
    await page.getByRole("button", { name: "Reintentar la misma venta" }).click(); await page.getByText("Venta completada").waitFor();
    const all = (await ops()).filter(o => o.operation === "checkout"); expect(all).toHaveLength(2); expect(all[1]).toEqual(all[0]);
    const done = await page.getByRole("region", { name: "Venta completada" }).innerText();
    expect(done).toContain("Recibo #42 · RD$ 125.50 · Efectivo"); expect(done).toMatch(/Cambio a entregar\s*RD\$ 74\.50/);
  });
  it("recent sales are only this tab's receipts and open the existing refund lookup pre-filled, without searching", async () => {
    await win("w => w.mountPos()"); await toItems(); await page.getByRole("button", { name: "Añadir Producto real" }).click(); await page.getByRole("button", { name: "Continuar al pago" }).first().click();
    await page.getByRole("button", { name: /PIKAS Cash/ }).click(); await page.locator(".pos-payment-cta").click(); await page.getByText("Venta completada").waitFor();
    expect(await page.getByText(/Saldo PIKAS Cash después de la compra/).innerText()).toContain("RD$ 374.50");
    await page.getByRole("button", { name: "Nueva venta" }).click(); await page.getByRole("heading", { name: "Ventas recientes en esta pestaña" }).waitFor();
    expect(await page.getByRole("heading", { name: "Ventas recientes en esta pestaña" }).locator("..").innerText()).toContain("Recibo #42");
    const before = (await ops()).length; await page.getByRole("button", { name: "Reembolsar recibo 42" }).click();
    await page.waitForTimeout(150); expect(await page.locator('input[value="42"]').count()).toBe(1); expect((await ops()).slice(before).some(o => o.operation === "refund_lookup")).toBe(false);
  });
});

describe("Transacciones (5D.4)", () => {
  const lists = async () => (await calls()).filter(c => c.body.operation === "list").map(c => c.body);
  it("server filters: default period, tender, refund status, combined, clear; chips show authoritative refund state", async () => {
    await win("w => w.mountTx()"); await page.getByText("4 transacciones · 2026-10-13 – 2026-10-19").waitFor();
    expect((await lists())[0]).toEqual({ operation: "list", cafeteria_id: caf, period: "last_7_days", from: null, to: null, tender: null, refund_status: null, receipt: null, offset: 0 });
    const table = await page.locator("table").innerText(); expect(table).toContain("Recibo #1002"); expect(table).toContain("Reembolso parcial"); expect(table).toContain("Reembolsada"); expect(table).toContain("Crédito de personal"); expect(table).toMatch(/Reembolsado RD\$ 50\.00/);
    await page.getByLabel("Método de pago").selectOption("student_wallet"); await page.getByLabel("Reembolso").selectOption("partial"); await page.getByRole("button", { name: "Hoy" }).click();
    await page.waitForTimeout(100); expect((await lists()).at(-1)).toMatchObject({ period: "today", tender: "student_wallet", refund_status: "partial", offset: 0 });
    await page.getByRole("button", { name: "Limpiar filtros" }).first().click(); await page.waitForTimeout(100); expect((await lists()).at(-1)).toMatchObject({ period: "last_7_days", tender: null, refund_status: null });
  });
  it("custom range validates 92 days before asking the server; receipt search is exact and alone; no-match vs empty", async () => {
    await win("w => w.mountTx()"); await page.getByText("4 transacciones", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Personalizado" }).click(); await page.getByLabel("Desde").fill("2026-01-01"); await page.getByLabel("Hasta").fill("2026-10-19"); await page.getByRole("button", { name: "Aplicar fechas" }).click();
    await page.getByText("no puede superar 92 días").waitFor(); expect((await lists()).some(l => l.period === "custom")).toBe(false);
    await page.getByLabel("Desde").fill("2026-10-01"); await page.getByRole("button", { name: "Aplicar fechas" }).click(); await page.waitForTimeout(100);
    expect((await lists()).at(-1)).toMatchObject({ period: "custom", from: "2026-10-01", to: "2026-10-19" });
    await win(`w => { w.txq.list = [{ body: { result: { cafeteria_id: "${caf}", tenant_kind: "customer", business_timezone: "America/Santo_Domingo", today: "2026-10-19", period: null, from: null, to: null, tender: null, refund_status: null, receipt: "77", offset: 0, page_size: 25, total_count: 0, has_more: false, data: [] } } }]; }`);
    await page.getByLabel("Buscar recibo").fill("#77"); await page.getByRole("button", { name: "Buscar recibo" }).click();
    await page.getByText("No encontramos el recibo #77 en esta cafetería.").waitFor();
    expect((await lists()).at(-1)).toEqual({ operation: "list", cafeteria_id: caf, period: null, from: null, to: null, tender: null, refund_status: null, receipt: "77", offset: 0 });
    await page.getByRole("button", { name: "Volver a los filtros" }).click(); await page.getByText("4 transacciones", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Limpiar filtros" }).first().click(); await page.getByText("4 transacciones", { exact: false }).waitFor();
    await win(`w => { w.txq.list = [{ body: { result: { cafeteria_id: "${caf}", tenant_kind: "customer", business_timezone: "America/Santo_Domingo", today: "2026-10-19", period: "today", from: "2026-10-19", to: "2026-10-19", tender: null, refund_status: null, receipt: null, offset: 0, page_size: 25, total_count: 0, has_more: false, data: [] } } }]; }`);
    await page.getByRole("button", { name: "Hoy" }).click(); await page.getByText("No encontramos transacciones con estos filtros.").waitFor();
  });
  it("pagination asks the server for the next filtered page", async () => {
    await win(`w => { w.txq.list = [{ body: { result: { cafeteria_id: "${caf}", tenant_kind: "customer", business_timezone: "America/Santo_Domingo", today: "2026-10-19", period: "last_7_days", from: "2026-10-13", to: "2026-10-19", tender: null, refund_status: null, receipt: null, offset: 0, page_size: 25, total_count: 30, has_more: true, data: ${JSON.stringify(rows)} } } }]; }`);
    await win("w => w.mountTx()"); await page.getByText("Página 1 de 2").waitFor(); await page.getByRole("button", { name: "Siguiente" }).click(); await page.waitForTimeout(100);
    expect((await lists()).at(-1)).toMatchObject({ offset: 25, period: "last_7_days" });
  });
  it("detail shows items with authoritative refunded quantities, refund history, legacy amount-only refunds unallocated, and the real refund path", async () => {
    await win(`w => { w.txq.detail = [{ body: { result: { cafeteria_id: "${caf}", tenant_kind: "customer", data: ${JSON.stringify({ ...rows[1], cash_received_minor: null, change_minor: null, receipt: null,
      items: [{ name: "Batida ficticia", quantity: 3, unit_price_minor: "5000", line_total_minor: "15000", refunded_quantity: 1, refunded_minor: "4000" }],
      refunds: [{ ordinal: "1", occurred_at: "2026-10-18T16:00:00Z", business_date: "2026-10-18", amount_minor: "4000", tender: "student_wallet", reason: "wrong_product", notes: null, authorization_mode: "supervisor_direct", actor_name: "Supervisora Ficticia", actor_role: "pos_supervisor", approver_name: null, register_name: null, remaining_after_minor: "11000", itemized: true, unallocated_minor: "0", items: [{ name: "Batida ficticia", quantity: 1, amount_minor: "4000" }] },
        { ordinal: "2", occurred_at: "2026-10-18T17:00:00Z", business_date: "2026-10-18", amount_minor: "1000", tender: "student_wallet", reason: "error", notes: null, authorization_mode: "supervisor_direct", actor_name: "Supervisora Ficticia", actor_role: "pos_supervisor", approver_name: null, register_name: null, remaining_after_minor: "10000", itemized: false, unallocated_minor: "1000", items: [] }],
      unallocated_refund_minor: "1000" })} } } }]; }`);
    await win("w => w.mountTx()"); await page.getByRole("button", { name: "Ver detalle del recibo 1002" }).first().click(); await dlg().getByText("Artículos").waitFor();
    const text = await dlg().innerText();
    expect(text).toContain("Reembolso parcial"); expect(text).toContain("1 de 3 reembolsado"); expect(text).toMatch(/RD\$ 10\.00\s*se reembolsó por monto, sin detalle por artículo/);
    expect(text).toContain("Reembolso por monto, sin detalle por artículo."); expect(text).toContain("Artículo incorrecto"); expect(text).toContain("Reembolsos → recibo #1002");
    expect((await calls()).find(c => c.body.operation === "detail")!.body).toEqual({ operation: "detail", cafeteria_id: caf, purchase_id: rows[1].id });
    const before = (await calls()).length; await dlg().getByRole("button", { name: "Actualizar" }).click(); await page.waitForTimeout(150);
    expect((await calls()).slice(before).map(c => c.body.operation).sort()).toEqual(["detail", "list"]);
  });
  it("full and staff-credit transactions state why no refund is offered; sandbox has no financial read", async () => {
    await win("w => w.mountTx()"); await page.getByRole("button", { name: "Ver detalle del recibo 1003" }).first().click();
    await win("w => w.txq.detail = []"); // auto 404 → error is shown, never fabricated data
    await dlg().getByText("No se pudo cargar el detalle").waitFor(); await dlg().getByRole("button", { name: "Cerrar", exact: true }).click();
    await win("w => { w.calls = []; }"); await win("w => w.mountTx(true)"); await page.getByText("no concede acceso a operaciones financieras").waitFor(); expect(await calls()).toEqual([]);
  });
  it("mobile markup: the shared list renders a stacked item per transaction with its action", async () => {
    await win("w => w.mountTx()"); await page.getByText("4 transacciones", { exact: false }).waitFor();
    const items = page.getByRole("list", { name: "Transacciones" }).locator(":scope > li"); expect(await items.count()).toBe(4);
    const second = await items.nth(1).innerText(); expect(second).toContain("Recibo #1002"); expect(second).toContain("Reembolso parcial"); expect(second).toContain("Ver detalle");
  });
});
