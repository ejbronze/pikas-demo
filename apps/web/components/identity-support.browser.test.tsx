import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Phase 6A in real Chromium: Platform identity support against a scripted /api/identity that keeps
// one Person (fixed person_id) and its audit, and the multi-cafeteria switch of one login.
let browser: Browser, server: Server, page: Page, url: string, native = false;
const win = <T,>(fn: string) => page.evaluate(`(${fn})(window)`) as Promise<T>;
const person = "6a000000-0000-4000-8000-000000000001", cafA = "6a000000-0000-4000-8000-0000000000c1", cafB = "6a000000-0000-4000-8000-0000000000c2";

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
      b.onLoad({ filter: /^link$/, namespace: "stub" }, () => ({ resolveDir: process.cwd(), contents: "import React from 'react'; export default ({href, children, prefetch, ...rest}) => React.createElement('a', {href, ...rest}, children)", loader: "js" }));
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "nav", namespace: "stub" }));
      b.onLoad({ filter: /^nav$/, namespace: "stub" }, () => ({ contents: "export const useRouter = () => ({ refresh() {}, push() {}, replace() {} }); export const usePathname = () => '/'; export const useSearchParams = () => new URLSearchParams();", loader: "js" }));
    } }],
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { IdentitySearch } from "./components/identity-credentials";
      import { ConnectedCafeteriaShell } from "./components/connected-cafeteria-shell";
      const w = window; w.calls = [];
      // Scripted server: ONE Person; every mutation bumps the version and appends audit, person_id never changes.
      w.db = { person_id: "${person}", display_name: "Cajera Ficticia", person_status: "active", username: null, email: "cajera@example.invalid", email_confirmed: true,
        last_sign_in_at: null, must_change_password: false, login_suspended: false, temporary_issued_at: null, pending_email: null, version: 1,
        memberships: [{ scope: "cafeteria", role: "pos_cashier", status: "active", name: "Cafetería Norte" }], audit: [] };
      const audit = (operation, metadata = {}, reason = null) => w.db.audit.unshift({ operation, occurred_at: new Date().toISOString(), actor_scope: "platform", actor_name: "Operador Ficticio", metadata, reason });
      const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      w.fetch = async (input, init = {}) => {
        const body = JSON.parse(init.body); w.calls.push(body); const s = () => ({ ...structuredClone(w.db), support_scope: "platform" });
        if (body.operation === "lookup") return ok({ result: ["cajera@example.invalid", w.db.username].includes(body.identifier.toLowerCase()) ? s() : null });
        if (body.operation === "set_username") {
          if (body.expected_version !== w.db.version) return new Response(JSON.stringify({ error: "identity_version_changed" }), { status: 409 });
          if (body.username === "ocupado") return new Response(JSON.stringify({ error: "username_unavailable" }), { status: 409 });
          audit(w.db.username ? "username_changed" : "username_set", { from: w.db.username, to: body.username }); w.db.username = body.username; w.db.version++; return ok({ result: s() });
        }
        if (body.operation === "temporary_access") { audit("temporary_access_requested"); audit("temporary_access_issued", { requires_password_change: true }); w.db.must_change_password = true; w.db.version += 2; return ok({ result: s(), temporary_password: "Tq7mZr4HkP2xWa" }); }
        return new Response("{}", { status: 503 });
      };
      let root; const show = el => { root ??= createRoot(document.getElementById("root")); root.render(React.createElement(React.Fragment, { key: Math.random() }, el)); };
      w.mountSearch = () => show(<IdentitySearch />);
      const caf = (id, name) => ({ cafeteria_id: id, cafeteria_name: name, account_name: "Cuenta Ficticia", school_name: "Escuela Ficticia", location_name: "Sede", tenant_kind: "customer" });
      w.mountShell = (selected) => show(<ConnectedCafeteriaShell cafeteriaId={selected} context={{ person_id: "${person}", display_name: "Admin Ficticio", cafeterias: [caf("${cafA}", "Cafetería Santiago Ficticia"), caf("${cafB}", "Cafetería Tamboril Ficticia")] }}><p>Contenido</p></ConnectedCafeteriaShell>);
    ` } });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_q, r) => { r.setHeader("Content-Type", "text/html"); r.end(`<html lang="es"><head><meta charset="utf-8"></head><body><div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise<void>((ok, ko) => { server.once("error", ko); server.listen(0, "127.0.0.1", ok); });
  const a = server.address(); if (!a || typeof a === "string") throw Error("listener"); url = `http://127.0.0.1:${a.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);
beforeEach(async () => { native = false; page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.on("pageerror", e => console.log("PAGEERROR", e.message)); page.setDefaultTimeout(5000); page.on("dialog", d => { native = true; void d.dismiss(); }); await page.goto(url); });
afterEach(async () => { expect(native).toBe(false); await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>(ok => server?.close(() => ok())); });
const calls = () => win<Record<string, unknown>[]>("w => w.calls");

describe("Phase 6A identity support (browser)", () => {
  it("Platform: exact lookup, username assignment with version guard, audit shown, same Person throughout", async () => {
    await win("w => w.mountSearch()");
    await page.getByLabel("Correo o usuario exacto").fill("nadie@example.invalid"); await page.getByRole("button", { name: "Buscar" }).click();
    await page.getByText("No hay una identidad con ese correo o usuario.").waitFor();
    await page.getByLabel("Correo o usuario exacto").fill("Cajera@Example.Invalid"); await page.getByRole("button", { name: "Buscar" }).click();
    await page.getByRole("heading", { name: "Cajera Ficticia" }).waitFor();
    expect(await page.getByText("Soporte de identidad de PIKAS. No otorga acceso a los datos del cliente.").count()).toBe(1);
    await page.getByRole("button", { name: "Asignar usuario" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Usuario").fill("a..b"); await dialog.getByText("Ese usuario no cumple las reglas.").waitFor();
    expect(await dialog.getByRole("button", { name: "Confirmar" }).isDisabled()).toBe(true);
    await dialog.getByLabel("Usuario").fill("ocupado"); await dialog.getByRole("button", { name: "Confirmar" }).click();
    await dialog.getByText("Ese usuario ya pertenece a otra persona.").waitFor();
    await dialog.getByLabel("Usuario").fill(" Cajera.Norte "); await dialog.getByRole("button", { name: "Confirmar" }).click();
    await dialog.getByText("Usuario guardado").waitFor(); await dialog.getByText("Ya puede entrar con «cajera.norte» o con su correo.").waitFor();
    await dialog.getByRole("button", { name: "Listo" }).click();
    const card = await page.locator("section").first().innerText();
    expect(card).toMatch(/Usuario\s*cajera\.norte/); expect(card).toContain("Usuario asignado: cajera.norte"); expect(card).toContain("Operador Ficticio (PIKAS)");
    const sent = await calls();
    expect(sent.filter(c => c.operation === "set_username").map(c => [c.person_id, c.username, c.expected_version])).toEqual([[person, "ocupado", 1], [person, "cajera.norte", 1]]);
    expect(sent.every(c => !("person_id" in c) || c.person_id === person)).toBe(true);
    // Lookup by the new username finds the same Person.
    await page.getByLabel("Correo o usuario exacto").fill("CAJERA.NORTE"); await page.getByRole("button", { name: "Buscar" }).click();
    await page.getByRole("button", { name: "Cambiar usuario" }).waitFor();
  });

  it("Platform: a temporary password is shown once, in the task only, and is gone after closing", async () => {
    await win("w => w.mountSearch()");
    await page.getByLabel("Correo o usuario exacto").fill("cajera@example.invalid"); await page.getByRole("button", { name: "Buscar" }).click();
    await page.getByRole("button", { name: "Emitir contraseña temporal" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("La contraseña se muestra una sola vez. PIKAS no la guarda ni la registra.").waitFor();
    await dialog.getByRole("button", { name: "Emitir contraseña" }).click();
    await dialog.getByText("Tq7mZr4HkP2xWa").waitFor(); await dialog.getByText("Cópiala ahora: PIKAS no la guarda y no se volverá a mostrar.").waitFor();
    await dialog.getByRole("button", { name: "Listo" }).click();
    expect(await page.evaluate(() => [...document.body.children].filter(e => !["SCRIPT", "STYLE"].includes(e.tagName)).map(e => e.outerHTML).join(""))).not.toContain("Tq7mZr4HkP2xWa");
    await page.getByText("Debe crear su contraseña").waitFor(); await page.getByText("Contraseña temporal emitida").first().waitFor();
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain("Tq7mZr4HkP2xWa");
  });

  it("one login with two authorized cafeterias: the switcher lists exactly those and switches by ?cafeteria=", async () => {
    await page.goto(`${url}/?cafeteria=${cafA}`); await win(`w => w.mountShell("${cafA}")`);
    const select = page.locator("#workspace-cafeteria");
    await select.waitFor();
    expect(await select.locator("option").allInnerTexts()).toEqual(["Cafetería Santiago Ficticia", "Cafetería Tamboril Ficticia"]);
    await select.selectOption(cafB); await page.locator("form").filter({ has: select }).getByRole("button", { name: "Cambiar" }).click();
    await page.waitForURL(`${url}/?cafeteria=${cafB}`);
  });
});
