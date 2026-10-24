import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Settlement views and Platform settlement tasks in real Chromium at 390 px. fetch is scripted: no server, Auth,
// database or money.
const caf = "5e000000-0000-4000-8000-000000000111";
let browser: Browser, server: Server, page: Page, url: string;
type Call = { url: string; key: string | null; body: Record<string, unknown> };
const win = <T,>(fn: string) => page.evaluate(`(${fn})(window)`) as Promise<T>;
const settlement = (over: Record<string, unknown>) => ({ reference: "LIQ-00000001", status: "due", week_start: "2026-10-19", week_end: "2026-10-25", due_on: "2026-10-27",
  cafeteria_owes_minor: "1000000", clearing_owes_minor: "750000", net_direction: "cafeteria_to_clearing", net_amount_minor: "250000", line_count: 2, late_line_count: 0,
  finalized_at: "2026-10-26T12:00:00Z", settled_at: null, ...over });
const lines = [
  { reason: "cash_collection", direction: "cafeteria_to_clearing", amount_minor: "1000000", occurred_at: "2026-10-20T14:00:00Z", week_start: "2026-10-19", late: false, replenishment_reference: "REC-00000007", student: "Ana Ficticia", receipt_number: null, refund_ordinal: null },
  { reason: "wallet_purchase_fulfillment", direction: "clearing_to_cafeteria", amount_minor: "750000", occurred_at: "2026-10-21T14:00:00Z", week_start: "2026-10-19", late: false, replenishment_reference: null, student: "Ana Ficticia", receipt_number: "12", refund_ordinal: null },
  { reason: "wallet_refund_correction", direction: "cafeteria_to_clearing", amount_minor: "5000", occurred_at: "2026-10-27T14:00:00Z", week_start: "2026-10-12", late: true, replenishment_reference: null, student: "Ana Ficticia", receipt_number: "9", refund_ordinal: 1 }];
