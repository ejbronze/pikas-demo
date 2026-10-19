import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Platform customer lifecycle task in real Chromium against a scripted /api route. Every request is
// recorded (key + body); the server decides, the UI only presents.
let browser: Browser, server: Server, page: Page, url: string, native = false;
const win = <T,>(fn: string) => page.evaluate(`(${fn})(window)`) as Promise<T>;
const account = "6c000000-0000-4000-8000-0000000000aa";

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
      b.onLoad({ filter: /^link$/, namespace: "stub" }, () => ({ resolveDir: process.cwd(), contents: "import React from 'react'; export default ({href, children, prefetch, ...rest}) => React.createElement('a', {href, ...rest}, children)", loader: "js" }));
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "nav", namespace: "stub" }));
      b.onLoad({ filter: /^nav$/, namespace: "stub" }, () => ({ contents: "export const useRouter = () => ({ refresh() { window.refreshes = (window.refreshes ?? 0) + 1; }, push() {}, replace() {} }); export const usePathname = () => '/';", loader: "js" }));
    } }],
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { CustomerLifecyclePanel } from "./app/platform/clientes/[accountId]/lifecycle-panel";
      const w = window; w.calls = []; w.queue = [];
      w.fetch = async (input, init = {}) => { const body = JSON.parse(init.body); const key = new Headers(init.headers).get("Idempotency-Key"); w.calls.push({ url: String(input), key, body });
        const r = w.queue.shift() ?? { body: { result: { account_id: body.accountId, status: { suspend: "suspended", close: "closed" }[body.action] ?? "active", previous_status: body.expectedStatus } } };
        if (r === "throw") throw new TypeError("network");
        return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } }); };
      let root; w.mount = (status, canManage = true, history = []) => { root ??= createRoot(document.getElementById("root")); root.render(<CustomerLifecyclePanel key={Math.random()} accountId="${account}" name="Colegio Ficticio" status={status} canManage={canManage} history={history} />); };
    ` } });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_q, r) => { r.setHeader("Content-Type", "text/html"); r.end(`<html lang="es"><head><meta charset="utf-8"></head><body><div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise<void>((ok, ko) => { server.once("error", ko); server.listen(0, "127.0.0.1", ok); });
  const a = server.address(); if (!a || typeof a === "string") throw Error("listener"); url = `http://127.0.0.1:${a.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);
beforeEach(async () => { native = false; page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(5000); page.on("dialog", d => { native = true; void d.dismiss(); }); await page.goto(url); });
afterEach(async () => { expect(native).toBe(false); await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>(ok => server?.close(() => ok())); });
const calls = () => win<{ key: string; body: Record<string, string> }[]>("w => w.calls");
const actions = () => page.locator("section").first().locator(":scope > div.flex.flex-wrap.gap-2 button").allInnerTexts();

describe("Platform customer lifecycle (browser)", () => {
  it("each state offers only its valid actions; without the capability there are none", async () => {
    for (const [status, expected] of [["active", ["Suspender", "Cerrar cliente"]], ["suspended", ["Reactivar", "Cerrar cliente"]], ["closed", ["Reabrir cliente"]]] as const) {
      await win(`w => w.mount("${status}")`); await page.getByText("Estado del cliente").waitFor(); expect(await actions()).toEqual(expected);
    }
    await win(`w => w.mount("active", false)`); await page.getByText("Estado del cliente").waitFor(); expect(await actions()).toEqual([]);
  });

  it("suspend: preservation copy, reason required, one request with expected state, result shown and page refreshed", async () => {
    await win(`w => w.mount("active", true, [])`); await page.getByText("Sin cambios de estado registrados.").waitFor();
    await page.getByRole("button", { name: "Suspender" }).click(); const task = page.getByRole("dialog", { name: "Suspender cliente" });
    const text = await task.innerText(); expect(text).toContain("bloqueado temporalmente"); expect(text).toMatch(/Se conservan .*saldos de PIKAS Cash e historial/);
    const go = task.getByRole("button", { name: "Suspender" }); expect(await go.isDisabled()).toBe(true);
    await task.getByLabel(/^Motivo/).fill("Pago pendiente de revisión"); await go.click(); await task.getByText("Cliente suspendido").waitFor();
    const sent = await calls(); expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ accountId: account, expectedStatus: "active", action: "suspend", reason: "Pago pendiente de revisión" });
    expect(await win<number>("w => w.refreshes")).toBe(1);
  });

  it("close: strongest confirmation — explains no deletion, no balance change, no settlement — and needs the deliberate acknowledgement", async () => {
    await win(`w => w.mount("suspended")`); await page.getByRole("button", { name: "Cerrar cliente" }).click();
    const task = page.getByRole("dialog", { name: "Cerrar cliente" }); const text = await task.innerText();
    for (const t of ["No se elimina ningún dato ni historial.", "No se modifican saldos de PIKAS Cash ni transacciones.", "No realiza liquidación financiera ni reembolsos.", "Solo podrá reabrirse"]) expect(text).toContain(t);
    expect(text).not.toMatch(/eliminará|borrará|permanente/i);
    const go = task.getByRole("button", { name: "Cerrar cliente" }); await task.getByLabel(/^Motivo/).fill("Fin del contrato"); expect(await go.isDisabled()).toBe(true);
    await task.getByRole("checkbox").check(); expect(await go.isDisabled()).toBe(false);
    // An unconfirmed result keeps the same request: retry resends exactly the same key and payload.
    await win("w => w.queue.push('throw')"); await go.click(); await task.getByText("Resultado sin confirmar").waitFor();
    expect(await task.getByLabel(/^Motivo/).isDisabled()).toBe(true);
    await task.getByRole("button", { name: "Reintentar la misma solicitud" }).click(); await task.getByText("Cliente cerrado").waitFor();
    const sent = await calls(); expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]); expect(sent[0].body).toMatchObject({ expectedStatus: "suspended", action: "close" });
  });

  it("reopen: same customer back to Activo with reason + confirmation; a stale state is explained, not retried", async () => {
    await win(`w => w.mount("closed", true, [{ occurred_at: "2026-10-19T15:00:00Z", action: "customer_closed", from: "active", to: "closed", reason: "Fin del contrato", actor_name: "Operador Ficticio" }])`);
    expect(await page.locator("section").first().innerText()).toMatch(/Cliente cerrado · Activo → Cerrado[\s\S]*Operador Ficticio[\s\S]*Motivo: Fin del contrato/);
    await page.getByRole("button", { name: "Reabrir cliente" }).click(); const task = page.getByRole("dialog", { name: "Reabrir cliente" });
    expect(await task.innerText()).toContain("No se crea un cliente nuevo.");
    await task.getByLabel(/^Motivo/).fill("Nuevo contrato"); await task.getByRole("checkbox").check();
    await win("w => w.queue.push({ status: 422, body: { error: 'lifecycle_state_changed' } })"); await task.getByRole("button", { name: "Reabrir cliente" }).click();
    await task.getByText("El estado del cliente cambió mientras revisabas.", { exact: false }).waitFor();
    await task.getByRole("button", { name: "Reabrir cliente" }).click(); await task.getByText("Cliente reabierto").waitFor();
    const sent = await calls(); expect(sent).toHaveLength(2); expect(sent[1].key).not.toBe(sent[0].key);
  });

  it("dismissing a typed reason asks first; focus starts on the reason", async () => {
    await win(`w => w.mount("active")`); await page.getByRole("button", { name: "Suspender" }).click(); const task = page.getByRole("dialog", { name: "Suspender cliente" });
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("TEXTAREA");
    await page.keyboard.type("Motivo"); await page.keyboard.press("Escape"); await task.getByText("¿Descartar los datos ingresados?").waitFor();
    await task.getByRole("button", { name: "Descartar" }).click(); await task.waitFor({ state: "detached" }); expect(await calls()).toHaveLength(0);
  });
});
