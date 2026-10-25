import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Wave D.3 administrative workflows in real Chromium with a scripted fetch: every request is recorded
// (url, Idempotency-Key, body) and answered by the test. No server, Auth or database is involved.
let browser: Browser, server: Server, page: Page, url: string, native = false;
type Call = { url: string; key: string | null; body: Record<string, unknown> | null };
const win = <T,>(fn: string) => page.evaluate(`(${fn})(window)`) as Promise<T>;
const U = (n: number) => `d3000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", loader: { ".svg": "dataurl" } /* mascot SVGs from @pikas/ui/mascot */, define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
      b.onLoad({ filter: /^link$/, namespace: "stub" }, () => ({ resolveDir: process.cwd(), contents: "import React from 'react'; export default ({href, children, prefetch, ...rest}) => React.createElement('a', {href, ...rest, onClick: e => { e.preventDefault(); rest.onClick?.(e); window.navigated = href; }}, children)", loader: "js" }));
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "nav", namespace: "stub" }));
      b.onLoad({ filter: /^nav$/, namespace: "stub" }, () => ({ contents: "export const useRouter = () => ({ refresh() { window.refreshes = (window.refreshes ?? 0) + 1; }, push(u) { window.navigated = u; }, replace(u) { window.navigated = u; } }); export const usePathname = () => '/'; export const useSearchParams = () => new URLSearchParams(); export const redirect = () => {};", loader: "js" }));
      b.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "stub" }));
      b.onLoad({ filter: /^image$/, namespace: "stub" }, () => ({ contents: "export default () => null", loader: "js" }));
      b.onResolve({ filter: /^@\/lib\/product-image-upload$/ }, () => ({ path: "upload", namespace: "stub" }));
      b.onLoad({ filter: /^upload$/, namespace: "stub" }, () => ({ contents: "export const prepareDemoProductImage = async () => null", loader: "js" }));
    } }],
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { SchoolStudents } from "./components/school-students";
      import { SchoolAdministrators } from "./components/school-administrators";
      import { StudentWallet } from "./components/student-wallet";
      import { ConnectedCafeteriaProvider } from "./components/connected-cafeteria-provider";
      import { ConnectedCafeteriaPages } from "./components/connected-cafeteria-pages";
      import { CustomerWizard } from "./app/platform/clientes/nuevo/customer-wizard";
      import { TeamWorkspace } from "./app/platform/equipo/team-workspace";
      const w = window; w.calls = []; w.queue = {};
      w.next = (url, ...responses) => { (w.queue[url] ??= []).push(...responses); };
      const json = (status, body) => new Response(JSON.stringify(body ?? {}), { status, headers: { "Content-Type": "application/json" } });
      w.auto = (url, key, body) => {
        if (url === "/api/cafeteria") return { body: { result: { request_id: key, operation: body.operation, target_id: null } } };
        if (url === "/api/school") return { body: { result: body.operation.startsWith("student_e") || body.operation.startsWith("student_t") || body.operation === "student_withdraw" ? { enrollment_id: "${U(90)}" } : body.operation === "admin_prepare" ? { invitation_id: "${U(91)}", status: "pending" } : { student_id: "${U(92)}" } } };
        if (url === "/api/school/wallet") return { body: { result: w.walletHistory } };
        if (url === "/api/platform/schools/onboard") return { body: { result: { account_id: "${U(80)}", school_id: "${U(81)}", location_id: "${U(82)}", cafeteria_id: "${U(83)}", school_code: "COL-0A1B2C3D4E" } } };
        if (url === "/api/platform/customer-admins/prepare") return { body: { result: { intent_id: "${U(84)}", status: "pending" } } };
        if (url === "/api/platform/team") return { body: { result: { request_id: key, operation: body.operation, status: "confirmed" } } };
        return { status: 503 };
      };
      w.fetch = async (input, init = {}) => {
        const u = String(input).split("?")[0], body = init.body ? JSON.parse(init.body) : null, key = new Headers(init.headers).get("Idempotency-Key");
        if (init.method === "POST") w.calls.push({ url: u, key, body });
        const r = w.queue[u]?.length ? w.queue[u].shift() : w.auto(u, key, body);
        if (r === "hold") return new Promise(ok => { w.release = s => ok(json(s ?? 503, {})); });
        if (r === "throw") throw new TypeError("network");
        return json(r.status ?? 200, r.body);
      };
      let root; const show = el => { root ??= createRoot(document.getElementById("root")); root.render(React.createElement(React.Fragment, { key: Math.random() }, el)); };
      w.mountStudents = (p) => show(<SchoolStudents {...p} />);
      w.mountAdmins = (p) => show(<SchoolAdministrators {...p} />);
      w.mountWallet = (p) => show(<StudentWallet {...p} />);
      w.mountCafeteria = (section, data) => show(<ConnectedCafeteriaProvider data={data}><ConnectedCafeteriaPages section={section} data={data} /></ConnectedCafeteriaProvider>);
      w.mountWizard = () => show(<CustomerWizard actor="operator-1" />);
      w.mountTeam = (data) => show(<TeamWorkspace data={data} />);
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

const dlg = () => page.locator("dialog[open]");
const calls = () => win<Call[]>("w => w.calls");
const storage = (prefix: string) => page.evaluate(p => Object.keys(sessionStorage).filter(k => k.startsWith(p)), prefix);
const school = U(1), actor = U(2);
const scope = { actor_id: actor, membership_id: U(3), role: "school_admin", account_id: U(4), school_id: school, account_name: "Cuenta Ficticia", school_name: "Escuela Ficticia", tenant_kind: "customer" };
const student = (n: number, first: string, extra: Record<string, unknown> = {}) => ({ id: U(10 + n), first_name: first, last_name: "Ficticia", display_name: `${first} Ficticia`, student_code: `C-${n}`, status: "active", enrollment: { id: U(30 + n), starts_on: "2026-08-20", location_id: U(5), grade: "4to", class: "B", homeroom: null }, ...extra });
const schoolData = { scope, locations: [{ id: U(5), name: "Campus Norte" }], grades: ["4to", "5to"] };
const students = [student(1, "Sol"), student(2, "Luna", { status: "suspended", enrollment: null })];
const mountStudents = (over: Record<string, unknown> = {}) => page.evaluate(p => (window as unknown as { mountStudents(p: unknown): void }).mountStudents(p),
  { data: schoolData, students, query: "", status: "", location: "", grade: "", paged: false, walletRead: true, actorId: actor, ...over });

describe("Estudiantes workspace", () => {
  it("server filters, count, scannable rows with actions; empty vs no-match are distinct", async () => {
    await mountStudents();
    await page.getByRole("search", { name: "Filtros de estudiantes" }).waitFor();
    expect(await page.getByRole("status").filter({ hasText: "estudiantes" }).innerText()).toBe("2 estudiantes");
    const table = await page.getByRole("list", { name: "Estudiantes" }).innerText(); // the roster is a scannable list since 28114e7 expect(table).toContain("Sol Ficticia"); expect(table).toContain("Código C-1"); expect(table).toContain("4to · B"); expect(table).toContain("Campus Norte"); expect(table).toContain("Sin matrícula activa"); expect(table).toContain("Suspendido");
    expect(table).not.toContain(U(11)); // no internal ids
    await page.getByRole("link", { name: "PIKAS Cash de Sol Ficticia" }).first().waitFor();
    await mountStudents({ students: [], query: "zzz" }); await page.getByText("No encontramos estudiantes con estos filtros.").waitFor(); await page.getByRole("link", { name: "Limpiar filtros" }).first().waitFor();
    await mountStudents({ students: [] }); await page.getByText("Aún no hay estudiantes en este colegio.").waitFor(); expect(await page.getByText("No encontramos estudiantes").count()).toBe(0);
    await mountStudents({ walletRead: false }); expect(await page.getByRole("link", { name: /PIKAS Cash/ }).count()).toBe(0);
  });
  it("create: Estudiante → Matrícula → Revisar → «Crear estudiante» sends exactly one keyed request; Atrás keeps values; create another starts clean", async () => {
    await mountStudents(); await page.getByRole("button", { name: "Crear estudiante" }).first().click(); await dlg().waitFor();
    await dlg().getByRole("button", { name: "Continuar" }).click(); expect(await dlg().getByLabel("Nombre *").evaluate(e => (e as HTMLInputElement).validity.valid)).toBe(false);
    await dlg().getByLabel("Nombre *").fill("Río"); await dlg().getByLabel("Apellido *").fill("Ficticio"); await dlg().getByLabel("Código estudiantil *").fill("R-9");
    await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByLabel("Campus").selectOption(U(5)); await dlg().getByLabel("Grado").fill("5to");
    await dlg().getByRole("button", { name: "Atrás" }).click(); expect(await dlg().getByLabel("Nombre *").inputValue()).toBe("Río");
    await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Continuar" }).click();
    const review = await dlg().innerText(); expect(review).toContain("Río Ficticio"); expect(review).toContain("Campus Norte"); expect(review).toContain("No se crea una cuenta de acceso"); expect(await calls()).toHaveLength(0);
    await dlg().getByRole("button", { name: "Crear estudiante" }).click(); await dlg().getByText("Estudiante creado").first().waitFor();
    const sent = await calls(); expect(sent).toHaveLength(1); expect(sent[0].url).toBe("/api/school"); expect(sent[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0].body).toMatchObject({ schoolId: school, operation: "student_create", payload: { first_name: "Río", last_name: "Ficticio", student_code: "R-9", location_id: U(5), grade: "5to", class: null, homeroom: null } });
    expect(await storage("pikas:school:request")).toEqual([]); expect(await storage("pikas:student-draft")).toEqual([]);
    await dlg().getByRole("button", { name: "Crear otro estudiante" }).click(); expect(await dlg().getByLabel("Nombre *").inputValue()).toBe("");
  });
  it("enrollment date defaults to today in Santo Domingo, also at 21:00 AST when UTC is already tomorrow, and after a reload", async () => {
    for (const [at, expected] of [["2026-10-24T15:00:00Z", "2026-10-24"], ["2026-10-25T01:00:00Z", "2026-10-24"], ["2026-10-25T04:30:00Z", "2026-10-25"]] as const) {
      await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); }); await page.clock.setFixedTime(new Date(at)); await page.reload(); await mountStudents();
      await page.getByRole("button", { name: "Crear estudiante" }).first().click(); await dlg().getByLabel("Nombre *").fill("Hora"); await dlg().getByLabel("Apellido *").fill("Límite");
      await dlg().getByLabel("Código estudiantil *").fill("H-1"); await dlg().getByRole("button", { name: "Continuar" }).click();
      expect(await dlg().getByLabel("Fecha efectiva").inputValue(), at).toBe(expected);
    }
  });
  it("create draft: kept only when chosen, restored after reload for the same operator and school, never sent, discardable", async () => {
    await mountStudents(); await page.getByRole("button", { name: "Crear estudiante" }).first().click(); await dlg().getByLabel("Nombre *").fill("Borrador");
    await page.keyboard.press("Escape"); await dlg().getByRole("button", { name: "Cerrar y conservar borrador" }).click(); await dlg().waitFor({ state: "detached" });
    await page.reload(); await mountStudents(); await page.getByRole("button", { name: "Crear estudiante" }).first().click();
    expect(await dlg().getByLabel("Nombre *").inputValue()).toBe("Borrador"); await dlg().getByText("Recuperamos cambios sin guardar").waitFor(); expect(await calls()).toHaveLength(0);
    await page.keyboard.press("Escape"); await dlg().getByRole("button", { name: "Descartar", exact: true }).click(); expect(await storage("pikas:student-draft")).toEqual([]);
    // Another operator never sees it.
    await page.evaluate(k => sessionStorage.setItem(k, JSON.stringify({ base: null, values: { first_name: "Ajeno" } })), `pikas:student-draft:${U(99)}:${school}:new`);
    await page.getByRole("button", { name: "Crear estudiante" }).first().click(); expect(await dlg().getByLabel("Nombre *").inputValue()).toBe("");
  });
  it("uncertain create keeps the exact request; reopening offers only an explicit same-key retry", async () => {
    await page.evaluate(() => (window as unknown as { next(u: string, r: unknown): void }).next("/api/school", { status: 503 }));
    await mountStudents(); await page.getByRole("button", { name: "Crear estudiante" }).first().click();
    await dlg().getByLabel("Nombre *").fill("Mar"); await dlg().getByLabel("Apellido *").fill("Ficticia"); await dlg().getByLabel("Código estudiantil *").fill("M-1");
    await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Crear estudiante" }).click();
    await dlg().getByText("Pendiente de confirmar").waitFor(); expect(await storage("pikas:school:request")).toHaveLength(1);
    await dlg().getByRole("button", { name: "Cerrar", exact: true }).first().click(); await page.getByText("Hay una creación de estudiante pendiente de confirmar.").waitFor();
    await page.getByRole("button", { name: "Revisar solicitud pendiente" }).click(); await dlg().getByText("Hay una solicitud pendiente de confirmar").waitFor(); expect(await dlg().innerText()).toContain("M-1");
    expect(await calls()).toHaveLength(1);
    await dlg().getByRole("button", { name: "Confirmar solicitud pendiente" }).click(); await dlg().getByText("Estudiante creado").first().waitFor();
    const sent = await calls(); expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
  });
  it("profile → focused edit tasks (info, status) return to the profile; rejected status is reported as not done", async () => {
    await mountStudents(); await page.getByRole("button", { name: "Ver perfil de Sol Ficticia" }).first().click();
    expect(await dlg().innerText()).toContain("Campus Norte"); await dlg().getByRole("button", { name: "Editar información" }).click();
    await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByText("No hay cambios para guardar.").waitFor();
    await dlg().getByLabel("Nombre *").fill("Solana"); await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Guardar cambios" }).click();
    await dlg().getByText("Información actualizada").first().waitFor(); expect((await calls())[0].body).toMatchObject({ operation: "student_update", payload: { student_id: U(11), first_name: "Solana", last_name: "Ficticia", student_code: "C-1" } });
    await dlg().getByRole("button", { name: "Cerrar", exact: true }).click(); await dlg().getByRole("button", { name: "Cambiar estado" }).click();
    await page.evaluate(() => (window as unknown as { next(u: string, r: unknown): void }).next("/api/school", { status: 422 }));
    await dlg().getByLabel("Estado").selectOption("inactive"); await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Cambiar a inactivo" }).click();
    await dlg().getByText("No se realizó el cambio").waitFor(); expect(await storage("pikas:school:request")).toEqual([]);
  });
});

describe("School administrators", () => {
  it("prepare access is a focused task with an explicit final action and no email claim", async () => {
    await page.evaluate(p => (window as unknown as { mountAdmins(p: unknown): void }).mountAdmins(p), { data: { ...schoolData, memberships: [], invitations: [] }, actorId: actor });
    await page.getByText("No hay accesos preparados.").waitFor(); await page.getByRole("button", { name: "Preparar administrador" }).click();
    await dlg().getByLabel("Correo del administrador *").fill("nueva@example.invalid"); await dlg().getByRole("button", { name: "Continuar" }).click();
    expect(await dlg().getByText("Preparar no concede acceso").count()).toBe(0); await dlg().getByLabel(/^Usuario PIKAS/).fill(" Nueva.Admin "); await dlg().getByRole("button", { name: "Continuar" }).click();
    expect(await dlg().innerText()).toContain("nueva.admin");
    expect(await dlg().innerText()).toContain("Preparar no concede acceso"); await dlg().getByRole("button", { name: "Preparar acceso" }).click(); await dlg().getByText("Acceso preparado").first().waitFor();
    expect((await calls())[0].body).toEqual({ schoolId: school, operation: "admin_prepare", payload: { email: "nueva@example.invalid", username: "nueva.admin" } });
  });
});

const history = { school_id: school, student_id: U(11), student_name: "Sol Ficticia", next_before: null, wallet: { id: U(60), status: "active", currency: "DOP", balance_minor: "12500", version: "3" }, movements: [
  { id: U(61), type: "purchase", amount_minor: "-7500", balance_after_minor: "12500", version: "3", occurred_at: "2026-10-10T15:00:00Z", source: null, reference: null, note: null, actor: "Cajera Ficticia", replenishment_id: null, purchase_id: U(62), receipt_number: "41", cafeteria: "Cafetería Ficticia", items: [{ name: "Sándwich ficticio", quantity: 1, line_total_minor: "7500" }] },
  { id: U(63), type: "replenishment", amount_minor: "20000", balance_after_minor: "20000", version: "2", occurred_at: "2026-10-09T15:00:00Z", source: null, reference: "Transferencia ficticia", note: "Pago de octubre", actor: "Admin Ficticia", replenishment_id: U(64), purchase_id: null, receipt_number: null, cafeteria: null, items: [], reversal_id: null } ] };

describe("PIKAS Cash student page", () => {
  it("student name is the page identity; D.1 actions keep their place and authority; movements disclose existing detail", async () => {
    await page.evaluate(h => { (window as unknown as { walletHistory: unknown }).walletHistory = h; }, history);
    await page.evaluate(p => (window as unknown as { mountWallet(p: unknown): void }).mountWallet(p), { schoolId: school, studentId: U(11), actorId: actor, canReplenish: true, canReverse: true, canAdjust: false, back: { href: "/admin/escuela/estudiantes", label: "Estudiantes" } });
    await page.getByRole("heading", { level: 1, name: "Sol Ficticia" }).waitFor(); await page.getByText("PIKAS Cash del estudiante").waitFor(); await page.getByRole("link", { name: "Estudiantes" }).waitFor();
    expect(await page.getByRole("button", { name: "Recargar" }).count()).toBe(1); expect(await page.getByRole("button", { name: "Corregir saldo" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Revertir recarga" }).count()).toBe(1);
    const rows = page.getByRole("list").filter({ hasText: "Compra" }).locator(":scope > li");
    const purchase = await rows.nth(0).innerText(); expect(purchase).toContain("Recibo #41 · Cafetería Ficticia"); expect(purchase).toMatch(/−\s?RD\$\s?75\.00|-RD\$\s?75\.00/);
    expect(await rows.nth(0).locator('[data-money-intent="movement"]').getAttribute("data-money-tone")).toBe("negative");
    expect(await rows.nth(1).innerText()).toContain("Referencia: Transferencia ficticia");
    expect(await rows.nth(0).getByText("Sándwich ficticio").isVisible()).toBe(false);
    await rows.nth(0).getByText("Ver detalle").click(); await rows.nth(0).getByText("1 × Sándwich ficticio").waitFor();
    await rows.nth(1).getByText("Ver detalle").click(); expect(await rows.nth(1).innerText()).toContain("Pago de octubre");
    expect(await calls()).toEqual([{ url: "/api/school/wallet", key: null, body: { operation: "read", school_id: school, student_id: U(11), before: null } }]);
  });
});

const caf = U(100);
const cafeteriaData = (over: Record<string, unknown> = {}) => ({ scope: { cafeteria_id: caf, cafeteria_name: "Cafetería Ficticia", account_name: "Cuenta Ficticia", school_name: "Escuela Ficticia", location_name: "Campus Norte", tenant_kind: "customer", actor_id: actor, membership_id: U(101), account_id: U(4), capabilities: [] },
  settings: { currency: "DOP", scheduling_enabled: false, version: 1 }, categories: [], products: [], menus: [], shifts: [],
  registers: [{ id: U(110), code: "C1", name: "Caja Principal", status: "active", version: 4, has_history: true, open: true }, { id: U(111), code: "C2", name: "Caja Patio", status: "active", version: 2, has_history: false, open: false }],
  staff: [{ id: U(120), name: "Cajera Ficticia", role: "pos_cashier", status: "active", open: false }, { id: U(121), name: "Supervisor Ficticio", role: "pos_supervisor", status: "suspended", open: false }],
  assignments: [], invitations: [], service: null, ...over });
const mountCafeteria = (section: string, data = cafeteriaData()) => page.evaluate(([s, d]) => (window as unknown as { mountCafeteria(s: unknown, d: unknown): void }).mountCafeteria(s, d), [section, data] as const);

describe("Cajas configuration", () => {
  it("open registers cannot be edited; create is a focused configuration task with draft and one exact command; sessions are untouched", async () => {
    await mountCafeteria("registers"); await page.getByText("2 de 2 cajas").waitFor();
    expect(await page.getByRole("button", { name: "Editar caja Caja Principal" }).isDisabled()).toBe(true);
    await page.getByLabel("Buscar cajas").fill("zzz"); await page.getByText("No encontramos cajas con estos filtros.").waitFor(); await page.getByRole("button", { name: "Limpiar filtros" }).first().click();
    await page.getByRole("button", { name: "Crear caja" }).click(); await dlg().getByLabel("Nombre de caja *").fill("Caja Kiosco"); expect(await dlg().getByLabel(/Código de caja/).count()).toBe(0); expect(await dlg().innerText()).toContain("PIKAS asigna el código de la caja");
    await page.keyboard.press("Escape"); await dlg().getByRole("button", { name: "Cerrar y conservar borrador" }).click();
    await page.getByRole("button", { name: "Crear caja" }).click(); expect(await dlg().getByLabel("Nombre de caja *").inputValue()).toBe("Caja Kiosco");
    await dlg().getByRole("button", { name: "Continuar" }).click(); expect(await dlg().innerText()).toContain("Lo asigna PIKAS (CAJA-NN)");
    const before = (await calls()).filter(c => c.url === "/api/cafeteria"); expect(before).toHaveLength(0);
    await dlg().getByRole("button", { name: "Crear caja" }).click(); await dlg().getByText("Caja creada").first().waitFor();
    const sent = (await calls()).filter(c => c.url === "/api/cafeteria"); expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ cafeteriaId: caf, operation: "register_save", payload: { version: null, code: null, name: "Caja Kiosco", status: "active" } });
    expect((await calls()).filter(c => c.url.startsWith("/api/cafeteria/operations")).map(c => c.body?.operation).filter(op => op === "close" || op === "open")).toEqual([]); // the sessions list only reads
    expect(await storage("pikas:register-draft")).toEqual([]);
  });
  it("edit shows the assigned code without letting it be changed and sends the current version; assignment changes confirm in the app", async () => {
    await mountCafeteria("registers", cafeteriaData({ registers: [{ id: U(111), code: "C2", name: "Caja Patio", status: "active", version: 2, has_history: true, open: false }] }));
    await page.getByRole("button", { name: "Editar caja Caja Patio" }).click(); expect(await dlg().getByRole("textbox").count()).toBe(1); expect(await dlg().innerText()).toContain("Código de caja: C2");
    await dlg().getByLabel("Estado").selectOption("inactive"); await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Guardar caja" }).click(); await dlg().getByText("Caja actualizada").first().waitFor();
    expect((await calls()).filter(c => c.url === "/api/cafeteria")[0].body).toMatchObject({ operation: "register_save", payload: { id: U(111), version: 2, code: null, status: "inactive" } });
    await dlg().getByRole("button", { name: "Cerrar", exact: true }).click(); await page.getByText("Personal autorizado", { exact: true }).click(); await page.getByRole("button", { name: /^Asignar Caja Patio/ }).first().click();
    await page.getByText(/¿Asignar Caja Patio a .+\? Podrá abrir sesiones en esta caja desde el POS\./).waitFor(); expect((await calls()).filter(c => c.url === "/api/cafeteria")).toHaveLength(1);
  });
});

describe("Personal POS", () => {
  it("collection filters with empty/no-match; one-step access task: suggested username, optional email, caja, one request, password shown once; status change via task", async () => {
    await mountCafeteria("staff"); await page.getByText("2 de 2 personas").waitFor();
    await page.getByLabel("Filtrar por rol").selectOption("pos_supervisor"); await page.getByText("1 de 2 personas").waitFor();
    await page.getByLabel("Buscar personal").fill("zzz"); await page.getByText("No encontramos personas con estos filtros.").waitFor(); await page.getByRole("button", { name: "Limpiar filtros" }).first().click();
    await page.getByRole("button", { name: "Agregar personal a" }).click();
    expect(await dlg().getByLabel("Rol POS").locator("option").allInnerTexts()).toEqual(["Cajero", "Supervisor"]);
    await dlg().getByLabel("Nombre completo *").fill("María José Pérez García"); expect(await dlg().getByLabel(/^Usuario PIKAS/).inputValue()).toBe("maria.garcia");
    await dlg().getByLabel(/^Usuario PIKAS/).fill("maria.perez"); await dlg().getByLabel("Rol POS").selectOption("pos_supervisor");
    expect(await dlg().getByLabel("Correo (opcional)").inputValue()).toBe(""); await dlg().getByRole("button", { name: "Continuar" }).click();
    await dlg().getByRole("radio", { name: /Caja Patio/ }).check(); await dlg().getByRole("button", { name: "Continuar" }).click();
    expect(await dlg().innerText()).toContain("Sin correo · entra solo con su usuario");
    await win(`w => w.next("/api/cafeteria/staff-access", { body: { result: { membership_id: "${U(130)}", person_id: "${U(131)}", display_name: "María José Pérez García", username: "maria.perez", role: "pos_supervisor", email_kind: "internal", existing_identity: false, must_change_password: true, register: { register_id: "${U(111)}", assigned: true } }, temporary_password: "Temp-fictional-418xyz" } })`);
    await dlg().getByRole("button", { name: "Crear acceso" }).click(); await dlg().getByText("Listo para iniciar sesión").first().waitFor();
    const sent = (await calls()).filter(c => c.url === "/api/cafeteria/staff-access"); expect(sent).toHaveLength(1); expect(sent[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0].body).toEqual({ cafeteriaId: caf, display_name: "María José Pérez García", email: null, role: "pos_supervisor", username: "maria.perez", register_id: U(111) });
    const outcome = await dlg().innerText(); expect(outcome).toContain("Temp-fictional-418xyz"); expect(outcome).toContain("Caja Patio"); expect(outcome).toContain("no se volverá a mostrar");
    await dlg().getByRole("button", { name: "Cerrar", exact: true }).click(); expect(await page.getByText("Temp-fictional-418xyz").count()).toBe(0);
    await page.getByRole("button", { name: "Cambiar acceso de Cajera Ficticia" }).first().click();
    await dlg().getByLabel("Acceso a Cafetería Ficticia").selectOption("suspended"); expect(await dlg().innerText()).toContain("Solo afecta su acceso a esta cafetería"); await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Suspender acceso a Cafetería Ficticia" }).click();
    await dlg().getByText("Acceso POS actualizado").first().waitFor(); expect((await calls()).filter(c => c.url === "/api/cafeteria")[0].body).toMatchObject({ operation: "staff_status", payload: { membership_id: U(120), status: "suspended" } });
  });
  it("a username collision returns to the form with the explanation; an uncertain result retries with the same key", async () => {
    await mountCafeteria("staff"); await page.getByRole("button", { name: "Agregar personal a" }).click();
    await dlg().getByLabel("Nombre completo *").fill("Ana Ficticia"); await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Continuar" }).click();
    await win(`w => w.next("/api/cafeteria/staff-access", { status: 422, body: { error: "username_unavailable" } }, { status: 503, body: { error: "operation_uncertain" } })`);
    await dlg().getByRole("button", { name: "Crear acceso" }).click(); await dlg().getByRole("alert").filter({ hasText: "ya pertenece a otra persona" }).waitFor();
    await dlg().getByLabel(/^Usuario PIKAS/).fill("ana.ficticia2"); await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Crear acceso" }).click();
    await dlg().getByText("Pendiente de confirmar").first().waitFor();
    await win(`w => w.next("/api/cafeteria/staff-access", { body: { result: { membership_id: "${U(130)}", person_id: "${U(131)}", display_name: "Ana Ficticia", username: "ana.ficticia2", role: "pos_cashier", email_kind: "internal", existing_identity: false, must_change_password: true, register: null }, temporary_password: "Temp-fictional-418abc" } })`);
    await dlg().getByRole("button", { name: "Reintentar la misma solicitud" }).click(); await dlg().getByText("Listo para iniciar sesión").first().waitFor();
    const sent = (await calls()).filter(c => c.url === "/api/cafeteria/staff-access"); expect(sent).toHaveLength(3); expect(new Set(sent.map(c => c.key)).size).toBe(1); expect(sent[2].body?.username).toBe("ana.ficticia2");
    expect(await dlg().innerText()).toContain("Sin caja asignada todavía");
  });
  it("another unconfirmed cafeteria request keeps the existing lock: no new task, only its explicit retry", async () => {
    await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [`pikas:cafeteria:request:${actor}:${caf}`, JSON.stringify({ key: U(130), command: { cafeteriaId: caf, operation: "category_save", payload: { id: U(131), version: null, name: "Postres", display_order: 0, status: "active" } } })] as const);
    await mountCafeteria("staff"); await page.getByRole("button", { name: "Confirmar solicitud pendiente" }).waitFor();
    expect(await page.getByRole("button", { name: "Agregar personal a" }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Cambiar acceso de Cajera Ficticia" }).first().isDisabled()).toBe(true);
    expect((await calls()).filter(c => c.url === "/api/cafeteria")).toHaveLength(0);
  });
});

describe("Agregar colegio onboarding", () => {
  const fillSchool = async () => {
    await page.getByLabel(/^Nombre \*/).fill("Colegio Ficticio D3"); await page.getByLabel("RNC *").fill("1-01-23456-7");
    await page.getByLabel("Dirección *").fill("Calle Ficticia 3"); await page.getByLabel("Provincia *").selectOption("DO-25");
  };
  const fillAdmin = async () => {
    await page.getByLabel("Nombre del administrador *").fill("Admin Ficticia"); await page.getByLabel("Usuario PIKAS del administrador *").fill("admin.d3");
    await page.getByLabel("Correo del administrador *").fill("admin.d3@example.invalid");
  };
  it("one page: locked país, province select, no code fields, field errors, session draft across reload, review, discard — nothing sent", async () => {
    await page.evaluate(() => (window as unknown as { mountWizard(): void }).mountWizard());
    const country = page.getByLabel("País"); expect(await country.inputValue()).toBe("República Dominicana"); expect(await country.getAttribute("readonly")).not.toBeNull();
    expect(await page.getByLabel("Provincia *").locator("option").count()).toBe(33);
    expect(await page.getByText(/Código del colegio|Código de la escuela|Zona horaria/).count()).toBe(0);
    await page.getByRole("button", { name: "Revisar" }).click(); expect(await page.getByText("Obligatorio.").count()).toBe(7);
    await fillSchool(); await page.getByLabel("RNC *").fill("123"); await fillAdmin(); await page.getByRole("button", { name: "Revisar" }).click(); await page.getByText("RNC no válido.").waitFor();
    await page.getByLabel("RNC *").fill("1-01-23456-7");
    await page.reload(); await page.evaluate(() => (window as unknown as { mountWizard(): void }).mountWizard());
    await page.getByText("Recuperamos datos sin enviar").waitFor(); expect(await page.getByLabel("Provincia *").inputValue()).toBe("DO-25");
    await page.getByRole("button", { name: "Revisar" }).click(); const review = await page.locator("section").first().innerText();
    for (const t of ["Colegio Ficticio D3", "101234567", "Calle Ficticia 3", "República Dominicana", "Santiago", "Usuario PIKAS del administrador", "admin.d3@example.invalid", "No envía correo ni concede acceso"]) expect(review).toContain(t);
    await page.getByRole("button", { name: "Editar Colegio" }).click(); await page.getByLabel("Dirección *").waitFor();
    expect(await calls()).toHaveLength(0); expect(await storage("pikas:school-onboarding:v2")).toEqual([]);
    await page.getByRole("button", { name: "Descartar borrador" }).click(); await page.getByText("¿Descartar los datos escritos? No se ha creado nada.").waitFor(); await page.getByRole("button", { name: "Descartar borrador" }).click();
    expect(await storage("pikas:school-onboarding-draft")).toEqual([]); expect(await page.getByLabel(/^Nombre \*/).inputValue()).toBe("");
  });
  it("«Agregar colegio» runs the journey once; a partial result is reported truthfully and retried with the same keys", async () => {
    await page.evaluate(() => (window as unknown as { next(u: string, r: unknown): void }).next("/api/platform/customer-admins/prepare", { status: 503 }));
    await page.evaluate(() => (window as unknown as { mountWizard(): void }).mountWizard()); await fillSchool(); await fillAdmin();
    await page.getByRole("button", { name: "Revisar" }).click(); await page.getByRole("button", { name: "Agregar colegio" }).click(); await page.getByText("Creación incompleta").waitFor();
    expect(await page.getByText("La solicitud de su administrador aún no está confirmada.", { exact: false }).count()).toBe(1); expect(await page.getByText("Colegio agregado", { exact: true }).count()).toBe(0);
    expect(await storage("pikas:school-onboarding-draft")).toEqual([]); expect(await storage("pikas:school-onboarding:v2")).toHaveLength(1);
    await page.getByRole("button", { name: "Reintentar la misma solicitud" }).click(); await page.getByText("Ver colegio y completar administrador").waitFor();
    expect(await page.getByText("COL-0A1B2C3D4E").count()).toBe(1);
    const sent = await calls(); expect(sent.map(c => c.url)).toEqual(["/api/platform/schools/onboard", "/api/platform/customer-admins/prepare", "/api/platform/customer-admins/prepare"]);
    expect(sent[2].key).toBe(sent[1].key); expect(sent[0].body).toEqual({ schoolName: "Colegio Ficticio D3", taxId: "101234567", addressLine: "Calle Ficticia 3", countryCode: "DO", provinceCode: "DO-25" });
    expect(sent[1].body).toMatchObject({ intendedEmail: "admin.d3@example.invalid", intendedUsername: "admin.d3" }); expect(sent[2].body).toEqual(sent[1].body);
  });
  it("an existing onboarding journal is detected and only resent on explicit review", async () => {
    await page.evaluate(() => sessionStorage.setItem("pikas:school-onboarding:v2:operator-1", JSON.stringify({ draft: { schoolName: "Colegio J", taxId: "101234567", addressLine: "Calle J", countryCode: "DO", provinceCode: "DO-01", administratorName: "A", administratorEmail: "j@example.invalid", administratorUsername: "admin.j" }, tenantKey: "d3000000-0000-4000-8000-000000000201", adminKey: "d3000000-0000-4000-8000-000000000202", expiresAt: "2026-10-25T00:00:00.000Z", tenant: null, administrator: null })));
    await page.evaluate(() => (window as unknown as { mountWizard(): void }).mountWizard());
    await page.getByText("Hay un colegio pendiente de confirmar en este navegador.").waitFor(); await page.waitForTimeout(100); expect(await calls()).toHaveLength(0);
    await page.getByRole("button", { name: "Revisar solicitud pendiente" }).click(); await page.getByRole("button", { name: "Reintentar la misma solicitud" }).click(); await page.getByText("Ver colegio y completar administrador").waitFor();
    expect((await calls())[0].key).toBe("d3000000-0000-4000-8000-000000000201");
  });
});

describe("Equipo de PIKAS", () => {
  it("Añadir persona is a focused task on the existing team journal; demo toggle confirms in the app", async () => {
    await page.evaluate(d => (window as unknown as { mountTeam(d: unknown): void }).mountTeam(d), { actor_handle: "a".repeat(32), prepared: [], operators: [{ handle: "b".repeat(32), name: "Operadora Ficticia", email: "op@example.invalid", admin_status: "active", person_status: "active", demo: false }] });
    await page.getByRole("button", { name: "Añadir persona" }).click(); await dlg().getByLabel("Nombre *").fill("Nueva Ficticia"); await dlg().getByLabel("Correo *").fill("nueva@example.invalid");
    await dlg().getByRole("button", { name: "Continuar" }).click(); await dlg().getByRole("button", { name: "Preparar acceso" }).click(); await dlg().getByText("Acceso preparado").first().waitFor();
    expect((await calls())[0].body).toEqual({ operation: "prepare", payload: { name: "Nueva Ficticia", email: "nueva@example.invalid", demo: false } });
    await dlg().getByRole("button", { name: "Cerrar", exact: true }).click(); await page.getByRole("button", { name: "Habilitar demostración" }).click();
    await page.getByText("¿Habilitar el acceso al entorno de demostración compartido?").waitFor(); expect(await calls()).toHaveLength(1);
  });
});
