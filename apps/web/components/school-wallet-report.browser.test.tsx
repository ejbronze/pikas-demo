import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Phase 5D.5 School PIKAS Cash report in real Chromium against a scripted /api route. Requests are
// recorded; every number on screen must come from the scripted server result.
let browser: Browser, server: Server, page: Page, url: string, native = false;
const win = <T,>(fn: string) => page.evaluate(`(${fn})(window)`) as Promise<T>;
const school = "5d500000-0000-4000-8000-000000000001", caf = "5d500000-0000-4000-8000-000000000003", caf2 = "5d500000-0000-4000-8000-000000000004";
const tally = (amount_minor: string, count: number) => ({ amount_minor, count });
const report = (over: Record<string, unknown> = {}, movements: Record<string, unknown> = {}) => ({ school_id: school, tenant_kind: "customer", business_timezone: "America/Santo_Domingo", currency_code: "DOP",
  period: "last_30_days", from: "2026-09-20", to: "2026-10-19", today: "2026-10-19", as_of: "2026-10-19T15:00:00Z",
  current: { total_balance_minor: "15400", wallet_count: 3, active_wallet_count: 2, frozen_wallet_count: 1, negative_wallet_count: 1, negative_balance_minor: "-500" },
  movements: { replenishments: tally("22500", 3), reversals: tally("2500", 1), net_replenished_minor: "20000", purchases: tally("11500", 2), refunds: tally("5000", 1),
    adjustment_credits: tally("1000", 1), adjustment_debits: tally("1100", 2), historical_adjustments: { net_minor: "0", count: 0 }, net_movement_minor: "13400", entry_count: 10, wallets_with_movement: 2, ...movements }, ...over });
