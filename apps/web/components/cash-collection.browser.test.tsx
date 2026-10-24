import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// FIN 4 Cafetería cash collection in real Chromium. fetch is scripted: no server, Auth, database or money.
const caf = "f4000000-0000-4000-8000-0000000000c1", actor = "f4000000-0000-4000-8000-0000000000d1";
const ana = "f4000000-0000-4000-8000-0000000000e1", beto = "f4000000-0000-4000-8000-0000000000e2", dani = "f4000000-0000-4000-8000-0000000000e4";
let browser: Browser, server: Server, page: Page, url: string;
type Call = { url: string; key: string | null; body: Record<string, unknown> };
const win = <T,>(fn: string) => page.evaluate(`(${fn})(window)`) as Promise<T>;
const posts = async () => (await win<Call[]>("w => w.calls")).filter(c => c.body.operation === "collect");

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", loader: { ".svg": "dataurl" }, define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { CafeteriaCashCollection } from "./components/cafeteria-cash-collection";
      const w = window; w.calls = []; let mode = "echo", code = "", enabled = true, rows = [];
      const students = [{ student_id: "${ana}", display_name: "Ana Ficticia", wallet_status: "active", balance_minor: "50000" },
        { student_id: "${beto}", display_name: "Beto Ficticio", wallet_status: null, balance_minor: "0" },
        { student_id: "${dani}", display_name: "Dani Ficticia", wallet_status: "frozen", balance_minor: "1000" }];
      const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
      w.collect = (m, c) => { mode = m; code = c ?? ""; };
      w.fetch = (input, init) => { const body = JSON.parse(init?.body ?? "null"); w.calls.push({ url: String(input), key: new Headers(init?.headers).get("Idempotency-Key"), body });
        if (String(input).includes("/api/cafeteria/wallet")) return json(200, { result: { cafeteria_id: "${caf}", students: students.filter(s => s.display_name.toLowerCase().includes((body.query ?? "").toLowerCase())) } });
        if (body.operation === "read") return json(200, { result: { cafeteria_id: "${caf}", enabled, fee_bps: enabled ? 300 : null, policy_version: enabled ? 1 : null, currency: enabled ? "DOP" : null, collections: rows, next_before: null } });
        if (mode === "throw") return Promise.reject(new TypeError("network"));
        if (mode === "reject") return json(422, { error: code });
        const g = BigInt(body.gross_minor), fee = (g * 300n + 5000n) / 10000n;
        return json(200, { result: { request_key: body.request_key, reference: "REC-00000077", state: "posted", cafeteria_id: body.cafeteria_id, student_id: body.student_id, student_name: body.student_name,
          gross_minor: String(g), fee_minor: String(fee), net_minor: String(g - fee), fee_bps: 300, balance_after_minor: String(50000n + g - fee), collected_at: "2026-10-24T15:00:00Z",
          collected_by: "Admin Ficticia", payer_name: body.payer_name || null, replayed: mode === "replay" } }); };
      let root;
      w.mount = (e, r) => { enabled = e; rows = r ?? []; root ??= createRoot(document.getElementById("root")); root.render(<CafeteriaCashCollection key={Math.random()} cafeteriaId="${caf}" actorId="${actor}" />); };
    ` } });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_q, r) => { r.setHeader("Content-Type", "text/html"); r.end(`<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style></head><body><div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise<void>((ok, ko) => { server.once("error", ko); server.listen(0, "127.0.0.1", ok); });
  const a = server.address(); if (!a || typeof a === "string") throw Error("listener"); url = `http://127.0.0.1:${a.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);
beforeEach(async () => { page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(5000); await page.goto(url); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>(ok => server?.close(() => ok())); });
const dlg = () => page.getByRole("dialog");
const pick = async (name = "Ana") => {
  await page.getByRole("button", { name: "Recibir efectivo" }).click();
  await dlg().getByPlaceholder("Nombre o código").fill(name); await dlg().getByRole("button", { name: "Buscar" }).click();
  await dlg().getByRole("radio", { name: new RegExp(name) }).check(); await dlg().getByRole("button", { name: "Continuar" }).click();
};
const row = { reference: "REC-00000070", status: "posted", student_id: ana, student_name: "Ana Ficticia", student_code: "F4-001", gross_minor: "200000", fee_minor: "6000", net_minor: "194000", fee_bps: 300,
  collected_at: "2026-10-24T14:00:00Z", collected_by: "Admin Ficticia", payer_name: null, reversed_at: null };

describe("Cafetería cash collection", () => {
  it("history shows cash received, PIKAS fee and credited amount, with status, actor and reference", async () => {
    await win(`w => w.mount(true, ${JSON.stringify([row, { ...row, reference: "REC-00000069", status: "reversed", reversed_at: "2026-10-24T14:30:00Z" }])})`);
    const list = page.getByRole("list", { name: "Recargas en efectivo recibidas" }); await list.waitFor();
    const t = (await list.innerText()).toLowerCase(); // labels are styled uppercase
    for (const s of ["Ana Ficticia", "F4-001", "Efectivo recibido", "RD$ 2,000.00", "Cargo por recarga PIKAS", "RD$ 60.00", "Acreditado al monedero", "RD$ 1,940.00", "Recibido por Admin Ficticia", "REC-00000070", "Acreditada", "Revertida por PIKAS"]) expect(t).toContain(s.toLowerCase());
    expect(t).not.toMatch(/obligaci|liquidaci|compensaci|clearing|300/i);
    expect(await page.getByText("cargo por recarga PIKAS (3 %)").count()).toBe(1);
  });
  it("activation off: the section says so and offers no action", async () => {
    await win("w => w.mount(false)"); await page.getByText("Las recargas en efectivo no están habilitadas para este cliente.").waitFor();
    expect(await page.getByRole("button", { name: "Recibir efectivo" }).count()).toBe(0);
  });
  it("student step: only shared students; a frozen wallet cannot be chosen; no wallet yet is explained", async () => {
    await win("w => w.mount(true)"); await page.getByRole("button", { name: "Recibir efectivo" }).click();
    await dlg().getByRole("button", { name: "Buscar" }).click();
    expect(await dlg().getByRole("radio", { name: /Dani Ficticia/ }).isDisabled()).toBe(true);
    expect(await dlg().innerText()).toContain("PIKAS Cash congelado: no puede recibir recargas.");
    expect(await dlg().innerText()).toContain("Sin PIKAS Cash todavía: se crea con esta recarga.");
    expect(await dlg().getByRole("button", { name: "Continuar" }).isDisabled()).toBe(true);
  });
  it("RD$ 2,000.00 previews RD$ 60.00 fee and RD$ 1,940.00 credit; posting needs the cash confirmation; a double click posts once", async () => {
    await win("w => w.mount(true)"); await pick();
    await dlg().getByLabel("Efectivo recibido (RD$)").fill("2000");
    const b = await dlg().locator(".cash-breakdown").innerText();
    expect(b).toMatch(/Efectivo recibido\s*RD\$ 2,000\.00/); expect(b).toMatch(/Cargo por recarga PIKAS \(3 %\)\s*− RD\$ 60\.00/); expect(b).toMatch(/Se acredita al monedero\s*RD\$ 1,940\.00/);
    await dlg().getByLabel(/Entregado por/).fill("Madre Ficticia");
    await dlg().getByRole("button", { name: "Revisar" }).click();
    const review = await dlg().innerText();
    for (const s of ["Ana Ficticia", "RD$ 2,000.00", "RD$ 60.00", "RD$ 1,940.00", "Saldo después (estimado)", "RD$ 2,440.00", "Madre Ficticia"]) expect(review).toContain(s);
    const post = dlg().getByRole("button", { name: "Registrar recarga" }); expect(await post.isDisabled()).toBe(true);
    await dlg().getByRole("checkbox", { name: /Recibí RD\$ 2,000\.00 en efectivo/ }).check();
    await post.dblclick();
    await dlg().getByText("REC-00000077").waitFor();
    const sent = await posts(); expect(sent).toHaveLength(1);
    expect(sent[0].key).toBe(sent[0].body.request_key); expect(sent[0].body).toMatchObject({ cafeteria_id: caf, student_id: ana, gross_minor: "200000", payer_name: "Madre Ficticia" });
    expect(sent[0].body).not.toHaveProperty("fee_minor"); expect(sent[0].body).not.toHaveProperty("net_minor");
    const done = await dlg().innerText();
    for (const s of ["Recarga registrada", "Efectivo recibido", "RD$ 2,000.00", "Acreditado al monedero", "RD$ 1,940.00", "Nuevo saldo", "RD$ 2,440.00", "Recibido por", "Admin Ficticia"]) expect(done).toContain(s);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith("pikas:cash-collection")).length)).toBe(0);
  });
  it("half-up rounding is shown exactly as the database computes it (RD$ 333.33 → RD$ 10.00 fee, RD$ 323.33 credited)", async () => {
    await win("w => w.mount(true)"); await pick(); await dlg().getByLabel("Efectivo recibido (RD$)").fill("333.33");
    const b = await dlg().locator(".cash-breakdown").innerText(); expect(b).toContain("RD$ 10.00"); expect(b).toContain("RD$ 323.33");
    await dlg().getByLabel("Efectivo recibido (RD$)").fill("0.50");
    expect(await dlg().locator(".cash-breakdown").innerText()).toMatch(/− RD\$ 0\.02[\s\S]*RD\$ 0\.48/);
  });
  it("invalid amounts never reach PIKAS", async () => {
    await win("w => w.mount(true)"); await pick();
    for (const v of ["", "0", "-5", "1.234", "abc"]) { await dlg().getByLabel("Efectivo recibido (RD$)").fill(v); await dlg().getByRole("button", { name: "Revisar" }).click(); await dlg().getByRole("alert").waitFor(); }
    expect(await posts()).toHaveLength(0);
  });
  it("a refusal is definite: frozen wallet message, nothing pending afterwards", async () => {
    await win(`w => { w.mount(true); w.collect("reject", "wallet_not_active"); }`); await pick();
    await dlg().getByLabel("Efectivo recibido (RD$)").fill("100"); await dlg().getByRole("button", { name: "Revisar" }).click();
    await dlg().getByRole("checkbox").check(); await dlg().getByRole("button", { name: "Registrar recarga" }).click();
    await dlg().getByText("No se registró la recarga").waitFor();
    expect(await dlg().innerText()).toContain("congelado"); expect(await dlg().innerText()).toContain("No se movió dinero.");
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith("pikas:cash-collection")).length)).toBe(0);
  });
  it("an uncertain outcome keeps the exact request; reopening offers only the same retry, which reuses the key and payload", async () => {
    await win(`w => { w.mount(true); w.collect("throw"); }`); await pick();
    await dlg().getByLabel("Efectivo recibido (RD$)").fill("500"); await dlg().getByRole("button", { name: "Revisar" }).click();
    await dlg().getByRole("checkbox").check(); await dlg().getByRole("button", { name: "Registrar recarga" }).click();
    await dlg().getByText("Recarga pendiente de confirmar").waitFor();
    const first = (await posts())[0];
    await win(`w => { w.collect("replay"); w.mount(true); }`);
    await dlg().getByText("Recarga pendiente de confirmar").waitFor();
    expect(await dlg().getByRole("button", { name: "Reintentar la misma recarga" }).count()).toBe(1);
    await dlg().getByRole("button", { name: "Reintentar la misma recarga" }).click();
    await dlg().getByText("Esta recarga ya estaba registrada").waitFor();
    const all = await posts(); expect(all).toHaveLength(2); expect(all[1].key).toBe(first.key); expect(all[1].body).toEqual(first.body);
  });
  it("is a labelled dialog with focus inside, readable at phone width without overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await win(`w => w.mount(true, ${JSON.stringify([row])})`); await page.getByRole("list", { name: "Recargas en efectivo recibidas" }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await pick(); await dlg().getByLabel("Efectivo recibido (RD$)").fill("2000");
    expect(await dlg().getAttribute("aria-labelledby")).toBeTruthy();
    expect(await page.evaluate(() => !!document.querySelector("dialog[open]")?.contains(document.activeElement))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await dlg().getByLabel("Efectivo recibido (RD$)").getAttribute("inputmode")).toBe("decimal");
  });
});
