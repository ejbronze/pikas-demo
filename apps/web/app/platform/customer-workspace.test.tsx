import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requirePlatform: vi.fn(), readPlatform: vi.fn() }));
vi.mock("@/lib/platform/customer-console", () => ({ requirePlatform: mocks.requirePlatform, readPlatform: mocks.readPlatform }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, replace() {}, push() {} }), usePathname: () => "/platform/clientes" }));
(globalThis as { React?: typeof React }).React = React;
import CustomerPage from "./clientes/[accountId]/page";
import { readinessFixture as fx, request } from "../../lib/platform/readiness-fixtures";
import { readinessSteps } from "../../lib/platform/readiness";

// PIKAS UX 3: the customer page as one workspace with anchored sections. Fictional data only.
const A = "7e00d000-0000-4000-8000-000000000001", SCHOOL = "7e00d000-0000-4000-8000-0000000000b1", SEDE = "7e00d000-0000-4000-8000-0000000000c1", CAF = "7e00d000-0000-4000-8000-000000000101";
const caps = ["platform:tenant:lifecycle:read", "platform:tenant:lifecycle:manage", "platform:customer_admin:provision", "platform:identity:link", "platform:customer:profile:manage", "platform:customer:access:read",
  "platform:customer:access:provision", "platform:customer:operations:read", "platform:customer:operations:manage", "platform:tenant:provision"];
const session = (c = caps) => ({ identity: { user: { id: "real-operator" }, person: { displayName: "Operadora" } }, supabase: {}, capabilities: c });
const customer = { account: { id: A, name: "Colegio Ficticio de un nombre largo", code: "CLI-0A1B2C3D4E", status: "active" }, tenant_kind: "customer", administrators: [], customer_admin_onboarding: [],
  administrator_intents: [{ id: "7e00d000-0000-4000-8000-0000000000e1", email: "direccion@example.invalid", status: "pending", expires_at: "2026-10-27T01:12:00Z", role_code: "account_admin", scope_kind: "account", display_name: null }],
  schools: [{ id: SCHOOL, name: "Colegio Ficticio de un nombre largo", code: "COL-0A1B2C3D4E", status: "active", business_timezone: "America/Santo_Domingo", rnc: "131555555", address: "Calle 1", country: "DO", province: "DO-25", province_name: "Santiago",
    locations: [{ id: SEDE, name: "Sede Santiago", code: "SEDE-01", status: "active", cafeterias: [{ id: CAF, name: "Cafetería Santiago", code: "CAF-01", status: "active" }] }] }] };
const launch = fx(1, "empty", { name: customer.account.name, administrators: { active: 0, requests: [request({ request_expired: true })] }, structure: { first_cafeteria_id: CAF } });
const reads = (overrides: Record<string, unknown> = {}) => mocks.readPlatform.mockImplementation(async (_s: unknown, _c: unknown, rpc: string) => {
  const values: Record<string, unknown> = { platform_get_customer_overview: customer, platform_customer_lifecycle_history: { events: [] }, platform_customer_access_read: { account_id: A, people: [], pending: [] },
    platform_customer_readiness: { customers: [launch], sandbox: [], truncated: false }, platform_customer_activation_status: null, ...overrides };
  return values[rpc] === null ? { kind: "unavailable" } : { kind: "ready", value: values[rpc] };
});
const page = async () => renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: A }) }));
const navLinks = (html: string) => [...html.slice(html.indexOf('aria-label="Secciones del cliente"')).matchAll(/<a href="#([a-z-]+)"[^>]*>([^<]+)<\/a>/g)].slice(0, 6).map(m => [m[1], m[2]]);
beforeEach(() => { vi.clearAllMocks(); mocks.requirePlatform.mockResolvedValue(session()); reads(); });