// What the route used to send: the per-cafetería breakdown. The School browser must refuse it (UX 7).
const cafeterias = [{ cafeteria_id: caf, name: "Cafetería Norte", spent_minor: "8500", purchase_count: 1, refunded_minor: "5000", refund_count: 1 }, { cafeteria_id: caf2, name: "Cafetería Sur", spent_minor: "3000", purchase_count: 1, refunded_minor: "0", refund_count: 0 }];

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
      b.onLoad({ filter: /^link$/, namespace: "stub" }, () => ({ resolveDir: process.cwd(), contents: "import React from 'react'; export default ({href, children, prefetch, ...rest}) => React.createElement('a', {href, ...rest}, children)", loader: "js" }));
    } }],
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { SchoolWalletReport } from "./components/school-wallet-report";
      const w = window; w.calls = []; w.queue = [];
      w.fetch = async (input, init = {}) => { const body = JSON.parse(init.body); w.calls.push(body); const r = w.queue.shift() ?? w.auto(body);
        return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } }); };
      let root; w.mount = () => { root ??= createRoot(document.getElementById("root")); root.render(<SchoolWalletReport key={Math.random()} schoolId="${school}" />); };
    ` } });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_q, r) => { r.setHeader("Content-Type", "text/html"); r.end(`<html lang="es"><head><meta charset="utf-8"></head><body><div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise<void>((ok, ko) => { server.once("error", ko); server.listen(0, "127.0.0.1", ok); });
  const a = server.address(); if (!a || typeof a === "string") throw Error("listener"); url = `http://127.0.0.1:${a.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);
beforeEach(async () => { native = false; page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(5000); page.on("dialog", d => { native = true; void d.dismiss(); }); await page.goto(url); await auto(); });
afterEach(async () => { expect(native).toBe(false); await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>(ok => server?.close(() => ok())); });
const auto = (over: Record<string, unknown> = {}, movements: Record<string, unknown> = {}) => page.evaluate(([base, mv]) => { (window as unknown as { auto(b: Record<string, unknown>): unknown }).auto = (b) => ({ body: { result: { ...base, ...mv, period: b.period, ...(b.period === "custom" ? { from: b.from, to: b.to } : b.period === "today" ? { from: "2026-10-19", to: "2026-10-19" } : {}) } } }); }, [report(over, movements), {}] as const);
const calls = () => win<Record<string, unknown>[]>("w => w.calls");
const text = () => page.locator("section").first().innerText();

describe("School PIKAS Cash report (5D.5)", () => {
  it("current balance is labeled point-in-time; period metrics and corrections come from the server; no cafetería breakdown", async () => {
    await win("w => w.mount()"); await page.getByText("Saldo PIKAS Cash total").waitFor();
    expect((await calls())[0]).toEqual({ school_id: school, period: "last_30_days", from: null, to: null });
    const t = await text();
    expect(t).toMatch(/Saldo PIKAS Cash total\s*RD\$ 154\.00/); expect(t).toContain("No depende del período"); expect(t).toContain("2 activos"); expect(t).toContain("1 congelado");
    expect(t).toMatch(/Saldos negativos\s*−RD\$ 5\.00/);
    expect(t).toMatch(/Recargas\s*\+RD\$ 225\.00\s*3 recargas/); expect(t).toMatch(/Compras con PIKAS Cash\s*−RD\$ 115\.00\s*2 compras/); expect(t).toMatch(/Reembolsos a PIKAS Cash\s*\+RD\$ 50\.00/);
    expect(t).toMatch(/Reversiones de recarga[\s\S]*no son reembolsos de compras[\s\S]*−RD\$ 25\.00/); expect(t).toMatch(/Recargas netas[\s\S]*\+RD\$ 200\.00/);
    expect(t).toMatch(/Movimiento neto del período[\s\S]*\+RD\$ 134\.00/); expect(t).not.toContain("Ajustes históricos");
    expect(await page.locator("table").count()).toBe(0); expect(t).not.toMatch(/¿Dónde se usó|por cafetería|Cafetería Norte|Cafetería Sur|ventas totales/);
    expect(t).not.toMatch(/Ventas brutas|Ventas netas|Efectivo|Ticket|Transacciones|Crédito de personal|Esperado|Contado/);
  });
  it("periods and custom range: the 92-day guard runs before the server; every change re-reads", async () => {
    await win("w => w.mount()"); await page.getByText("Saldo PIKAS Cash total").waitFor();
    await page.getByRole("button", { name: "Hoy" }).click(); await page.getByText("2026-10-19 · fechas de operación").waitFor();
    expect((await calls()).at(-1)).toMatchObject({ period: "today", from: null, to: null });
    await page.getByRole("button", { name: "Personalizado" }).click(); await page.getByLabel("Desde").fill("2026-01-01"); await page.getByLabel("Hasta").fill("2026-10-19"); await page.getByRole("button", { name: "Aplicar fechas" }).click();
    await page.getByText("no puede superar 92 días").waitFor(); expect((await calls()).some(c => c.period === "custom")).toBe(false);
    await page.getByLabel("Desde").fill("2026-09-01"); await page.getByRole("button", { name: "Aplicar fechas" }).click(); await page.getByText("2026-09-01 – 2026-10-19").waitFor();
    expect((await calls()).at(-1)).toEqual({ school_id: school, period: "custom", from: "2026-09-01", to: "2026-10-19" });
  });
  it("empty states: no wallets, no movement in the period, no purchases; server errors are not zeros", async () => {
    await auto({ current: { total_balance_minor: "0", wallet_count: 0, active_wallet_count: 0, frozen_wallet_count: 0, negative_wallet_count: 0, negative_balance_minor: "0" } },
      { replenishments: tally("0", 0), reversals: tally("0", 0), net_replenished_minor: "0", purchases: tally("0", 0), refunds: tally("0", 0), adjustment_credits: tally("0", 0), adjustment_debits: tally("0", 0), net_movement_minor: "0", entry_count: 0, wallets_with_movement: 0 });
    await win("w => w.mount()"); await page.getByText("Aún no hay monederos PIKAS Cash en esta escuela.").waitFor();
    await page.getByText("Sin movimientos de PIKAS Cash en este período.").waitFor();
    expect(await text()).not.toContain("RD$ 0.00 en ventas");
    await auto({}, { purchases: tally("0", 0) }); await win("w => w.mount()"); await page.getByText("Saldo PIKAS Cash total").waitFor();
    expect(await page.getByText("Sin movimientos de PIKAS Cash").count()).toBe(0);
    await win("w => { w.queue.push({ status: 403, body: { error: 'school_authority_required' } }); w.mount(); }"); await page.getByText("Tu rol no puede consultar el reporte de PIKAS Cash").waitFor();
    expect(await page.getByText("Saldo PIKAS Cash total").count()).toBe(0);
  });
  it("a response that still carries the per-cafetería breakdown is refused, never rendered", async () => {
    await auto({ cafeterias }); await win("w => w.mount()"); await page.getByText("No se pudo cargar el reporte de PIKAS Cash.").waitFor();
    expect(await page.locator("body").innerText()).not.toMatch(/Cafetería Norte|Cafetería Sur/);
  });
  it("historical adjustments appear only when present, labeled as such", async () => {
    await auto({}, { historical_adjustments: { net_minor: "-300", count: 1 } }); await win("w => w.mount()"); await page.getByText("Ajustes históricos").waitFor();
    expect(await text()).toMatch(/Ajustes históricos[\s\S]*−RD\$ 3\.00/);
  });
});
