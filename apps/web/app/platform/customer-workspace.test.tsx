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
import { workspaceHref } from "../../lib/platform/workspace";

// Platform Operations & Support Console (UX 15+16): the customer workspace as sections of one route,
// the customer context persistent above them. Fictional data only.
const A = "7e00d000-0000-4000-8000-000000000001", SCHOOL = "7e00d000-0000-4000-8000-0000000000b1", SEDE = "7e00d000-0000-4000-8000-0000000000c1", CAF = "7e00d000-0000-4000-8000-000000000101";
const caps = ["platform:tenant:lifecycle:read", "platform:tenant:lifecycle:manage", "platform:customer_admin:provision", "platform:identity:link", "platform:customer:profile:manage", "platform:customer:access:read",
  "platform:customer:access:provision", "platform:customer:operations:read", "platform:customer:operations:manage", "platform:tenant:provision", "platform:audit:read", "platform:identity:support"];
const session = (c = caps) => ({ identity: { user: { id: "real-operator" }, person: { displayName: "Operadora" } }, supabase: {}, capabilities: c });
const customer = { account: { id: A, name: "Colegio Ficticio de un nombre largo", code: "CLI-0A1B2C3D4E", status: "active" }, tenant_kind: "customer", administrators: [], customer_admin_onboarding: [],
  administrator_intents: [{ id: "7e00d000-0000-4000-8000-0000000000e1", email: "direccion@example.invalid", status: "pending", expires_at: "2026-10-27T01:12:00Z", role_code: "account_admin", scope_kind: "account", display_name: null }],
  schools: [{ id: SCHOOL, name: "Colegio Ficticio de un nombre largo", code: "COL-0A1B2C3D4E", status: "active", business_timezone: "America/Santo_Domingo", rnc: "131555555", address: "Calle 1", country: "DO", province: "DO-25", province_name: "Santiago",
    locations: [{ id: SEDE, name: "Sede Santiago", code: "SEDE-01", status: "active", cafeterias: [{ id: CAF, name: "Cafetería Santiago", code: "CAF-01", status: "active" }] }] }] };
const launch = fx(1, "empty", { name: customer.account.name, administrators: { active: 0, requests: [request({ request_expired: true })] }, structure: { first_cafeteria_id: CAF } });
const support = (student_service: Record<string, unknown> | null = { sharing: "never", identification_shared: false, school_has_students: false, enabled_students: 0, state: "not_shared" }) => ({
  scope: { cafeteria_id: CAF, cafeteria_name: "Cafetería Santiago", cafeteria_status: "active", account_id: A, account_name: customer.account.name, account_status: "active", school_name: customer.account.name, location_name: "Sede Santiago", tenant_kind: "customer", actor_id: A, membership_id: null, capabilities: [], support: true },
  settings: { currency: "DOP", scheduling_enabled: false, version: 1 }, categories: [], products: [], menus: [], shifts: [], registers: [{ id: SEDE, code: "C1", name: "Caja Uno", status: "active", version: 1, has_history: false, open: false }], staff: [], assignments: [], invitations: [], service: null, ...(student_service ? { student_service } : {}) });
const reads = (overrides: Record<string, unknown> = {}) => mocks.readPlatform.mockImplementation(async (_s: unknown, _c: unknown, rpc: string) => {
  const values: Record<string, unknown> = { platform_get_customer_overview: customer, platform_customer_lifecycle_history: { events: [] }, platform_customer_access_read: { account_id: A, people: [], pending: [] },
    platform_customer_readiness: { customers: [launch], sandbox: [], truncated: false }, platform_customer_activation_status: null, platform_support_cafeteria_read: support(),
    platform_read_audit: [{ id: "7e00d000-0000-4000-8000-0000000000a1", occurred_at: "2026-10-20T12:00:00Z", action: "school_location_added", target_account_id: A }, { id: "7e00d000-0000-4000-8000-0000000000a2", occurred_at: "2026-10-21T12:00:00Z", action: "customer_profile_updated", target_account_id: "7e00d000-0000-4000-8000-000000000999" }], ...overrides };
  return values[rpc] === null ? { kind: "unavailable" } : { kind: "ready", value: values[rpc] };
});
const page = async (seccion?: string, extra: Record<string, string> = {}) => renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: A }), searchParams: Promise.resolve({ ...(seccion ? { seccion } : {}), ...extra }) }));
const navLinks = (html: string) => [...html.slice(html.indexOf('aria-label="Secciones del cliente"')).matchAll(/<a (aria-current="page" )?href="([^"]+)">([^<]+)<\/a>/g)].slice(0, 6).map(m => [m[2], m[3], !!m[1]]);
const rpcs = () => mocks.readPlatform.mock.calls.map(c => c[2] as string);
beforeEach(() => { vi.clearAllMocks(); mocks.requirePlatform.mockResolvedValue(session()); reads(); });

