import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requirePlatform: vi.fn(), readPlatform: vi.fn(), launcher: vi.fn() }));
vi.mock("@/lib/platform/customer-console", () => ({ requirePlatform: mocks.requirePlatform, readPlatform: mocks.readPlatform }));
vi.mock("@/lib/platform/sandbox-launcher", async () => ({ ...(await import("../../lib/platform/sandbox-launcher")), loadSandboxLauncherState: mocks.launcher }));
// No vitest alias config: resolve the Demo workspace component to its real implementation.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, replace() {}, push() {} }), usePathname: () => "/platform/demostracion" }));
(globalThis as { React?: typeof React }).React = React;
import CustomersPage from "./clientes/page";
import CustomerPage from "./clientes/[accountId]/page";
import NewCustomerPage from "./clientes/nuevo/page";
import DemonstrationPage from "./demostracion/page";
const id = "00000000-0000-4000-8000-000000000001";
const session = { identity: { user: { id: "real-operator" }, person: { displayName: "Operador" } }, supabase: {}, capabilities: ["platform:tenant:lifecycle:read", "platform:tenant:provision", "platform:customer_admin:provision", "platform:identity:link", "platform:sandbox:pov:enter"] };
const customer = { account: { id, name: "Cliente real", code: "CLIENTE", status: "active" }, tenant_kind: "customer", schools: [], administrators: [], customer_admin_onboarding: [], administrator_intents: [{ id, email: "admin@example.invalid", status: "pending", expires_at: "2026-10-17T00:00:00Z", role_code: "account_admin", scope_kind: "account", display_name: null }] };
beforeEach(() => { vi.clearAllMocks(); mocks.requirePlatform.mockResolvedValue(session); });
// Detail reads: the overview plus (Platform lifecycle) the history read.
const detail = (value: unknown, events: unknown[] = []) => mocks.readPlatform.mockImplementation(async (_s: unknown, _c: unknown, rpc: string) => ({ kind: "ready", value: rpc === "platform_customer_lifecycle_history" ? { events } : value }));
// UX 15: the workspace renders one section per request.
const open = (seccion: string, extra: Record<string, string> = {}, accountId = id) => CustomerPage({ params: Promise.resolve({ accountId }), searchParams: Promise.resolve({ seccion, ...extra }) });
describe("customer server screens", () => {
  it("list denies sandbox-only operators before reading customer records", async () => {
    mocks.requirePlatform.mockResolvedValue({ ...session, capabilities: ["platform:sandbox:pov:enter"] });
    expect(renderToStaticMarkup(await CustomersPage({ searchParams: Promise.resolve({}) }))).toContain("No tienes permiso"); expect(mocks.readPlatform).not.toHaveBeenCalled();
  });
  it("passes validated search filters to authoritative listing and shows empty state", async () => {
    mocks.readPlatform.mockResolvedValue({ kind: "ready", value: { customers: [], next_cursor: null } });
    const html = renderToStaticMarkup(await CustomersPage({ searchParams: Promise.resolve({ q: "Horizonte", kind: "sandbox", status: "active" }) }));
    expect(html).toContain("No hay clientes que coincidan"); expect(mocks.readPlatform).toHaveBeenCalledWith(session, "platform:tenant:lifecycle:read", "platform_list_customers", { p_query: "Horizonte", p_kind: "sandbox", p_status: "active", p_after: null, p_limit: 25 }, expect.anything());
  });
  it("invalid filters do not reach the read contract", async () => {
    expect(renderToStaticMarkup(await CustomersPage({ searchParams: Promise.resolve({ kind: "platform_admin" }) }))).toContain("Los filtros no son válidos"); expect(mocks.readPlatform).not.toHaveBeenCalled();
  });
  it("new customer screen requires both provisioning capabilities", async () => {
    mocks.requirePlatform.mockResolvedValue({ ...session, capabilities: ["platform:tenant:provision"] });
    expect(renderToStaticMarkup(await NewCustomerPage())).toContain("No tienes permiso");
  });
  it("detail presents pending/setup state without showing technical identity values", async () => {
    mocks.readPlatform.mockImplementation(async (_session, _cap, rpc) => ({ kind: "ready", value: rpc === "platform_customer_activation_status" ? {intent_id:id,account_id:id,identity_state:"missing",link_state:"none",expires_at:null} : rpc === "platform_customer_lifecycle_history" ? { events: [] } : customer }));
    const html = renderToStaticMarkup(await open("personas"));
    expect(html).toContain("Acceso preparado"); expect(html).toContain("Activación pendiente"); expect(html).toContain("No se envía correo"); expect(html).toContain("Verificar identidad y completar acceso"); expect(html).toContain("Generar enlace de activación");
    expect(html.replace(/<[^>]*>/g, "")).not.toContain(id);
  });
  it.each([['linked','Listo para completar'],['granted','Acceso completado']])('presents authoritative %s state without introducing invitation actions',async(status,label)=>{
    detail({...customer,administrator_intents:[{...customer.administrator_intents[0],status}]});
    const html=renderToStaticMarkup(await open("personas"));expect(html).toContain(label);expect(html).not.toContain('Crear enlace de invitación');
  });
  it("Información del colegio shows the persisted profile read-only and never fabricates missing values", async () => {
    const school = (over: Record<string, unknown>) => ({ id: "00000000-0000-4000-8000-0000000000b1", name: "Colegio Ficticio Atlántico", code: "COL-0A1B2C3D4E", status: "active", business_timezone: "America/Santo_Domingo", locations: [], ...over });
    detail({ ...customer, schools: [school({ rnc: "131987654", address: "Av. Ficticia 12", country: "DO", province: "DO-25", province_name: "Santiago" })] });
    let html = renderToStaticMarkup(await open("estructura"));
    const profile = html.slice(html.indexOf('id="colegio-profile"'), html.indexOf("</section>", html.indexOf('id="colegio-profile"')));
    expect(profile).toContain("Información del colegio");
    for (const [label, value] of [["Nombre", "Colegio Ficticio Atlántico"], ["RNC", "131987654"], ["Dirección", "Av. Ficticia 12"], ["País", "República Dominicana"], ["Provincia", "Santiago"], ["Código del colegio", "COL-0A1B2C3D4E"]])
      expect(profile).toMatch(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>${value}</dd>`));
    expect(profile).not.toMatch(/>DO</); expect(profile).not.toContain("DO-25"); expect(profile).not.toContain("account_admin");
    expect(profile).not.toMatch(/<(input|select|textarea|button|form)\b/); expect(profile).not.toMatch(/Editar|Guardar/);
    // A colegio provisioned before Agregar colegio: no profile fields, or explicit nulls.
    for (const legacy of [school({}), school({ rnc: null, address: null, country: null, province: null, province_name: null })]) {
      detail({ ...customer, schools: [legacy] });
      html = renderToStaticMarkup(await open("estructura"));
      expect(html.match(/No registrado/g)).toHaveLength(4); expect(html).toContain("COL-0A1B2C3D4E"); expect(html).toContain("Estructura del cliente");
    }
    detail(customer); html = renderToStaticMarkup(await open("estructura"));
    expect(html).not.toContain("Información del colegio"); expect(html).toContain("No hay escuelas registradas.");
  });
  it("profile editing: Editar información and Renombrar only with the profile capability, for active or suspended customers", async () => {
    const school = { id: "00000000-0000-4000-8000-0000000000b1", name: "Colegio Ficticio", code: "COL-0A1B2C3D4E", status: "active", business_timezone: "America/Santo_Domingo", rnc: null, address: null, country: null, province: null, province_name: null,
      locations: [{ id: "00000000-0000-4000-8000-0000000000c1", name: "Sede principal", code: "SEDE-PRINCIPAL", status: "active", cafeterias: [{ id: "00000000-0000-4000-8000-0000000000d1", name: "Cafetería principal", code: "CAF-PRINCIPAL", status: "active" }] }] };
    const render = async (status: string, caps: string[], kind = "customer") => { mocks.requirePlatform.mockResolvedValue({ ...session, capabilities: [...session.capabilities, ...caps] });
      detail({ ...customer, tenant_kind: kind, account: { ...customer.account, status }, schools: [school] }); return renderToStaticMarkup(await open("estructura")); };
    const profile = ["platform:customer:profile:manage"];
    for (const status of ["active", "suspended"]) {
      const html = await render(status, profile);
      expect(html).toContain("Editar información"); expect(html).toContain('aria-label="Renombrar sede Sede principal"'); expect(html).toContain('aria-label="Renombrar cafetería Cafetería principal"');
    }
    for (const [status, caps, kind] of [["closed", profile, "customer"], ["active", ["platform:customer:operations:manage", "platform:tenant:lifecycle:manage"], "customer"], ["active", profile, "sandbox"]] as const) {
      const html = await render(status, [...caps], kind); expect(html).not.toContain("Editar información"); expect(html).not.toContain("Renombrar");
    }
  });
  it("Usuarios y accesos: people once with every grant, registers, login state, pending access; read-only and secret-free", async () => {
    const P = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
    const grant = (n: number, over: Record<string, unknown>) => ({ membership_id: P(50 + n), scope: "cafeteria", role_code: "cafeteria_admin", status: "active", created_at: "2026-10-20T12:00:00Z", updated_at: null,
      school_id: P(90), school_name: "Colegio Ficticio", cafeteria_id: P(91), cafeteria_name: "Cafetería Santiago", location_name: "Sede Norte", registers: [], ...over });
    const person = { person_id: P(1), display_name: "Ana Ficticia de un nombre muy largo para comprobar el ajuste en pantallas pequeñas", person_status: "active", created_at: null, has_login: true,
      username: "ana.ficticia", email: "ana.ficticia.correo.muy.largo.para.probar@example.invalid", phone: null, email_confirmed: true, last_sign_in_at: null, must_change_password: false, login_suspended: false,
      email_change_pending: false, temporary_issued_at: null, grants: [grant(1, { scope: "account", role_code: "account_admin", school_id: null, school_name: null, cafeteria_id: null, cafeteria_name: null, location_name: null }),
        grant(2, {}), grant(3, { cafeteria_id: P(92), cafeteria_name: "Cafetería Tamboril" }), grant(4, { role_code: "pos_cashier", registers: [{ register_id: P(70), name: "Caja 1", code: "C1", register_status: "active", assignment_status: "active" }] })] };
    const pending = { kind: "initial_admin", request_id: P(80), role_code: "account_admin", scope: "account", status: "pending", email: "coordinacion.ficticia@example.invalid", username: "admficticio",
      school_name: null, cafeteria_name: null, created_at: "2026-10-20T01:12:00Z", expires_at: "2026-10-27T01:12:00Z", request_expired: false, identity_state: "activation_pending", link_state: "expired" };
    const caps = [...session.capabilities, "platform:customer:access:read"];
    const render = async (access: unknown, extra: string[] = [], kind = "customer") => {
      mocks.requirePlatform.mockResolvedValue({ ...session, capabilities: [...caps, ...extra] });
      mocks.readPlatform.mockImplementation(async (_s: unknown, _c: unknown, rpc: string) => rpc === "platform_customer_access_read" ? access : { kind: "ready", value: rpc === "platform_customer_lifecycle_history" ? { events: [] } : { ...customer, tenant_kind: kind } });
      const html = renderToStaticMarkup(await open("personas"));
      const at = html.indexOf('id="customer-access"'); if (at < 0) return ""; const nested = html.indexOf("</section></section>", at);
      return html.slice(html.lastIndexOf("<section", at), nested >= 0 ? nested + 20 : html.indexOf("</section>", at) + 10);
    };
    const full = await render({ kind: "ready", value: { account_id: id, people: [person], pending: [pending] } }, ["platform:identity:support"]);
    expect(full).toContain("Personas y accesos"); expect(full).toContain("Usuarios con acceso");
    expect(full.match(/>Ana Ficticia de un nombre muy largo/g)?.length).toBe(1);
    for (const label of ["Administrador del colegio", "Administrador de cafetería · Cafetería Santiago", "Administrador de cafetería · Cafetería Tamboril", "Personal de caja · Cafetería Santiago", "Nunca ha iniciado sesión", "Usuario ana.ficticia"])
      expect(full).toContain(label.replace(/·/g, "·"));
    expect(full).toContain("Pendientes"); expect(full).toContain("coordinacion.ficticia@example.invalid"); expect(full).toContain("Usuario reservado admficticio");
    expect(full).toContain("Pendiente de activación"); expect(full).toContain("Enlace vencido");
    // UX 16: no detour through global Identidades; the person opens in context (one Abrir per person, nothing else interactive).
    expect(full).not.toContain('href="/platform/identidades"'); expect(full).toMatch(/aria-label="Abrir Ana Ficticia[^"]*">Abrir<\/button>/);
    expect(full).not.toMatch(/<(input|select|textarea|form)\b/); expect(full.match(/<button/g)).toHaveLength(1);
    expect(full).not.toMatch(/Suspender|Reenviar|Restablecer|Eliminar|Asignar rol|Quitar acceso|Editar/);
    expect(full).not.toMatch(/account_admin|cafeteria_admin|pos_cashier|token|password/i);
    // The sheet (direct link ?persona=) carries the registers and the credential entry, still read-only here.
    mocks.requirePlatform.mockResolvedValue({ ...session, capabilities: [...caps, "platform:identity:support"] });
    mocks.readPlatform.mockImplementation(async (_s: unknown, _c: unknown, rpc: string) => rpc === "platform_customer_access_read" ? { kind: "ready", value: { account_id: id, people: [person], pending: [] } } : { kind: "ready", value: rpc === "platform_customer_lifecycle_history" ? { events: [] } : customer });
    const sheet = renderToStaticMarkup(await open("personas", { persona: P(1) }));
    expect(sheet).toContain('data-variant="sheet"'); expect(sheet).toContain("Cajas: Caja 1"); expect(sheet).toContain(">Credenciales<"); expect(sheet).toContain("Personas → Ana Ficticia");
    expect(sheet).not.toMatch(/account_admin|cafeteria_admin|pos_cashier|token|password/i);
    const noActive = await render({ kind: "ready", value: { account_id: id, people: [], pending: [pending] } });
    expect(noActive).toContain("No hay usuarios con acceso activo para este cliente."); expect(noActive).toContain("Pendientes");
    const empty = await render({ kind: "ready", value: { account_id: id, people: [], pending: [] } });
    expect(empty).toContain("Aún no se ha dado acceso al personal de este cliente."); expect(empty).not.toContain("Pendientes");
    expect(await render({ kind: "unavailable" })).toContain("No pudimos cargar los accesos");
    expect(await render({ kind: "ready", value: { account_id: P(99), people: [person], pending: [] } })).toContain("No pudimos cargar los accesos");
    mocks.requirePlatform.mockResolvedValue(session); mocks.readPlatform.mockClear();
    detail(customer); expect(renderToStaticMarkup(await open("personas"))).not.toContain('id="customer-access"');
    expect(mocks.readPlatform.mock.calls.map(c => c[2])).not.toContain("platform_customer_access_read");
    expect(await render({ kind: "ready", value: { account_id: id, people: [person], pending: [] } }, [], "sandbox")).toBe("");
  });
  it("Platform provisioning actions appear only with the provisioning capability, and only while the customer allows them", async () => {
    const P = (n: number) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`;
    const school = { id: P(1), name: "Colegio Ficticio", code: "COL-0A1B2C3D4E", status: "active", business_timezone: "America/Santo_Domingo", rnc: null, address: null, country: null, province: null, province_name: null,
      locations: [{ id: P(2), name: "Sede Santiago", code: "S1", status: "active", cafeterias: [{ id: P(3), name: "Cafetería Santiago", code: "C1", status: "active" }, { id: P(4), name: "Cafetería Tamboril", code: "C2", status: "active" }] }] };
    const person = { person_id: P(10), display_name: "Manuel Ficticio", person_status: "active", created_at: null, has_login: true, username: "manuel.f", email: "m@example.invalid", phone: null, email_confirmed: true,
      last_sign_in_at: null, must_change_password: false, login_suspended: false, email_change_pending: false, temporary_issued_at: null,
      grants: [{ membership_id: P(11), scope: "cafeteria", role_code: "cafeteria_admin", status: "active", created_at: null, updated_at: null, school_id: P(1), school_name: "Colegio Ficticio", cafeteria_id: P(3), cafeteria_name: "Cafetería Santiago", location_name: "Sede Santiago", registers: [] }] };
    const invite = { kind: "invitation", request_id: P(20), role_code: "pos_cashier", scope: "cafeteria", status: "pending", email: "cajera@example.invalid", username: "cajera.f", intended_display_name: "Jeanne Ficticia",
      cafeteria_id: P(3), school_name: "Colegio Ficticio", cafeteria_name: "Cafetería Santiago", created_at: null, expires_at: null, request_expired: false, identity_state: "missing", link_state: "none" };
    const render = async (status: string, caps: string[]) => {
      mocks.requirePlatform.mockResolvedValue({ ...session, capabilities: [...session.capabilities, "platform:customer:access:read", ...caps] });
      mocks.readPlatform.mockImplementation(async (_s: unknown, _c: unknown, rpc: string) => ({ kind: "ready", value: rpc === "platform_customer_access_read" ? { account_id: id, people: [person], pending: [invite] }
        : rpc === "platform_customer_lifecycle_history" ? { events: [] } : { ...customer, account: { ...customer.account, status }, schools: [school] } }));
      return renderToStaticMarkup(await open("personas", { persona: P(10) }));
    };
    // UX 15: one-step Personal POS (provision + identity support); link-based creation is retired, its recovery stays for pending invitations.
    const active = await render("active", ["platform:customer:access:provision", "platform:identity:support"]);
    expect(active).toMatch(/<button type="button" class="btn">Agregar personal POS<\/button>/); expect(active).not.toContain("Agregar personal de caja");
    expect(active).toContain("Código interno CLIENTE");
    for (const t of ["Agregar personal POS", "Dar acceso de administrador de cafetería", "Corregir nombre", "Generar enlace de activación", "Completar acceso", "Jeanne Ficticia", "Personal de caja · Cafetería Santiago", "Se habilita cuando la persona guarde su contraseña"]) expect(active).toContain(t);
    const provisionOnly = await render("active", ["platform:customer:access:provision"]);
    expect(provisionOnly).not.toContain("Agregar personal POS"); expect(provisionOnly).toContain("requiere también soporte de identidad"); expect(provisionOnly).toContain("Dar acceso de administrador de cafetería");
    const suspended = await render("suspended", ["platform:customer:access:provision", "platform:identity:support"]);
    expect(suspended).not.toContain("Agregar personal POS"); expect(suspended).not.toContain("Dar acceso de administrador de cafetería"); expect(suspended).toContain("Corregir nombre");
    for (const [status, caps] of [["closed", ["platform:customer:access:provision", "platform:identity:support"]], ["active", ["platform:customer:operations:manage", "platform:identity:support"]]] as const) {
      const html = await render(status, [...caps]);
      for (const t of ["Agregar personal POS", "Dar acceso de administrador de cafetería", "Corregir nombre", "Generar enlace de activación"]) expect(html).not.toContain(t);
    }
  });
  it("sandbox details do not expose customer-admin completion actions", async () => {
    mocks.readPlatform.mockResolvedValue({ kind: "ready", value: { ...customer, tenant_kind: "sandbox" } });
    const html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    expect(html).toContain("Sandbox · Demostración"); expect(html).not.toContain("Verificar identidad y completar acceso");
  });
  it("existing administrator prevents initial-admin provisioning UI", async () => {
    detail({ ...customer, administrators: [{ display_name: "Ana", status: "active", person_status: "active" }] });
    const html = renderToStaticMarkup(await open("personas"));
    expect(html).toContain("Ana"); expect(html).toContain("Administrador inicial · completado"); expect(html).not.toContain("Verificar identidad y completar acceso"); expect(html).not.toContain("Preparar administrador"); expect(html).not.toContain("Generar enlace de activación");
    expect(html).toContain("Solicitudes anteriores sin usar (1)"); expect(html).toContain("esta solicitud no es necesaria");
  });
  it("detail accepts a well-formed fixture account identifier and still rejects malformed ones", async () => {
    mocks.readPlatform.mockResolvedValue({ kind: "missing" });
    await CustomerPage({ params: Promise.resolve({ accountId: "00000000-0000-0000-0000-000000000001" }) });
    expect(mocks.readPlatform).toHaveBeenLastCalledWith(expect.anything(), "platform:tenant:lifecycle:read", "platform_get_customer_overview", { p_account_id: "00000000-0000-0000-0000-000000000001" }, expect.anything());
    mocks.readPlatform.mockClear();
    await CustomerPage({ params: Promise.resolve({ accountId: "not-an-id" }) });
    expect(mocks.readPlatform).not.toHaveBeenCalled();
  });
  it("Demo Lab keeps the real operator identity and shows the sandbox personas with Abrir como", async () => {
    const persona = (pov_code: string, display_name: string) => ({ persona_id: `4d600000-0000-4000-8000-0000000000${pov_code === "cashier" ? "23" : pov_code === "school_admin" ? "21" : "22"}`, pov_code, display_name, school_id: "df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488", cafeteria_id: "b9496342-5079-46ae-83b8-05c39bcbd7fe", cafeteria_name: "Cafetería Escolar", location_name: "Campus principal", membership_status: "active", valid: true, registers: pov_code === "cashier" ? ["Caja demo Horizonte"] : [] });
    const lab = { can_reset: true, active: null, sandboxes: [{ account_id: "03e71159-69e9-4387-9b3b-65799d49faf0", name: "Colegio Horizonte", code: "COLEGIO-HORIZONTE", status: "active", baseline: "horizonte-v1", school: { school_id: "df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488", name: "Colegio Horizonte", status: "active" },
      locations: [{ location_id: "cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4", name: "Campus principal", status: "active", cafeterias: [{ cafeteria_id: "b9496342-5079-46ae-83b8-05c39bcbd7fe", name: "Cafetería Escolar", status: "active", registers: [{ register_id: "4c000000-0000-4000-8000-000000000010", name: "Caja demo Horizonte", code: "HZ-01", status: "active" }], products: 6, staff: 1, purchases: 0, open_sessions: 0 }] }],
      students: 4, eligible_students: 4, personas: [persona("school_admin", "María Carey"), persona("cafeteria_admin", "Bruno Mars"), persona("cashier", "José Ramírez")], sandbox_staff: [], last_reset: null, last_entered: null }] };
    const rpc = vi.fn().mockResolvedValue({ data: lab, error: null });
    mocks.requirePlatform.mockResolvedValue({ ...session, supabase: { rpc } });
    const html = renderToStaticMarkup(await DemonstrationPage());
    expect(rpc).toHaveBeenCalledWith("platform_demo_lab_read");
    expect(html).toContain("Demo Lab"); expect(html).toContain("Sigues actuando como Operador"); expect(html).toContain("sin afectar operaciones reales");
    for (const label of ["María Carey", "Bruno Mars", "José Ramírez", "Abrir como José", "Restaurar escenario inicial", "Listo para demostrar"]) expect(html).toContain(label);
    expect(html).not.toContain("Próximamente");
  });
  it("lifecycle: status, history and only the valid actions for operators with the manage capability; none without it", async () => {
    mocks.requirePlatform.mockResolvedValue({ ...session, capabilities: [...session.capabilities, "platform:tenant:lifecycle:manage"] });
    detail({ ...customer, account: { ...customer.account, status: "suspended" } }, [{ occurred_at: "2026-10-19T15:00:00Z", action: "customer_suspended", from: "active", to: "suspended", reason: "Pago pendiente", actor_name: "Operador" }]);
    let html = renderToStaticMarkup(await open("estado"));
    expect(html).toContain("Estado del cliente"); expect(html).toContain("Suspendido"); expect(html).toContain("Cliente suspendido · Activo → Suspendido"); expect(html).toContain("Motivo: Pago pendiente");
    expect(html).toContain(">Reactivar<"); expect(html).toContain(">Cerrar cliente<"); expect(html).not.toContain(">Suspender<"); expect(html).not.toContain("Reabrir cliente");
    const personas = renderToStaticMarkup(await open("personas"));
    expect(personas).not.toContain("Verificar identidad y completar acceso"); expect(personas).toContain("no se preparan nuevos accesos");
    detail({ ...customer, account: { ...customer.account, status: "closed" } });
    html = renderToStaticMarkup(await open("estado"));
    expect(html).toContain("Cerrado"); expect(html).toContain(">Reabrir cliente<"); expect(html).not.toContain(">Reactivar<");
    mocks.requirePlatform.mockResolvedValue(session);
    html = renderToStaticMarkup(await open("estado"));
    expect(html).toContain("Estado del cliente"); expect(html).not.toContain(">Reabrir cliente<");
  });
  it("list shows lifecycle badges and offers the Cerrados filter", async () => {
    mocks.readPlatform.mockResolvedValue({ kind: "ready", value: { customers: [{ id, name: "Cliente cerrado", code: "CC", status: "closed", tenant_kind: "customer", school_count: 1, location_count: 1, cafeteria_count: 1 }], next_cursor: null } });
    const html = renderToStaticMarkup(await CustomersPage({ searchParams: Promise.resolve({ status: "closed" }) }));
    expect(html).toContain("Cliente cerrado"); expect(html).toContain(">Cerrado<"); expect(html).toContain('<option value="closed" selected="">Cerrados</option>');
    expect(mocks.readPlatform).toHaveBeenCalledWith(session, "platform:tenant:lifecycle:read", "platform_list_customers", expect.objectContaining({ p_status: "closed" }), expect.anything());
  });
  it("Agregar sede appears per active school only for active customers and operators with tenant provisioning", async () => {
    const withSchool = { ...customer, schools: [{ id, code: "ESC", name: "Escuela Ficticia", status: "active", business_timezone: "America/Santo_Domingo", locations: [{ id, code: "SEDE-1", name: "Sede Uno", status: "active", cafeterias: [{ id, code: "CAF-1", name: "Cafetería Uno", status: "active" }] }] }] };
    detail(withSchool);
    let html = renderToStaticMarkup(await open("estructura"));
    expect(html).toContain(">Agregar sede<"); expect(html).toContain("Sede Uno"); expect(html).toContain("Cafetería Uno");
    detail({ ...withSchool, account: { ...customer.account, status: "suspended" } });
    html = renderToStaticMarkup(await open("estructura")); expect(html).not.toContain("Agregar sede");
    detail({ ...withSchool, tenant_kind: "sandbox" });
    html = renderToStaticMarkup(await open("estructura")); expect(html).not.toContain("Agregar sede");
    mocks.requirePlatform.mockResolvedValue({ ...session, capabilities: session.capabilities.filter(c => c !== "platform:tenant:provision") }); detail(withSchool);
    html = renderToStaticMarkup(await open("estructura")); expect(html).not.toContain("Agregar sede");
  });
});
