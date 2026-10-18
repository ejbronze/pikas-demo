import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Cafeteria Admin exceptional close task in real Chromium; fetch is scripted. No server, Auth or money.
const sid = "5a000000-0000-4000-8000-000000000011", cafe = "5a000000-0000-4000-8000-000000000012", actor = "5a000000-0000-4000-8000-000000000013";
let browser: Browser, server: Server, page: Page, url: string;
type Call = { key: string | null; body: Record<string, unknown> };
type W = { mount(): void; respond(status: number, body: unknown): void; hold(): void; release(status: number, body: unknown): void; closeOk(counted: string, expected: string, difference: string): void; calls: Call[]; outcomes: string[] };
const win = (fn: string) => page.evaluate(`(${fn})(window)`);

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"test"' },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { RegisterCloseTask } from "./components/register-close-task";
      const w = window; w.calls = []; w.outcomes = []; let next = null, held = null;
      const session = (over = {}) => ({ id: "${sid}", register_id: "${cafe}", register_name: "Caja Patio", register_code: "UX2", operator_id: "${cafe}", operator_name: "Cajera Ficticia",
        opened_at: "2026-10-18T12:00:00Z", status: "open", version: 1, currency: "DOP", closed_at: null, closed_by: null, close_type: null, reason: null, note: null, counted_minor: null,
        summary: { opening_minor: "300000", cash_sales_minor: "42500", cash_refunds_minor: "0", cash_settlements_minor: "0", purchase_count: 4, expected_minor: "342500" }, difference_minor: null, close_snapshot: false, ...over });
      w.respond = (status, body) => { next = { status, body }; }; w.hold = () => { next = "hold"; };
      w.release = (status, body) => { const r = held; held = null; r(new Response(JSON.stringify(body), { status })); };
      w.closeOk = (counted, expected, difference) => { next = (b) => ({ status: 200, body: { result: { request_key: b.request_key, session: session({ status: "closed", version: 2, closed_at: "2026-10-18T20:00:00Z", closed_by: "Admin Ficticia", close_type: "exceptional", reason: b.reason, note: b.note || null,
        counted_minor: counted, summary: { opening_minor: "300000", cash_sales_minor: "42500", cash_refunds_minor: "0", cash_settlements_minor: "0", purchase_count: 4, expected_minor: expected }, difference_minor: difference, close_snapshot: true }) } } }); };
      w.fetch = (input, init) => { const body = JSON.parse(init.body); w.calls.push({ key: new Headers(init.headers).get("Idempotency-Key"), body });
        if (next === "hold") return new Promise(r => { held = r; });
        const n = typeof next === "function" ? next(body) : next ?? { status: 503, body: {} };
        return Promise.resolve(new Response(JSON.stringify(n.body), { status: n.status })); };
      let root;
      function Host() { const [open, setOpen] = useState(false); return <><button id="trigger" onClick={() => setOpen(true)}>Cerrar caja</button>{open && <RegisterCloseTask session={session()} cafeteriaId="${cafe}" actorId="${actor}"
        onClose={() => { w.outcomes.push("close"); setOpen(false); }} onClosed={(ok) => { w.outcomes.push(ok ? "closed" : "rejected"); setOpen(false); }} />}</>; }
      w.mount = () => { root ??= createRoot(document.getElementById("root")); root.render(<Host key={Math.random()} />); };
    ` } });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_q, r) => { r.setHeader("Content-Type", "text/html"); r.end(`<html lang="es"><body><div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise<void>((ok, ko) => { server.once("error", ko); server.listen(0, "127.0.0.1", ok); });
  const a = server.address(); if (!a || typeof a === "string") throw Error("listener"); url = `http://127.0.0.1:${a.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);
beforeEach(async () => { page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(url); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>(ok => server?.close(() => ok())); });

const open = async () => { await win("w => w.mount()"); await page.locator("#trigger").click(); await page.locator("dialog[open]").waitFor(); };
const dlg = () => page.locator("dialog[open]");
const calls = () => win("w => w.calls") as Promise<Call[]>;
const storage = () => page.evaluate(() => ({ ...sessionStorage }));
const toReview = async (amount: string) => { await dlg().getByLabel("Efectivo contado (RD$)").fill(amount); await dlg().getByRole("button", { name: "Continuar" }).click(); };

describe("Cafeteria Admin register close task (Option A, 5A semantics)", () => {
  it("count → review shows expected, count and estimated difference; nothing is sent before the explicit close", async () => {
    await open(); expect(await page.evaluate(() => (document.activeElement as HTMLElement).closest("label")?.textContent)).toContain("Efectivo contado");
    await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByText("Ingresa el efectivo contado").waitFor();
    await toReview("3400");
    const text = await dlg().innerText();
    expect(text).toMatch(/Efectivo contado\s+RD\$ 3,400\.00/); expect(text).toMatch(/Efectivo esperado actual\s+RD\$ 3,425\.00/); expect(text).toMatch(/Diferencia estimada\s+Faltante −RD\$ 25\.00/);
    await dlg().getByRole("button", { name: "Cerrar caja con RD$ 3,400.00" }).waitFor();
    expect(await calls()).toHaveLength(0); expect(await storage()).toEqual({});
  });
  it("sends the reviewed expected exactly as required and shows the authoritative stored reconciliation", async () => {
    await open(); await dlg().getByLabel("Motivo").selectOption("operator_unavailable"); await toReview("3450");
    await win(`w => w.closeOk("345000", "342000", "3000")`); // server values differ from the client estimate on purpose
    await dlg().getByRole("button", { name: "Cerrar caja con RD$ 3,450.00" }).click(); await dlg().getByText("Cierre registrado").waitFor();
    const [call] = await calls();
    expect(call.body).toMatchObject({ operation: "close", cafeteria_id: cafe, session_id: sid, version: 1, counted_minor: "345000", expected_minor: "342500", reason: "operator_unavailable" });
    expect(call.key).toBe(call.body.request_key);
    const text = await dlg().innerText(); expect(text).toMatch(/Contado\s+RD\$ 3,450\.00/); expect(text).toMatch(/Esperado\s+RD\$ 3,420\.00/); expect(text).toMatch(/Diferencia\s+Sobrante \+RD\$ 30\.00/);
    expect(await storage()).toEqual({});
    await dlg().getByRole("button", { name: "Cerrar", exact: true }).click(); expect(await win("w => w.outcomes")).toEqual(["closed"]);
  });
  it.each([["3425", "342500", "0", /Diferencia\s+Cuadrada/], ["3400", "340000", "-2500", /Diferencia\s+Faltante −RD\$ 25\.00/]])("result for counted %s presents the stored status", async (amount, counted, difference, expected) => {
    await open(); await toReview(amount); await win(`w => w.closeOk("${counted}", "342500", "${difference}")`);
    await dlg().getByRole("button", { name: /^Cerrar caja con/ }).click(); await dlg().getByText("Cierre registrado").waitFor(); expect(await dlg().innerText()).toMatch(expected);
  });
  it("pending blocks Escape, × and a second close", async () => {
    await open(); await toReview("3425"); await win("w => w.hold()");
    await dlg().getByRole("button", { name: "Cerrar caja con RD$ 3,425.00" }).click(); await dlg().getByText("Cerrando la caja…").waitFor();
    await page.keyboard.press("Escape"); expect(await dlg().getByRole("button", { name: "Cerrar tarea" }).isDisabled()).toBe(true);
    expect(await dlg().getByRole("button", { name: "Cerrando caja…" }).isDisabled()).toBe(true); expect(await calls()).toHaveLength(1);
    await page.evaluate(() => (window as unknown as W).release(409, { error: "operation_unconfirmed", definite: true }));
    await dlg().getByText("No se cerró la caja").waitFor(); expect(await storage()).toEqual({});
    await dlg().getByRole("button", { name: "Revisar la sesión actualizada" }).click(); expect(await win("w => w.outcomes")).toEqual(["rejected"]);
  });
  it("an uncertain close is never presented as done; after reload only an explicit retry of the same key and payload", async () => {
    await open(); await toReview("3425"); await win("w => w.respond(503, {})");
    await dlg().getByRole("button", { name: "Cerrar caja con RD$ 3,425.00" }).click(); await dlg().getByText("Cierre pendiente de confirmar").waitFor();
    expect(await dlg().innerText()).not.toMatch(/Cierre registrado|No se cerró/);
    const first = (await calls())[0]; expect(Object.keys(await storage())).toHaveLength(1);
    await page.reload(); await open(); await dlg().getByText("Cierre pendiente de confirmar").waitFor();
    expect(await dlg().getByLabel("Efectivo contado (RD$)").count()).toBe(0); await page.waitForTimeout(250); expect(await calls()).toHaveLength(0);
    await win("w => w.respond(503, {})"); await dlg().getByRole("button", { name: "Reintentar el mismo cierre" }).click(); await dlg().getByText("Cierre pendiente de confirmar").waitFor();
    const retry = (await calls())[0]; expect(retry.key).toBe(first.key); expect(retry.body).toEqual(first.body);
  });
  it("typed count is never persisted: discard prompt, and a refresh restores nothing", async () => {
    await open(); await dlg().getByLabel("Efectivo contado (RD$)").fill("3425"); await page.keyboard.press("Escape");
    await dlg().getByText("¿Descartar los datos ingresados?").waitFor(); await dlg().getByRole("button", { name: "Seguir editando" }).click();
    expect(await storage()).toEqual({}); await page.reload(); await open(); expect(await dlg().getByLabel("Efectivo contado (RD$)").inputValue()).toBe(""); expect(await calls()).toHaveLength(0);
  });
});