describe("customer workspace", () => {
  it("one page with anchored sections in the approved order, each anchor present", async () => {
    const html = await page();
    expect(navLinks(html)).toEqual([["puesta-en-marcha", "Puesta en marcha"], ["colegio-profile", "Información"], ["customer-access", "Usuarios y accesos"], ["estructura", "Estructura"], ["operacion", "Operación"], ["estado-cliente", "Estado"]]);
    for (const anchor of ["puesta-en-marcha", "colegio-profile", "customer-access", "administrador-inicial", "estructura", "operacion", "estado-cliente"]) expect(html).toContain(`id="${anchor}"`);
    const order = ["id=\"puesta-en-marcha\"", "id=\"colegio-profile\"", "id=\"customer-access\"", "id=\"administrador-inicial\"", "id=\"estructura\"", "id=\"operacion\"", "id=\"estado-cliente\""].map(a => html.indexOf(a));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it("header: identity first, lifecycle and launch status as text, internal code quiet", async () => {
    const html = await page(), header = html.slice(0, html.indexOf('aria-label="Secciones del cliente"'));
    expect(header).toContain("Colegio Ficticio de un nombre largo"); expect(header).toContain(">Activo<"); expect(header).toContain(">Cliente<"); expect(header).toContain("En configuración");
    expect(header).toContain('class="text-xs text-slate-500">Código interno CLI-0A1B2C3D4E');
  });
  it("Editar is a section utility in the Información header, before the profile table, never a primary button", async () => {
    const html = await page(), info = html.slice(html.indexOf('id="colegio-profile"') - 200, html.indexOf('id="customer-access"'));
    const edit = info.indexOf('aria-label="Editar información de Colegio Ficticio de un nombre largo"');
    expect(edit).toBeGreaterThan(-1); expect(edit).toBeLessThan(info.indexOf("<dl"));
    expect(info).toMatch(/<button type="button" class="btn-tertiary gap-1.5" aria-label="Editar información de [^"]+"><svg[^>]*aria-hidden="true"[^>]*>.*<\/svg>Editar<\/button>/);
    expect(info).not.toContain('class="btn" ');
  });
  it("readiness deep links resolve to anchors on this page or to the existing cafetería pages", async () => {
    const html = await page();
    for (const step of readinessSteps(launch)) {
      if (!step.action) continue;
      const href = step.action.href;
      if (href.includes("#")) expect(html).toContain(`id="${href.split("#")[1]}"`);
      else expect(href).toBe(`/platform/clientes/7e00d000-0000-4000-8000-000000000001/gestion/cafeterias/${CAF}?seccion=${step.key === "cajas" ? "cajas" : "productos"}`);
    }
  });
  it("Usuarios y accesos: the initial-administrator control sits directly beneath and pending admin access links to it", async () => {
    reads({ platform_customer_access_read: { account_id: A, people: [], pending: [{ kind: "initial_admin", request_id: "7e00d000-0000-4000-8000-0000000000e1", role_code: "account_admin", scope: "account", status: "pending",
      email: "direccion@example.invalid", username: null, school_name: null, cafeteria_name: null, created_at: null, expires_at: null, request_expired: true, identity_state: null, link_state: null }] } });
    const html = await page();
    expect(html).toContain('href="#administrador-inicial">Administrador inicial</a>');
    const between = html.slice(html.indexOf('id="customer-access"'), html.indexOf('id="administrador-inicial"'));
    expect(between).not.toContain('id="estructura"'); expect(between).not.toContain('id="colegio-profile"');
    expect(html.match(/id="administrador-inicial"/g)).toHaveLength(1);
  });
  it("without access read, the navigation names the administrator control instead of Usuarios y accesos", async () => {
    mocks.requirePlatform.mockResolvedValue(session(caps.filter(c => c !== "platform:customer:access:read")));
    const html = await page();
    expect(navLinks(html)).toContainEqual(["administrador-inicial", "Administrador inicial"]); expect(html).not.toContain("Usuarios y accesos");
  });
  it("Estructura reads colegio → sede → cafetería with structure actions and a Cajas link; codes stay secondary", async () => {
    const html = await page(), tree = html.slice(html.indexOf('id="estructura"'), html.indexOf('id="operacion"'));
    expect(tree.indexOf("Colegio Ficticio de un nombre largo")).toBeLessThan(tree.indexOf("Sede Santiago")); expect(tree.indexOf("Sede Santiago")).toBeLessThan(tree.indexOf("Cafetería Santiago"));
    expect(tree).toContain(">Agregar sede<"); expect(tree).toContain('aria-label="Renombrar sede Sede Santiago"'); expect(tree).toContain('aria-label="Renombrar cafetería Cafetería Santiago"');
    expect(tree).toContain(`href="/platform/clientes/${A}/gestion/cafeterias/${CAF}?seccion=cajas"`);
    expect(tree).toContain('<span class="ws-meta">Activo · SEDE-01</span>'); expect(tree).not.toContain(SEDE);
  });
  it("Operación: one primary entry to the existing support workspace, per-cafetería links, honest boundary", async () => {
    const html = await page(), ops = html.slice(html.indexOf('id="operacion"'), html.indexOf('id="estado-cliente"'));
    expect(ops).toContain(`<a class="btn" href="/platform/clientes/${A}/gestion">Administrar operación</a>`);
    expect(ops).toContain(`href="/platform/clientes/${A}/gestion/cafeterias/${CAF}"`); expect(ops).toContain("no como usuario del cliente");
    mocks.requirePlatform.mockResolvedValue(session(caps.filter(c => !c.startsWith("platform:customer:operations"))));
    const without = await page(); expect(without).not.toContain('id="operacion"'); expect(without).not.toContain("Administrar operación");
  });
  it("lifecycle: history first, state changes apart at the bottom, still available and never next to routine actions", async () => {
    const html = await page(), life = html.slice(html.indexOf('id="estado-cliente"'));
    expect(life.indexOf("Historial del ciclo de vida")).toBeLessThan(life.indexOf("Cambiar estado del cliente"));
    expect(life).toContain(">Suspender<"); expect(life).toContain(">Cerrar cliente<"); expect(life).toContain("border-red-300");
    expect(life).not.toContain("Administrar operación");
    mocks.requirePlatform.mockResolvedValue(session(caps.filter(c => c !== "platform:tenant:lifecycle:manage")));
    const readOnly = await page(); expect(readOnly).toContain("Estado del cliente"); expect(readOnly).not.toContain("Cambiar estado del cliente");
  });
});
