import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The real FinanceActions in real Chromium. No app server, Auth, database or money: nothing is sent.
let browser: Browser, server: Server, page: Page, url: string;
beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"test"' },
    // Some shared modules read process.env at import; the browser has no process.
    banner: { js: "var process = { env: { NODE_ENV: 'test' } };" },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "stub" }));
      b.onLoad({ filter: /^navigation$/, namespace: "stub" }, () => ({ resolveDir: process.cwd(), contents: "export const useRouter = () => ({ refresh() {} });" }));
    } }],
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { FinanceActions } from "./app/platform/finanzas/[reference]/finance-actions";
      window.calls = []; window.fetch = (u, init) => { window.calls.push({ key: new Headers(init?.headers).get("Idempotency-Key"), body: init?.body }); return Promise.reject(new Error("no network in this test")); };
      const detail = { reference: "REC-00000002", status: "pending", method: "bank_transfer", customer: "Colegio Ficticio", customer_activated: true, school: "Colegio Ficticio",
        student: "Ana Ficticia", student_code: "A-001", currency: "DOP", policy_version: 1, fee_bps: 300, gross_minor: "150000", fee_minor: "4500", net_minor: "145500",
        payer_reference: "POP-77120", payer_name: "Carlos Peña (ficticio)", payer_note: null, proof_reference: null, submitted_at: "2026-10-22T14:00:00Z", submitted_by: "Directora Ficticia",
        submitted_role: "school_admin", decided_at: null, decided_by: null, rejection_reason: null, posted_at: null, reversal: null, wallet: null };
      createRoot(document.getElementById("root")).render(<FinanceActions actor="actor" detail={detail} canVerify canReverse={false} />);
    ` } });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_q, r) => { r.setHeader("Content-Type", "text/html"); r.end(`<html lang="es"><body><div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise<void>((ok, ko) => { server.once("error", ko); server.listen(0, "127.0.0.1", ok); });
  const a = server.address(); if (!a || typeof a === "string") throw Error("listener"); url = `http://127.0.0.1:${a.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);
beforeEach(async () => { page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(url); await page.getByRole("button", { name: "Rechazar" }).waitFor(); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>(ok => server?.close(() => ok())); });

const dialog = () => page.locator("dialog[open]");
const reason = () => dialog().getByLabel("Motivo del rechazo");
const message = "Escribe el motivo del rechazo (al menos 3 caracteres).";

describe("Finance rejection task", () => {
  it("shows the fee as a recarga charge in the amount statement", async () => {
    await page.getByRole("button", { name: "Rechazar" }).click();
    expect(await dialog().getByText("Cargo por recarga PIKAS (3 %)").count()).toBe(1);
    expect(await dialog().getByText("Cargo PIKAS (3 %)", { exact: true }).count()).toBe(0);
  });
  it("clears the reason error as soon as the trimmed reason is valid", async () => {
    await page.getByRole("button", { name: "Rechazar" }).click();
    await dialog().getByRole("button", { name: "Continuar" }).click();
    expect(await dialog().getByRole("alert").innerText()).toBe(message);
    expect(await reason().getAttribute("aria-invalid")).toBe("true");
    await reason().fill("  ok ");
    expect(await dialog().getByText(message).count()).toBe(1);
    await reason().fill("Monto no coincide");
    expect(await dialog().getByText(message).count()).toBe(0);
    expect(await reason().getAttribute("aria-invalid")).toBeNull();
    expect(await reason().evaluate(e => e.className.includes("border-red-700"))).toBe(false);
    await dialog().getByRole("button", { name: "Continuar" }).click();
    expect(await dialog().innerText()).toContain("Motivo: Monto no coincide");
    expect(await dialog().getByRole("button", { name: "Rechazar transferencia" }).count()).toBe(1);
  });
  it("an uncertain answer is retried in place with exactly the original key and payload", async () => {
    await page.getByRole("button", { name: "Rechazar" }).click(); await reason().fill("Monto no coincide");
    await dialog().getByRole("button", { name: "Continuar" }).click(); await dialog().getByRole("button", { name: "Rechazar transferencia" }).click();
    await dialog().getByRole("button", { name: "Reintentar la misma operación" }).click(); await dialog().getByText("Operación pendiente de confirmar").waitFor();
    await page.waitForFunction(() => (window as unknown as { calls: unknown[] }).calls.length === 2);
    const calls = await page.evaluate(() => (window as unknown as { calls: { key: string; body: string }[] }).calls);
    expect(calls[1].key).toBe(calls[0].key); expect(calls[1].body).toBe(calls[0].body);
  });
});
