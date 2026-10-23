import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Catalog/menu workspace in real Chromium against a scripted connected workspace. Each command is
// recorded instead of sent; no server, Auth or database is involved.
let browser: Browser, server: Server, page: Page, url: string;
type Call = { op: string; arg: Record<string, unknown>; extra?: unknown };
const win = (fn: string) => page.evaluate(`(${fn})(window)`);

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "stub" }));
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
      b.onLoad({ filter: /^image$/, namespace: "stub" }, () => ({ contents: "export default (p) => null", loader: "js" }));
      b.onLoad({ filter: /^link$/, namespace: "stub" }, () => ({ resolveDir: process.cwd(), contents: "import React from 'react'; export default ({href, children, ...rest}) => React.createElement('a', {href, ...rest}, children)", loader: "js" }));
      b.onResolve({ filter: /^@\/lib\/product-image-upload$/ }, () => ({ path: "upload", namespace: "stub" }));
      b.onLoad({ filter: /^upload$/, namespace: "stub" }, () => ({ contents: "export const prepareDemoProductImage = async () => null", loader: "js" }));
    } }],
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { CatalogEditorContext } from "./components/cafeteria-editor-context";
      import { CafeteriaProductsEditor } from "./components/cafeteria-products-editor";
      import { CafeteriaMenusEditor } from "./components/cafeteria-menus-editor";
      const w = window; w.calls = []; w.results = [];
      const scope = { organizationId: "acct", locationId: "caf-1" };
      const product = (id, name, category, priceMinor, extra = {}) => ({ id, name, description: "", category, priceMinor, unit: "Unidad", catalogVersion: 3, active: true, available: true, ingredients: [], allergens: [], restrictionTags: [], imageUrl: null, ...extra });
      w.products = () => [product("p1", "Agua ficticia", "Bebidas", 5000), product("p2", "Sándwich ficticio", "Almuerzos", 12500), product("p3", "Fruta ficticia", "Postres", 3500, { available: false }), product("p4", "Café ficticio", "Bebidas", 4000, { active: false })];
      function Host({ section, items, scopeKey }) {
        const [pendingMutation, setPending] = useState(false);
        const record = (op) => async (arg, extra) => { w.calls.push({ op, arg, extra }); const r = w.results.shift() ?? { ok: true }; if (r.pending) setPending(true); return r; };
        const value = { connected: true, connection: "Online", mutationBlocked: false, pendingMutation, recoverPending: async () => { w.calls.push({ op: "recover", arg: {} }); setPending(false); return { ok: true }; },
          draftScope: scopeKey, categories: ["Almuerzos", "Bebidas", "Postres"], scope, timeZone: "America/Santo_Domingo",
          state: { menuItems: items, cafeteriaOperations: { menus: [{ ...scope, id: "m1", name: "Desayuno", description: "", active: true }], menuProducts: [{ menuId: "m1", productId: "p1" }, { menuId: "m1", productId: "p2" }],
            serviceShifts: [{ ...scope, id: "s1", name: "Mañana", menuId: "m1", weekdays: [1, 2], startTime: "07:00", endTime: "10:00", enabled: true }], serviceSettings: { enabled: true, timeZone: "America/Santo_Domingo" }, registers: [] } },
          adminAddMenu: record("add"), adminUpdateMenu: record("update"), adminSaveCafeteriaMenu: record("menu"), adminSaveServiceShift: record("shift"), adminSetServiceScheduling: record("scheduling") };
        return <CatalogEditorContext.Provider value={value}>{section === "products" ? <CafeteriaProductsEditor /> : <CafeteriaMenusEditor shifts={section === "shifts"} />}</CatalogEditorContext.Provider>;
      }
      let root;
      w.mount = (section = "products", items = w.products(), scopeKey = "actor-1:caf-1") => { root ??= createRoot(document.getElementById("root")); root.render(<Host key={Math.random()} section={section} items={items} scopeKey={scopeKey} />); };
    ` } });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_q, r) => { r.setHeader("Content-Type", "text/html"); r.end(`<html lang="es"><head><meta charset="utf-8"></head><body><div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise<void>((ok, ko) => { server.once("error", ko); server.listen(0, "127.0.0.1", ok); });
  const a = server.address(); if (!a || typeof a === "string") throw Error("listener"); url = `http://127.0.0.1:${a.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);
beforeEach(async () => { page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); await page.goto(url); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>(ok => server?.close(() => ok())); });

const mount = async (section = "products", empty = false, scopeKey = "actor-1:caf-1") => { await page.evaluate(([s, e, k]) => { const w = window as unknown as { mount(a: string, b?: unknown, c?: string): void; products(): unknown[] }; w.mount(s as string, e ? [] : w.products(), k as string); }, [section, empty, scopeKey] as const); };
const dlg = () => page.locator("dialog[open]");
const calls = () => win("w => w.calls") as Promise<Call[]>;
const cards = () => page.getByRole("list", { name: "Catálogo de productos" }).locator(":scope > li h2").allInnerTexts();

describe("Productos catalog workspace", () => {
  it("visual cards with price, category, availability and menu context; search, filters and sort", async () => {
    await mount();
    expect(await cards()).toEqual(["Agua ficticia", "Café ficticio", "Fruta ficticia", "Sándwich ficticio"]);
    const agua = await page.locator("li", { hasText: "Agua ficticia" }).innerText(); expect(agua).toMatch(/RD\$\s?50\.00/); expect(agua).toContain("Bebidas · Unidad · En 1 menú"); expect(agua).toContain("Disponible");
    expect(await page.locator("li", { hasText: "Café ficticio" }).innerText()).toContain("Inactivo");
    expect(await page.locator('li [role="img"]').count()).toBe(4); // intentional initials placeholder
    await page.getByLabel("Buscar productos").fill("fruta"); expect(await cards()).toEqual(["Fruta ficticia"]);
    await page.getByLabel("Buscar productos").fill(""); await page.getByLabel("Categoría").selectOption("Bebidas"); expect(await cards()).toEqual(["Agua ficticia", "Café ficticio"]);
    await page.getByLabel("Estado").selectOption("inactive"); expect(await cards()).toEqual(["Café ficticio"]);
    await page.getByLabel("Estado").selectOption(""); await page.getByLabel("Categoría").selectOption("");
    await page.getByLabel("Ordenar").selectOption("priceDesc"); expect(await cards()).toEqual(["Sándwich ficticio", "Agua ficticia", "Café ficticio", "Fruta ficticia"]);
    await page.getByLabel("Ordenar").selectOption("nameDesc"); expect((await cards())[0]).toBe("Sándwich ficticio");
  });
  it("no matches is distinct from an empty catalog", async () => {
    await mount(); await page.getByLabel("Buscar productos").fill("zzz");
    await page.getByText("No encontramos productos con estos filtros.").waitFor(); await page.getByRole("button", { name: "Limpiar filtros" }).click(); expect(await cards()).toHaveLength(4);
    await mount("products", true); await page.getByText("Aún no hay productos.").waitFor(); expect(await page.getByText("No encontramos productos").count()).toBe(0);
  });
});

describe("product task", () => {
  it("create: details → review → explicit create; nothing saved before; create another starts clean", async () => {
    await mount(); await page.getByRole("button", { name: "Agregar producto" }).first().click(); await dlg().waitFor();
    await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("alert").waitFor();
    await dlg().getByLabel("Nombre del producto *").fill("Batida ficticia"); await dlg().getByLabel("Categoría *").selectOption("Bebidas");
    await dlg().getByLabel("Precio de venta (RD$) *").fill("85"); await dlg().getByRole("button", { name: "Continuar" }).click();
    expect(await dlg().innerText()).toContain("Batida ficticia"); expect(await calls()).toHaveLength(0);
    await dlg().getByRole("button", { name: "Crear producto" }).click(); await dlg().getByText("Producto agregado al catálogo").waitFor();
    const [call] = await calls(); expect(call.op).toBe("add"); expect(call.arg).toMatchObject({ name: "Batida ficticia", category: "Bebidas", priceMinor: 8500, available: true, active: true });
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith("pikas:catalog-draft")))).toEqual([]);
    await dlg().getByRole("button", { name: "Crear otro producto" }).click(); await dlg().getByLabel("Nombre del producto *").waitFor();
    expect(await dlg().getByLabel("Nombre del producto *").inputValue()).toBe(""); expect(await dlg().getByLabel("Precio de venta (RD$) *").inputValue()).toBe("");
  });
  it("edit: same task, current values, warns before stopping sales, saves with the previous record", async () => {
    await mount(); await page.getByRole("button", { name: "Editar Agua ficticia" }).click();
    expect(await dlg().getByLabel("Precio de venta (RD$) *").inputValue()).toBe("50.00");
    await dlg().getByText("Disponible para la venta").click(); await dlg().getByRole("button", { name: "Continuar" }).click();
    await dlg().getByText("Este cambio impedirá nuevas ventas del producto.").waitFor();
    await dlg().getByRole("button", { name: "Guardar cambios" }).click(); await dlg().getByText("Cambios guardados").waitFor();
    const [call] = await calls(); expect(call.op).toBe("update"); expect(call.arg).toMatchObject({ id: "p1", available: false }); expect(call.extra).toMatchObject({ id: "p1", catalogVersion: 3 });
  });
  it("session draft: kept only when chosen, restored per cafeteria/operator/product, never submitted, discardable", async () => {
    let native = false; page.on("dialog", d => { native = true; void d.dismiss(); });
    await mount(); await page.getByRole("button", { name: "Agregar producto" }).first().click(); await dlg().getByLabel("Nombre del producto *").fill("Borrador ficticio");
    await page.keyboard.press("Escape"); await dlg().getByRole("button", { name: "Cerrar y conservar borrador" }).click(); await dlg().waitFor({ state: "detached" });
    await page.getByText("Tienes un producto nuevo sin guardar").waitFor();
    await page.getByRole("button", { name: "Continuar borrador" }).click(); expect(await dlg().getByLabel("Nombre del producto *").inputValue()).toBe("Borrador ficticio");
    await dlg().getByText("Recuperamos cambios sin guardar").waitFor(); expect(await calls()).toHaveLength(0);
    await page.keyboard.press("Escape"); await dlg().getByRole("button", { name: "Cerrar y conservar borrador" }).click();
    await page.getByRole("button", { name: "Editar Agua ficticia" }).click(); expect(await dlg().getByLabel("Nombre del producto *").inputValue()).toBe("Agua ficticia"); await page.keyboard.press("Escape");
    await mount("products", false, "actor-2:caf-1"); await expect.poll(() => page.getByText("Tienes un producto nuevo sin guardar").count()).toBe(0);
    await mount("products", false, "actor-1:caf-2"); await expect.poll(() => page.getByText("Tienes un producto nuevo sin guardar").count()).toBe(0);
    await mount(); await page.getByRole("button", { name: "Continuar borrador" }).click(); await dlg().getByRole("button", { name: "Descartar borrador" }).click();
    expect(await dlg().getByLabel("Nombre del producto *").inputValue()).toBe(""); expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith("pikas:catalog-draft")))).toEqual([]);
    expect(native).toBe(false);
  });
  it("a draft from an older product version is not restored into the changed product", async () => {
    await page.evaluate(() => sessionStorage.setItem("pikas:catalog-draft:actor-1:caf-1:p1", JSON.stringify({ base: 2, values: { name: "Viejo", categoryChoice: "Bebidas", newCategory: "", price: "1", unit: "Unidad", available: true, active: true, description: "", ingredients: "", allergens: "", restrictionTags: "" } })));
    await mount(); await page.getByRole("button", { name: "Editar Agua ficticia" }).click();
    expect(await dlg().getByLabel("Nombre del producto *").inputValue()).toBe("Agua ficticia"); await dlg().getByText("El producto cambió desde tu borrador").waitFor();
  });
  it("an unconfirmed save is shown as pending and is only recovered by an explicit action", async () => {
    await win(`w => w.results.push({ ok: false, message: "La operación anterior sigue sin confirmar.", pending: true })`);
    await mount(); await page.getByRole("button", { name: "Editar Agua ficticia" }).click(); await dlg().getByLabel("Precio de venta (RD$) *").fill("55");
    await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Guardar cambios" }).click();
    await dlg().getByText("Cambio pendiente de confirmar").waitFor(); await page.waitForTimeout(200); expect((await calls()).map(c => c.op)).toEqual(["update"]);
    await dlg().getByRole("button", { name: "Confirmar solicitud pendiente" }).click(); await dlg().getByText("Cambios guardados").waitFor(); expect((await calls()).map(c => c.op)).toEqual(["update", "recover"]);
  });
});

const file = (name: string, text: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text, "utf8") });
describe("CSV import", () => {
  it("preview first: ready vs attention with reasons; nothing created until 'Importar N productos'; replace file revalidates", async () => {
    await mount(); await page.getByRole("button", { name: "Importar CSV" }).click(); await dlg().getByText("Descargar plantilla CSV").waitFor();
    await dlg().getByLabel("Archivo CSV de productos").setInputFiles(file("malo.csv", "nombre,stock\nx,1"));
    await dlg().getByText("Columnas inválidas").waitFor();
    await dlg().getByLabel("Archivo CSV de productos").setInputFiles(file("productos.csv", "nombre,categoria,precio\nTé frío,Bebidas,30\nPan ficticio,Panadería,20\nAgua ficticia,Bebidas,50\nJugo,bebidas,abc\nTé frío,Bebidas,31\nYogur,Postres,45"));
    await dlg().getByText("2 productos listos · 4 necesitan atención").waitFor();
    const text = await dlg().innerText();
    for (const reason of ["Categoría desconocida: «Panadería»", "Ya existe un producto con este nombre", "Precio no válido: «abc»", "Nombre repetido en el archivo (también en la línea 2)"]) expect(text).toContain(reason);
    expect(await calls()).toHaveLength(0);
    await dlg().getByRole("button", { name: "Importar 2 productos" }).click(); await dlg().getByText("Se agregaron 2 de 2 productos").waitFor();
    expect((await calls()).map(c => [c.op, (c.arg as { name: string }).name])).toEqual([["add", "Té frío"], ["add", "Yogur"]]);
  });
  it("reports rejected rows truthfully and stops at the first unconfirmed row without sending the rest", async () => {
    await win(`w => w.results.push({ ok: true }, { ok: false, message: "No se realizó el cambio." }, { ok: false, message: "Sin confirmar", pending: true })`);
    await mount(); await page.getByRole("button", { name: "Importar CSV" }).click();
    await dlg().getByLabel("Archivo CSV de productos").setInputFiles(file("p.csv", "nombre,categoria,precio\nA1,Bebidas,1\nA2,Bebidas,2\nA3,Bebidas,3\nA4,Bebidas,4"));
    await dlg().getByRole("button", { name: "Importar 4 productos" }).click(); await dlg().getByText("Se agregaron 1 de 4 productos").waitFor();
    const text = await dlg().innerText(); expect(text).toContain("La importación se detuvo en la línea 4 (A3)"); expect(text).toContain("1 fila no se envió"); expect(text).toContain("Línea 3 · A2: No se realizó el cambio.");
    expect((await calls()).map(c => (c.arg as { name: string }).name)).toEqual(["A1", "A2", "A3"]);
  });
  it("double activation sends each row once; closing is blocked while importing", async () => {
    await mount(); await page.getByRole("button", { name: "Importar CSV" }).click();
    await dlg().getByLabel("Archivo CSV de productos").setInputFiles(file("p.csv", "nombre,categoria,precio\nB1,Bebidas,1"));
    await dlg().getByRole("button", { name: "Importar 1 producto" }).waitFor();
    await page.evaluate(() => { const b = [...document.querySelectorAll("dialog[open] button")].find(x => x.textContent === "Importar 1 producto") as HTMLButtonElement; b.click(); b.click(); });
    await dlg().getByText("Se agregaron 1 de 1 productos").waitFor(); expect(await calls()).toHaveLength(1);
  });
});

describe("Menús / Turnos", () => {
  it("menu cards preview their products; editing keeps the existing selection and saves product ids only", async () => {
    await mount("menus"); expect(await page.getByRole("list", { name: "Productos de Desayuno" }).innerText()).toContain("Agua ficticia");
    await page.getByRole("button", { name: "Editar menú Desayuno" }).click(); await dlg().getByText("2 productos seleccionados").waitFor();
    expect(await dlg().getByRole("button", { name: "Quitar Agua ficticia" }).getAttribute("aria-pressed")).toBe("true");
    await dlg().getByLabel("Categoría de productos").selectOption("Postres"); await dlg().getByRole("button", { name: "Añadir Fruta ficticia" }).click();
    await dlg().getByLabel("Categoría de productos").selectOption(""); await dlg().getByLabel("Buscar productos para el menú").fill("sándwich"); await dlg().getByRole("button", { name: "Quitar Sándwich ficticio" }).click();
    await dlg().getByRole("button", { name: "Guardar menú" }).click(); await dlg().waitFor({ state: "detached" });
    const [call] = await calls(); expect(call.op).toBe("menu"); expect(call.extra).toEqual(["p1", "p3"]); expect(call.arg).toMatchObject({ id: "m1", name: "Desayuno" });
  });
  it("deactivating a menu warns inside the task; cancel with changes asks to discard (no native confirm)", async () => {
    let native = false; page.on("dialog", d => { native = true; void d.dismiss(); });
    await mount("menus"); await page.getByRole("button", { name: "Editar menú Desayuno" }).click(); await dlg().getByText("Menú activo").click();
    await dlg().getByText("Al desactivar el menú").waitFor(); await dlg().getByRole("button", { name: "Cancelar" }).click(); await dlg().getByRole("button", { name: "Descartar" }).click();
    expect(await calls()).toHaveLength(0); expect(native).toBe(false);
  });
  it("turno editor is its own task; manual-mode switch confirms in the app", async () => {
    let native = false; page.on("dialog", d => { native = true; void d.dismiss(); });
    await mount("shifts"); await page.getByRole("button", { name: "Editar turno Mañana" }).click(); expect(await dlg().getByLabel("Menú del turno").inputValue()).toBe("m1");
    await dlg().getByRole("button", { name: "Guardar turno" }).click(); await dlg().waitFor({ state: "detached" });
    await page.getByRole("switch", { name: "Activar turnos de servicio" }).click(); await page.getByText("¿Usar catálogo manual sin restricciones de horario?").waitFor();
    await page.getByRole("button", { name: "Usar modo manual" }).click();
    expect((await calls()).map(c => c.op)).toEqual(["shift", "scheduling"]); expect(native).toBe(false);
  });
});
