import React from "react";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CommittedReceipt } from "./connected-pos-dashboard";
import { catalogViewKey, formatReceiptTimestamp } from "../lib/pos/presentation";
import { posContext } from "../lib/pos/access-context.test-fixtures";
import type { Receipt } from "../lib/pos/contracts";

(globalThis as { React?: typeof React }).React = React;
const actor = posContext().actor.person_id;
let browser: Browser;
let server: Server;
let page: Page;
let url: string;

beforeAll(async () => {
  // Exercise the actual connected component/hooks in a real browser; only image rendering is stubbed.
  // No app server, authentication, API request or financial operation is involved.
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
    define: { "process.env.NODE_ENV": '"test"' },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { ConnectedPosView } from "./components/connected-pos-dashboard";
      import { ConnectedSale } from "./lib/pos/connected-sale";
      import { posContext } from "./lib/pos/access-context.test-fixtures";
      let root;
      window.mount = (personId) => {
        const context = posContext(); context.actor.person_id = personId;
        const sale = new ConnectedSale(context);
        const state = { ...sale.getSnapshot(), phase: "items", bootstrap: { blocked: null, session: null,
          catalog: { products: [
            { product_id: "one", name: "Producto con un nombre largo que debe ajustarse sin mover las columnas", price_minor: "6500", category_name: "Comida" },
            { product_id: "two", name: "Agua", price_minor: "2500", category_name: "Comida" }
          ] } } };
        root ??= createRoot(document.getElementById("root"));
        root.render(<ConnectedPosView sale={sale} state={state} />);
      };
      window.unmount = () => { root?.unmount(); root = null; };
    ` }, plugins: [{ name: "image-only-stub", setup(builder) {
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default () => null", loader: "js" }));
    } }] });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script>`);
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local test listener");
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30000);

beforeEach(async () => { page = await browser.newPage(); await page.goto(url); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>((done) => server?.close(() => done())); });
const mount = async (personId = actor) => {
  await page.evaluate((id) => (window as unknown as { mount(id: string): void }).mount(id), personId);
  await page.getByRole("button", { name: "Vista de lista" }).waitFor();
};
const expectView = async (view: "gallery" | "list") => {
  await page.waitForFunction((value) => document.querySelector(`.${value === "list" ? "pos-product-list" : "pos-product-grid"}`) !== null, view);
  expect(await page.getByRole("button", { name: view === "list" ? "Vista de lista" : "Vista de galería" }).getAttribute("aria-pressed")).toBe("true");
};

describe("connected catalog presentation preference", () => {
  it("defaults to list without saving an implicit preference", async () => {
    await mount(); await expectView("list");
    expect(await page.evaluate((key) => localStorage.getItem(key), catalogViewKey(actor))).toBeNull();
  });
  it("switches to grid immediately and restores it after unmount and reload", async () => {
    await mount(); await page.getByRole("button", { name: "Vista de galería" }).click(); await expectView("gallery");
    await page.evaluate(() => (window as unknown as { unmount(): void }).unmount());
    await mount(); await expectView("gallery");
    await page.reload(); await mount(); await expectView("gallery");
  });
  it("saves a later list selection and restores it after reload", async () => {
    await mount(); await page.getByRole("button", { name: "Vista de galería" }).click(); await expectView("gallery");
    await page.getByRole("button", { name: "Vista de lista" }).click(); await expectView("list");
    expect(await page.evaluate((key) => localStorage.getItem(key), catalogViewKey(actor))).toBe("list");
    await page.reload(); await mount(); await expectView("list");
  });
  it("isolates preferences when authoritative actors change on the same mount", async () => {
    await mount(); await page.getByRole("button", { name: "Vista de galería" }).click(); await expectView("gallery");
    const other = "44444444-4444-4444-8444-444444444444";
    await mount(other); await expectView("list");
    await mount(actor); await expectView("gallery");
  });
  it.each(["grid", "garbage", '{"view":"gallery"}'])("defaults to list for unsupported stored value %s", async (value) => {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: catalogViewKey(actor), value });
    await mount(); await expectView("list");
  });
  it("remains usable when storage reads and writes throw", async () => {
    await page.evaluate(() => {
      Storage.prototype.getItem = () => { throw new Error("unavailable"); };
      Storage.prototype.setItem = () => { throw new Error("unavailable"); };
    });
    await mount(); await expectView("list");
    await page.getByRole("button", { name: "Vista de galería" }).click(); await expectView("gallery");
    await page.evaluate(() => (window as unknown as { unmount(): void }).unmount());
    await mount(); await expectView("list");
  });
  it.each([390, 768, 1440])("keeps separate flexible information, price and add regions at width %s", async (width) => {
    await page.setViewportSize({ width, height: 900 }); await mount(); await expectView("list");
    const rows = page.locator(".pos-connected-list-hit");
    expect(await rows.count()).toBe(2);
    expect(await rows.first().evaluate((element) => getComputedStyle(element).display)).toBe("grid");
    expect(await rows.first().locator(":scope > .pos-connected-list-info").count()).toBe(1);
    expect(await rows.first().locator(":scope > .pos-list-price").textContent()).toContain("65.00");
    expect(await rows.first().locator(":scope > .pos-list-add").textContent()).toBe("+");
    expect(await rows.first().getAttribute("aria-label")).toContain("Añadir Producto");
  });
});

describe("committed receipt timestamp presentation", () => {
  it("uses the authoritative timezone and preserves the original transaction/financial snapshot", () => {
    const receipt: Receipt = { purchase_id: actor, purchase_number: "42", purchased_at: "2026-10-09T23:52:15.8346+00:00",
      business_date: "2026-10-09", business_timezone: "America/Santo_Domingo", currency_code: "DOP", total_minor: "6500",
      register_id: actor, register_session_id: actor, cafeteria_customer_id: actor, customer_type: "student", customer_name: "Luna",
      tender_type: "cash", cash_received_minor: "10000", change_due_minor: "3500", wallet_balance_after_minor: null,
      items: [{ product_id: actor, name: "Empanada", quantity: 1, product_version: 1, unit_price_minor: "6500", line_total_minor: "6500" }] };
    const before = structuredClone(receipt);
    const html = renderToStaticMarkup(<CommittedReceipt receipt={receipt} />);
    expect(html).toContain('dateTime="2026-10-09T23:52:15.8346+00:00"');
    expect(html).toMatch(/9 oct (?:de )?2026 · 7:52 p\.\s*m\./);
    expect(html).not.toContain("· 2026-10-09T");
    expect(html).toContain("Total RD$ 65.00"); expect(html).toContain("1 × Empanada");
    expect(receipt).toEqual(before);
    expect(formatReceiptTimestamp(receipt.purchased_at, "Europe/Madrid")).toMatch(/10 oct (?:de )?2026 · 1:52 a\.\s*m\./);
  });
  it.each([[null, "UTC"], ["invalid", "UTC"], ["2026-10-09T23:52:15Z", "invalid"], ["2026-10-09T23:52:15Z", null]])("handles missing/invalid timestamp or timezone", (timestamp, timezone) => {
    expect(formatReceiptTimestamp(timestamp, timezone)).toBe("Fecha no disponible");
  });
});