const events = [{ kind: "finalized", from_status: null, to_status: "due", amount_minor: null, payment_reference: null, paid_on: null, reason: null, note: null, occurred_at: "2026-10-26T12:00:00Z", actor: null }];
const read = { cafeteria_id: caf, enabled: true, current: { week_start: "2026-10-26", week_end: "2026-11-01", due_on: "2026-11-03", cafeteria_owes_minor: "300000", clearing_owes_minor: "120000", line_count: 4 },
  pending: [{ week_start: "2026-10-19", week_end: "2026-10-25", due_on: "2026-10-27", cafeteria_owes_minor: "400000", clearing_owes_minor: "800000", line_count: 6 }],
  settlements: [settlement({}), settlement({ reference: "LIQ-00000002", week_start: "2026-10-12", week_end: "2026-10-18", due_on: "2026-10-20", cafeteria_owes_minor: "400000", clearing_owes_minor: "800000",
    net_direction: "clearing_to_cafeteria", net_amount_minor: "400000", status: "settled", settled_at: "2026-10-20T15:00:00Z" }),
  settlement({ reference: "LIQ-00000003", week_start: "2026-10-05", week_end: "2026-10-11", due_on: "2026-10-13", cafeteria_owes_minor: "10000", clearing_owes_minor: "10000", net_direction: "none", net_amount_minor: "0", status: "settled", settled_at: "2026-10-12T15:00:00Z" })] };

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", loader: { ".svg": "dataurl" }, define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "nav", namespace: "stub" }));
      b.onLoad({ filter: /^nav$/, namespace: "stub" }, () => ({ resolveDir: process.cwd(), loader: "js", contents: "export const useRouter = () => ({ refresh(){ window.refreshes++; }, push(h){ window.pushed.push(h); } }); export const usePathname = () => '/';" }));
    } }],
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { CafeteriaSettlements } from "./components/cafeteria-settlements";
      import { SettlementActions, FinalizeSettlement } from "./app/platform/finanzas/liquidaciones/settlement-actions";
      const w = window; w.calls = []; w.refreshes = 0; w.pushed = []; let script = {};
      const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
      w.script = s => { script = s; };
      w.fetch = (input, init) => { const body = JSON.parse(init?.body ?? "null"); w.calls.push({ url: String(input), key: new Headers(init?.headers).get("Idempotency-Key"), body });
        const r = script[body.operation]; if (r === "throw") return Promise.reject(new TypeError("network")); return r ? json(r.status, r.body) : json(500, {}); };
      let root; const mount = el => { root ??= createRoot(document.getElementById("root")); root.render(el); };
      w.mountCafeteria = () => mount(<CafeteriaSettlements key={Math.random()} cafeteriaId="${caf}" />);
      w.mountActions = (status, direction) => mount(<SettlementActions key={Math.random()} actor="op1" reference="LIQ-00000001" cafeteria="Cafetería Las Palmas" week="Semana 19–25 oct" status={status} direction={direction} net="250000" />);
      w.mountFinalize = () => mount(<FinalizeSettlement key={Math.random()} actor="op1" cafeteriaId="${caf}" cafeteria="Cafetería Las Palmas" weekStart="2026-10-19" weekEnd="2026-10-25" direction="cafeteria_to_clearing" net="250000" />);
    ` } });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_q, r) => { r.setHeader("Content-Type", "text/html"); r.end(`<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise<void>((ok, ko) => { server.once("error", ko); server.listen(0, "127.0.0.1", ok); });
  const a = server.address(); if (!a || typeof a === "string") throw Error("listener"); url = `http://127.0.0.1:${a.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);
beforeEach(async () => { page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(url); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>(ok => server?.close(() => ok())); });
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const dialog = () => page.getByRole("dialog");
const text = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");

describe("Cafetería Liquidaciones", () => {
  it("open week, weeks in calculation and settlements say who owes whom in words, at 390 px", async () => {
    await page.evaluate(r => (window as unknown as { script(s: unknown): void }).script({ read: { status: 200, body: { result: r } } }), read);
    await win("w => w.mountCafeteria()"); await page.getByText("Semana en curso").waitFor(); const t = await text();
    for (const s of ["Semana en curso · Semana 26 oct – 1 nov", "Debes enviar a PIKAS RD$ 1,800.00", "Semanas cerradas en cálculo", "PIKAS te debe RD$ 4,000.00", "PIKAS calculará esta liquidación",
      "Debes enviar a PIKAS RD$ 2,500.00", "Pendiente de pago", "Liquidada", "Sin saldo pendiente RD$ 0.00", "Por enviar a PIKAS (efectivo recibido y reembolsos) RD$ 10,000.00",
      "Por recibir de PIKAS (ventas con PIKAS Cash) RD$ 7,500.00", "PIKAS no mueve dinero"]) expect(t).toContain(s);
    expect(await fits()).toBe(true);
    // Raw CSS here skips Tailwind @apply: assert every control uses the 44 px button classes (measured in the staged build).
    expect(await page.evaluate(() => [...document.querySelectorAll("button")].filter(b => !/\bbtn(-secondary)?\b/.test(b.className)).map(b => b.textContent))).toEqual([]);
    expect((await win<Call[]>("w => w.calls")).every(c => c.body.operation === "read")).toBe(true);
  });
  it("detail: every movement grouped, late items explained, PIKAS events without operator names; focus moves to the week", async () => {
    await page.evaluate(([r, d]) => (window as unknown as { script(s: unknown): void }).script({ read: { status: 200, body: { result: r } }, detail: { status: 200, body: { result: d } } }),
      [read, { ...settlement({ late_line_count: 1, status: "in_review" }), cafeteria: "Cafetería Las Palmas", lines, events }] as const);
    await win("w => w.mountCafeteria()"); await page.getByRole("button", { name: "Ver detalle de Semana 19–25 oct" }).click(); await page.getByText("Movimientos incluidos (3)").waitFor();
    const t = await text();
    for (const s of ["Efectivo recibido para PIKAS Cash", "REC-00000007 · Ana Ficticia", "Ventas pagadas con PIKAS Cash", "Recibo #12", "Reembolsos y correcciones", "Recibo #9 · reembolso 1",
      "registrado después de su liquidación", "PIKAS está revisando esta liquidación", "Los totales calculados no se editan", "Liquidación calculada", "· PIKAS"]) expect(t).toContain(s);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("settlement-heading");
    expect(await page.getByRole("button", { name: /Confirmar|revisión|Editar/ }).count()).toBe(0); expect(await fits()).toBe(true);
    await page.getByRole("button", { name: "Volver a liquidaciones" }).click(); await page.getByText("Semana en curso").waitFor();
  });
  it("not enabled and unavailable states", async () => {
    await page.evaluate(r => (window as unknown as { script(s: unknown): void }).script({ read: { status: 200, body: { result: { ...r, enabled: false, settlements: [], pending: [] } } } }), read);
    await win("w => w.mountCafeteria()"); await page.getByText("Las liquidaciones no están habilitadas para este cliente").waitFor();
    await win("w => w.script({ read: { status: 502, body: { error: 'settlements_unavailable' } } })"); await win("w => w.mountCafeteria()");
    await page.getByText("No pudimos cargar las liquidaciones.").waitFor(); await page.getByRole("button", { name: "Reintentar" }).waitFor();
  });
});

describe("Platform settlement tasks", () => {
  const result = (over: Record<string, unknown>) => ({ status: 200, body: { result: { reference: "LIQ-00000001", status: "settled", net_direction: "cafeteria_to_clearing", net_amount_minor: "250000", replayed: false, ...over } } });
  it("payment: a labelled dialog at 390 px; a different amount warns it goes to review; the exact command carries the key", async () => {
    await win("w => w.mountActions('due', 'cafeteria_to_clearing')"); await page.getByRole("button", { name: "Confirmar pago recibido" }).click(); await dialog().waitFor();
    expect(await dialog().getAttribute("aria-labelledby")).toBeTruthy(); expect(await page.evaluate(() => document.querySelector("dialog[open]")?.contains(document.activeElement))).toBe(true);
    expect(await dialog().getByLabel("Monto del pago").getAttribute("inputmode")).toBe("decimal");
    await dialog().getByRole("button", { name: "Continuar" }).click(); await dialog().getByText("Escribe el monto con hasta dos decimales.").waitFor();
    await dialog().getByLabel("Monto del pago").fill("2,000"); await dialog().getByLabel("Referencia del pago").fill("TRX-778");
    await dialog().getByText("El monto no coincide con el neto de RD$ 2,500.00").waitFor(); expect(await fits()).toBe(true);
    await dialog().getByLabel("Monto del pago").fill("2,500.00"); expect(await dialog().getByText("El monto no coincide").count()).toBe(0);
    await dialog().getByRole("button", { name: "Continuar" }).click(); await win(`w => w.script(${JSON.stringify({ payment: result({}) })})`);
    await dialog().getByRole("button", { name: "Confirmar RD$ 2,500.00" }).click(); await dialog().getByText("LIQ-00000001 quedó liquidada.").waitFor();
    const [call] = await win<Call[]>("w => w.calls");
    expect(call.url).toBe("/api/platform/finance/settlement"); expect(call.body).toMatchObject({ operation: "payment", reference: "LIQ-00000001", amount_minor: "250000", payment_reference: "TRX-778" });
    expect(call.key).toMatch(/^[0-9a-f-]{36}$/); expect(await page.evaluate(() => Object.keys(sessionStorage).length)).toBe(0);
  });
  it("PIKAS owes: payout wording; an uncertain answer only offers the same request", async () => {
    await win("w => w.mountActions('due', 'clearing_to_cafeteria')"); await page.getByRole("button", { name: "Confirmar pago a la cafetería" }).click();
    await dialog().getByText("Registra el pago que PIKAS hizo a la cafetería").waitFor();
    await dialog().getByLabel("Monto del pago").fill("2500"); await dialog().getByLabel("Referencia del pago").fill("PAGO-55"); await dialog().getByRole("button", { name: "Continuar" }).click();
    await win("w => w.script({ payment: 'throw' })"); await dialog().getByRole("button", { name: "Confirmar RD$ 2,500.00" }).click(); await dialog().getByText("Operación pendiente de confirmar").waitFor();
    await win(`w => w.script(${JSON.stringify({ payment: result({ net_direction: "clearing_to_cafeteria" }) })})`);
    await dialog().getByRole("button", { name: "Reintentar la misma operación" }).click(); await dialog().getByText("quedó liquidada").waitFor();
    const calls = await win<Call[]>("w => w.calls"); expect(calls).toHaveLength(2); expect(calls[1].key).toBe(calls[0].key); expect(calls[1].body).toEqual(calls[0].body);
  });
  it("review: opening needs a reason, resolving needs a note; refusals are named", async () => {
    await win("w => w.mountActions('due', 'cafeteria_to_clearing')"); await page.getByRole("button", { name: "Poner en revisión" }).click();
    await dialog().getByRole("button", { name: "Continuar" }).click(); await dialog().getByText("Selecciona el motivo de la revisión.").waitFor();
    await dialog().getByLabel("Motivo de la revisión").selectOption("refund_missing"); await dialog().getByRole("button", { name: "Continuar" }).click();
    await win(`w => w.script(${JSON.stringify({ review: { status: 422, body: { error: "SETTLEMENT_STATUS_CONFLICT" } } })})`);
    await dialog().getByRole("button", { name: "Poner en revisión" }).click(); await dialog().getByText("El estado de esta liquidación cambió").waitFor();
    await dialog().getByRole("button", { name: "Ver estado actual" }).click(); expect(await win<number>("w => w.refreshes")).toBe(1);
    await win("w => w.mountActions('in_review', 'cafeteria_to_clearing')"); await page.getByRole("button", { name: "Resolver revisión" }).click();
    await dialog().getByRole("button", { name: "Continuar" }).click(); await dialog().getByText("Escribe una nota (al menos 3 caracteres).").waitFor();
  });
  it("finalize: one confirmation, then opens the new settlement", async () => {
    await win("w => w.mountFinalize()"); await page.getByRole("button", { name: "Calcular liquidación" }).click();
    await dialog().getByText("La liquidación queda fija").waitFor(); await win(`w => w.script(${JSON.stringify({ finalize: result({ status: "due" }) })})`);
    await dialog().getByRole("button", { name: "Calcular liquidación" }).click(); await dialog().getByRole("button", { name: "Abrir liquidación" }).click();
    expect(await win<string[]>("w => w.pushed")).toEqual(["/platform/finanzas/liquidaciones/LIQ-00000001"]);
    expect((await win<Call[]>("w => w.calls"))[0].body).toEqual({ operation: "finalize", cafeteria_id: caf, week_start: "2026-10-19" });
  });
});