describe("customer workspace", () => {
  it("sections of one route with the customer context on every one; the current section is marked", async () => {
    const html = await page();
    expect(navLinks(html)).toEqual([[`/platform/clientes/${A}`, "Resumen", true], [`/platform/clientes/${A}?seccion=estructura`, "Estructura", false], [`/platform/clientes/${A}?seccion=personas`, "Personas y accesos", false],
      [`/platform/clientes/${A}?seccion=operacion`, "Operación", false], [`/platform/clientes/${A}?seccion=actividad`, "Actividad", false], [`/platform/clientes/${A}?seccion=estado`, "Estado", false]]);
    expect(html.match(/<h1/g)).toHaveLength(1); expect(html).toContain('class="ws-context"');
    const estado = await page("estado"); expect(navLinks(estado).find(l => l[1] === "Estado")?.[2]).toBe(true); expect(estado).toContain("Colegio Ficticio de un nombre largo");
    expect(await page("nope")).toContain('id="puesta-en-marcha"'); // unknown section falls back to Resumen
  });
  it("context: name first, lifecycle and launch as text, next step with its owner, code quiet", async () => {
    const html = await page(), header = html.slice(0, html.indexOf('aria-label="Secciones del cliente"'));
    expect(header).toContain('<h1 class="ws-context-name">Colegio Ficticio de un nombre largo</h1>'); expect(header).toContain(">Activo<"); expect(header).toContain(">Cliente<"); expect(header).toContain("En configuración");
    expect(header).toContain("Siguiente paso · PIKAS"); expect(header).toContain("Administrador"); expect(header).toContain('class="ws-context-code">Código interno CLI-0A1B2C3D4E');
    expect(header.indexOf("Colegio Ficticio de un nombre largo")).toBeLessThan(header.indexOf("CLI-0A1B2C3D4E"));
  });
  it("Resumen: setup map with Platform steps, the owner of the next action, and the School-owned student service per cafetería (aggregate only)", async () => {
    const html = await page();
    expect(html).toContain('id="puesta-en-marcha"'); expect(html).toContain("lo completa PIKAS"); expect(html).toContain("La Plataforma puede completarlo desde este cliente.");
    expect(html).toContain("1 colegio · 1 sede · 1 cafetería");
    expect(html).toContain('id="servicio-estudiantes"'); expect(html).toContain("lo administra el colegio"); expect(html).toContain("todavía no ha compartido estudiantes con Cafetería Santiago");
    expect(html).toContain("Propietario del siguiente paso: el colegio"); expect(html).not.toMatch(/Habilitar estudiantes|Compartir con/); // Platform never offers School actions
    expect(rpcs()).toContain("platform_support_cafeteria_read"); expect(rpcs()).not.toContain("platform_customer_access_read"); expect(rpcs()).not.toContain("platform_read_audit");
    reads({ platform_support_cafeteria_read: support({ sharing: "active", identification_shared: true, school_has_students: true, enabled_students: 3, state: "ready" }) });
    expect(await page()).toContain("3 estudiantes habilitados");
    reads({ platform_support_cafeteria_read: support(null) });
    expect(await page()).toContain("todavía no informa el estado del servicio a estudiantes"); // older read without the 13B status: nothing invented
    mocks.requirePlatform.mockResolvedValue(session(caps.filter(c => !c.startsWith("platform:customer:operations")))); mocks.readPlatform.mockClear();
    const noOps = await page(); expect(noOps).not.toContain('id="servicio-estudiantes"'); expect(rpcs()).not.toContain("platform_support_cafeteria_read");
  });
  it("readiness deep links resolve to the right section anchor or to the existing cafetería pages", async () => {
    for (const step of readinessSteps(launch)) {
      if (!step.action) continue;
      const href = step.action.href;
      if (href.includes("#")) { const [path, anchor] = href.split("#"); const seccion = new URL(path, "http://x").searchParams.get("seccion") ?? "resumen"; expect(await page(seccion)).toContain(`id="${anchor}"`); }
      else expect(href).toBe(`/platform/clientes/${A}/gestion/cafeterias/${CAF}?seccion=${step.key === "cajas" ? "cajas" : "productos"}`);
    }
    expect(workspaceHref(A, undefined, "customer-access")).toBe(`/platform/clientes/${A}?seccion=personas#customer-access`);
    expect(workspaceHref(A, undefined, "puesta-en-marcha")).toBe(`/platform/clientes/${A}#puesta-en-marcha`);
  });
  it("Estructura: colegio → sede → cafetería with structure actions and the Operación link; Editar is a section utility", async () => {
    const html = await page("estructura");
    expect(html.indexOf("Colegio Ficticio de un nombre largo")).toBeLessThan(html.indexOf("Sede Santiago")); expect(html.indexOf("Sede Santiago")).toBeLessThan(html.indexOf("Cafetería Santiago"));
    expect(html).toContain(">Agregar sede<"); expect(html).toContain('aria-label="Renombrar sede Sede Santiago"'); expect(html).toContain('aria-label="Renombrar cafetería Cafetería Santiago"');
    expect(html).toContain(`href="/platform/clientes/${A}/gestion/cafeterias/${CAF}"`); expect(html).toContain('<span class="ws-meta">Activo · SEDE-01</span>'); expect(html).not.toContain(SEDE);
    const info = html.slice(html.indexOf('id="colegio-profile"') - 200, html.indexOf('id="estructura"'));
    expect(info.indexOf('aria-label="Editar información de Colegio Ficticio de un nombre largo"')).toBeLessThan(info.indexOf("<dl")); expect(info).not.toContain('class="btn" ');
    expect(rpcs()).not.toContain("platform_customer_access_read");
  });
  it("Personas: people rows open in a sheet; the initial administrator is history once an administrator exists", async () => {
    const html = await page("personas");
    expect(html).toContain('id="customer-access"'); expect(html).toContain('id="administrador-inicial"'); expect(html).toContain("Agregar personal POS");
    expect(html).toContain("Verificar identidad y completar acceso"); expect(html).toContain("Activación pendiente"); expect(html).not.toContain("Preparar administrador"); // a live request: its card and recovery, never a second preparation
    reads({ platform_get_customer_overview: { ...customer, administrator_intents: [] } });
    expect(await page("personas")).toContain("Preparar administrador");
    reads({ platform_get_customer_overview: { ...customer, administrators: [{ display_name: "Ana Ficticia", status: "active", person_status: "active" }] } });
    const done = await page("personas");
    expect(done).toContain("Administrador inicial · completado"); expect(done).not.toContain("Preparar administrador"); expect(done).not.toContain("Generar enlace de activación"); expect(done).toContain("Solicitudes anteriores sin usar (1)");
  });
  it("Operación: the canonical entry, per-cafetería links, honest boundary, no second landing", async () => {
    const html = await page("operacion");
    expect(html).toContain('id="operacion"'); expect(html).toContain(`href="/platform/clientes/${A}/gestion/cafeterias/${CAF}"`); expect(html).toContain("no como usuario del cliente");
    expect(html).not.toContain(`href="/platform/clientes/${A}/gestion"`); expect(html).not.toContain("Administrar operación");
    mocks.requirePlatform.mockResolvedValue(session(caps.filter(c => !c.startsWith("platform:customer:operations"))));
    const without = await page("operacion"); expect(without).not.toContain('id="operacion"'); expect(without).toContain("Dónde está este cliente"); // falls back to Resumen (readiness itself needs operations:read)
  });
  it("Actividad: only this customer's Platform events, in operator words; honest when the audit read fails", async () => {
    const html = await page("actividad");
    expect(html).toContain("Sede agregada"); expect(html).not.toContain("Perfil del cliente actualizado");
    reads({ platform_read_audit: null }); expect(await page("actividad")).toContain("No pudimos cargar la actividad de este cliente.");
    reads({ platform_read_audit: [] }); expect(await page("actividad")).toContain("Sin actividad de plataforma reciente para este cliente.");
  });
  it("Estado: lifecycle history and the existing actions, apart from routine work; read-only without the capability", async () => {
    const html = await page("estado");
    expect(html.indexOf("Historial del ciclo de vida")).toBeLessThan(html.indexOf("Cambiar estado del cliente"));
    expect(html).toContain(">Suspender<"); expect(html).toContain(">Cerrar cliente<"); expect(html).not.toContain("Administrar operación");
    mocks.requirePlatform.mockResolvedValue(session(caps.filter(c => c !== "platform:tenant:lifecycle:manage")));
    const readOnly = await page("estado"); expect(readOnly).toContain("Estado del cliente"); expect(readOnly).not.toContain("Cambiar estado del cliente");
  });
  it("suspended customer: the state is visible everywhere and the setup map pauses honestly", async () => {
    reads({ platform_get_customer_overview: { ...customer, account: { ...customer.account, status: "suspended" } }, platform_customer_readiness: { customers: [{ ...launch, status: "suspended" }], sandbox: [], truncated: false } });
    const html = await page();
    expect(html).toContain(">Suspendido<"); expect(html).toContain("La puesta en marcha queda en pausa."); expect(html).not.toContain("Siguiente paso · PIKAS");
  });
});
