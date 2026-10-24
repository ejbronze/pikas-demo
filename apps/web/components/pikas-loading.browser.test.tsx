import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Brand & Public loading system in real Chromium: centered «Pikando…», softened and inert content, quiet micro-loads,
// the ten-second fallback sentence and reduced motion.
let browser: Browser, server: Server, page: Page, url: string;
const win = <T,>(fn: string) => page.evaluate(`(${fn})(window)`) as Promise<T>;

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", loader: { ".svg": "dataurl" }, define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { PikasLoadingScreen, PikasBusyRegion } from "./components/pikas-loading";
      const w = window; let root;
      function Region({ busy }) { return <>
        <button id="outside">Filtro</button>
        <PikasBusyRegion busy={busy} context="Cargando transacciones."><ul aria-label="Filas">{[1,2,3,4,5,6].map(n => <li key={n}><button>Fila {n}</button></li>)}</ul></PikasBusyRegion>
      </>; }
      w.screen = (frame) => { root ??= createRoot(document.getElementById("root")); root.render(<PikasLoadingScreen key={Math.random()} frame={frame} context="Cargando la pantalla." />); };
      w.region = (busy) => { root ??= createRoot(document.getElementById("root")); root.render(<Region busy={busy} />); };
    ` } });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_q, r) => { r.setHeader("Content-Type", "text/html"); r.end(`<html lang="es"><head><meta charset="utf-8"><style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style></head><body style="margin:0"><div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise<void>((ok, ko) => { server.once("error", ko); server.listen(0, "127.0.0.1", ok); });
  const a = server.address(); if (!a || typeof a === "string") throw Error("listener"); url = `http://127.0.0.1:${a.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);
beforeEach(async () => { page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(5000); await page.clock.install(); await page.goto(url); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>(ok => server?.close(() => ok())); });

describe("PikasLoadingScreen", () => {
  it("centers LOAD-01 and «Pikando…» in the viewport over a softened outline, with status semantics", async () => {
    await win(`w => w.screen("app")`); await page.clock.runFor(1000);
    const status = page.getByRole("status"); await status.waitFor();
    expect(await status.getAttribute("aria-busy")).toBe("true");
    expect(await status.innerText()).toContain("Pikando…");
    expect(await page.locator('[data-mascot="LOAD-01"]').count()).toBe(1);
    await page.locator(".pk-loading-indicator").evaluate(e => Promise.all(e.getAnimations().map(a => a.finished)));
    const box = await page.locator(".pk-loading-indicator").boundingBox(); if (!box) throw Error("indicator");
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(4); expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThan(4);
    expect(Number(await page.locator(".pk-loading-silhouette").evaluate(e => getComputedStyle(e).opacity))).toBeLessThan(1);
    expect(await page.locator(".pk-loading-veil").evaluate(e => getComputedStyle(e).backdropFilter)).toContain("blur");
    expect(await page.locator(".pk-loading-screen").innerText()).not.toContain("tardando");
  });
  it("after ten seconds a visible sentence says the wait is longer than usual", async () => {
    await win(`w => w.screen("content")`); await page.clock.runFor(10_500);
    expect(await page.getByRole("status").innerText()).toContain("Esto está tardando más de lo normal…");
  });
  it("works at phone width without horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await win(`w => w.screen("app")`); await page.clock.runFor(1000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await page.locator(".pk-loading-indicator").boundingBox(); if (!box) throw Error("indicator");
    expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThan(4);
  });
  it("reduced motion: no animation runs and the indicator is fully visible", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" }); await win(`w => w.screen("app")`);
    const s = await page.locator(".pk-loading-indicator").evaluate(e => ({ name: getComputedStyle(e).animationName, opacity: getComputedStyle(e).opacity }));
    expect(s).toEqual({ name: "none", opacity: "1" });
  });
});

describe("PikasBusyRegion", () => {
  it("a micro-load never blocks: nothing appears and rows stay usable before the delay", async () => {
    await win(`w => w.region(false)`); await win(`w => w.region(true)`); await page.clock.runFor(200);
    expect(await page.locator(".pk-busy-overlay").count()).toBe(0); expect(await page.locator("[inert]").count()).toBe(0);
    await win(`w => w.region(false)`); await page.clock.runFor(1000);
    expect(await page.locator(".pk-busy-overlay").count()).toBe(0);
  });
  it("a real reload softens the previous rows, makes them inert and shows «Pikando…»; filters outside stay usable", async () => {
    await win(`w => w.region(false)`); await win(`w => w.region(true)`); await page.clock.runFor(600);
    const overlay = page.locator(".pk-busy-overlay"); await overlay.waitFor();
    expect(await overlay.getAttribute("role")).toBe("status"); expect(await overlay.innerText()).toContain("Pikando…");
    expect(await page.locator(".pk-busy-content").getAttribute("inert")).not.toBeNull();
    expect(Number(await page.locator(".pk-busy-content").evaluate(e => getComputedStyle(e).opacity))).toBeLessThan(.5);
    await page.locator("#outside").focus(); await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent ?? "")).not.toMatch(/^Fila/);
    await win(`w => w.region(false)`);
    await page.getByRole("button", { name: "Fila 1" }).click();
    expect(await page.locator("[inert]").count()).toBe(0);
  });
});
