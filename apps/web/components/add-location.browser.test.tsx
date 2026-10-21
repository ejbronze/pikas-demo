import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Platform "Agregar sede" task in real Chromium against a scripted /api route (key + body recorded).
let browser: Browser, server: Server, page: Page, url: string, native = false;
const win = <T,>(fn: string) => page.evaluate(`(${fn})(window)`) as Promise<T>;
const account = "6d000000-0000-4000-8000-0000000000a1", school = "6d000000-0000-4000-8000-0000000000b1";

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "nav", namespace: "stub" }));
      b.onLoad({ filter: /^nav$/, namespace: "stub" }, () => ({ contents: "export const useRouter = () => ({ refresh() { window.refreshes = (window.refreshes ?? 0) + 1; }, push() {}, replace() {} });", loader: "js" }));
    } }],
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { AddLocationAction } from "./app/platform/clientes/[accountId]/add-location-action";
      const w = window; w.calls = []; w.queue = [];
      w.fetch = async (input, init = {}) => { const body = JSON.parse(init.body); w.calls.push({ url: String(input), key: new Headers(init.headers).get("Idempotency-Key"), body });
        const r = w.queue.shift() ?? { body: { result: { account_id: body.accountId, school_id: body.schoolId, location_id: "6d000000-0000-4000-8000-0000000000c1", cafeteria_id: "6d000000-0000-4000-8000-0000000000d1", location_code: "SEDE-02", cafeteria_code: "CAF-01" } } };
        if (r === "throw") throw new TypeError("network");
        if (r === "hold") return new Promise(ok => { w.release = () => ok(new Response(JSON.stringify({ result: { account_id: body.accountId, school_id: body.schoolId, location_id: "6d000000-0000-4000-8000-0000000000c1", cafeteria_id: "6d000000-0000-4000-8000-0000000000d1" } }), { status: 200 })); });
        return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } }); };
      createRoot(document.getElementById("root")).render(<AddLocationAction accountId="${account}" schoolId="${school}" schoolName="Escuela Ficticia" />);
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
const calls = () => win<{ url: string; key: string; body: Record<string, string> }[]>("w => w.calls");
const fill = async (task: ReturnType<Page["getByRole"]>) => { await task.getByLabel("Nombre de la sede *").fill("Tamboril"); };

describe("Platform Agregar sede (browser)", () => {
  it("Agregar sede is the primary action; an edited cafetería name is never overwritten", async () => {
    expect(await page.getByRole("button", { name: "Agregar sede" }).getAttribute("class")).toBe("btn");
    await page.getByRole("button", { name: "Agregar sede" }).click(); const task = page.getByRole("dialog", { name: "Agregar sede" });
    await task.getByLabel("Nombre de la sede *").fill("Norte"); await task.getByLabel("Nombre de la cafetería *").fill("Comedor Norte");
    await task.getByLabel("Nombre de la sede *").fill("Norte Dos"); expect(await task.getByLabel("Nombre de la cafetería *").inputValue()).toBe("Comedor Norte");
  });
  it("focused task: explains it creates the cafeteria too; required fields; one request to the existing school; success refreshes the detail", async () => {
    await page.getByRole("button", { name: "Agregar sede" }).click(); const task = page.getByRole("dialog", { name: "Agregar sede" });
    expect(await task.innerText()).toContain("Crear la sede también crea su cafetería. PIKAS asigna los códigos.");
    expect(await task.getByText(/Código/).count()).toBe(0); expect(await task.getByRole("textbox").count()).toBe(2);
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.closest("label")?.textContent)).toBe("Nombre de la sede *");
    const create = task.getByRole("button", { name: "Crear sede" }); expect(await create.isDisabled()).toBe(true);
    await fill(task); expect(await task.getByLabel("Nombre de la cafetería *").inputValue()).toBe("Cafetería Tamboril");
    await task.getByLabel("Nombre de la sede *").fill("Sede Tamboril"); expect(await task.getByLabel("Nombre de la cafetería *").inputValue()).toBe("Cafetería Tamboril");
    await create.click(); await task.getByText("Sede Tamboril creada").waitFor();
    expect(await task.innerText()).toMatch(/Sede Tamboril · SEDE-02[\s\S]*Cafetería Tamboril · CAF-01/);
    const sent = await calls(); expect(sent).toHaveLength(1); expect(sent[0].url).toBe("/api/platform/school-locations");
    expect(sent[0].body).toEqual({ accountId: account, schoolId: school, locationName: "Sede Tamboril", cafeteriaName: "Cafetería Tamboril" });
    expect(await win<number>("w => w.refreshes")).toBe(1);
  });

  it("an unconfirmed result retries exactly the same request (no duplicate sede); fields lock meanwhile", async () => {
    await page.getByRole("button", { name: "Agregar sede" }).click(); const task = page.getByRole("dialog", { name: "Agregar sede" }); await fill(task);
    await win("w => w.queue.push('throw')"); await task.getByRole("button", { name: "Crear sede" }).click(); await task.getByText("Resultado sin confirmar").waitFor();
    expect(await task.getByRole("textbox").first().isDisabled()).toBe(true);
    await task.getByRole("button", { name: "Reintentar la misma solicitud" }).click(); await task.getByText("Sede Tamboril creada").waitFor();
    const sent = await calls(); expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
  });

  it("double activation while processing sends one request; closing is refused until the result is known", async () => {
    await page.getByRole("button", { name: "Agregar sede" }).click(); const task = page.getByRole("dialog", { name: "Agregar sede" }); await fill(task);
    await win("w => w.queue.push('hold')");
    await page.evaluate(() => { const b = [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(x => x.textContent === "Crear sede")!; b.click(); b.click(); });
    await task.getByRole("button", { name: "Creando…" }).waitFor(); await page.keyboard.press("Escape");
    await task.getByText("La operación está en curso.", { exact: false }).waitFor();
    await win("w => w.release()"); await task.getByText("Sede Tamboril creada").waitFor(); expect(await calls()).toHaveLength(1);
  });

  it("a code conflict is explained and nothing is retried automatically; cancel with typed data asks first and sends nothing", async () => {
    await page.getByRole("button", { name: "Agregar sede" }).click(); let task = page.getByRole("dialog", { name: "Agregar sede" }); await fill(task);
    await win("w => w.queue.push({ status: 422, body: { error: 'platform_tenant_code_conflict' } })"); await task.getByRole("button", { name: "Crear sede" }).click();
    await task.getByText("No se pudo asignar un código único", { exact: false }).waitFor(); expect(await task.getByRole("textbox").first().isDisabled()).toBe(false);
    await task.getByRole("button", { name: "Cancelar" }).click(); await task.getByText("¿Descartar los datos ingresados?").waitFor(); await task.getByRole("button", { name: "Descartar" }).click();
    await task.waitFor({ state: "detached" }); expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Agregar sede");
    await page.getByRole("button", { name: "Agregar sede" }).click(); task = page.getByRole("dialog", { name: "Agregar sede" });
    await page.keyboard.press("Escape"); await task.waitFor({ state: "detached" }); expect(await calls()).toHaveLength(1);
  });
});
