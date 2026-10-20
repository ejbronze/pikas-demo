import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requirePlatform: vi.fn(), readPlatform: vi.fn(), launcher: vi.fn() }));
vi.mock("@/lib/platform/customer-console", () => ({ requirePlatform: mocks.requirePlatform, readPlatform: mocks.readPlatform }));
vi.mock("@/lib/platform/sandbox-launcher", async () => ({ ...(await import("../../lib/platform/sandbox-launcher")), loadSandboxLauncherState: mocks.launcher }));
// No vitest alias config: resolve the Demo workspace component to its real implementation.
vi.mock("@/components/demo-workspace", async () => await import("../../components/demo-workspace"));
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
    const html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    expect(html).toContain("Acceso preparado"); expect(html).toContain("Activación pendiente"); expect(html).toContain("No se envía correo"); expect(html).toContain("Verificar identidad y completar acceso"); expect(html).toContain("Generar enlace de activación");
    expect(html.replace(/<[^>]*>/g, "")).not.toContain(id);
  });
  it.each([['linked','Listo para completar'],['granted','Acceso completado']])('presents authoritative %s state without introducing invitation actions',async(status,label)=>{
    detail({...customer,administrator_intents:[{...customer.administrator_intents[0],status}]});
    const html=renderToStaticMarkup(await CustomerPage({params:Promise.resolve({accountId:id})}));expect(html).toContain(label);expect(html).not.toContain('Crear enlace de invitación');
  });
  it("Información del colegio shows the persisted profile read-only and never fabricates missing values", async () => {
    const school = (over: Record<string, unknown>) => ({ id: "00000000-0000-4000-8000-0000000000b1", name: "Colegio Ficticio Atlántico", code: "COL-0A1B2C3D4E", status: "active", business_timezone: "America/Santo_Domingo", locations: [], ...over });
    detail({ ...customer, schools: [school({ rnc: "131987654", address: "Av. Ficticia 12", country: "DO", province: "DO-25", province_name: "Santiago" })] });
    let html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    const profile = html.slice(html.indexOf('id="colegio-profile"'), html.indexOf("</section>", html.indexOf('id="colegio-profile"')));
    expect(profile).toContain("Información del colegio");
    for (const [label, value] of [["Nombre", "Colegio Ficticio Atlántico"], ["RNC", "131987654"], ["Dirección", "Av. Ficticia 12"], ["País", "República Dominicana"], ["Provincia", "Santiago"], ["Código del colegio", "COL-0A1B2C3D4E"]])
      expect(profile).toMatch(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>${value}</dd>`));
    expect(profile).not.toMatch(/>DO</); expect(profile).not.toContain("DO-25"); expect(profile).not.toContain("account_admin");
    expect(profile).not.toMatch(/<(input|select|textarea|button|form)\b/); expect(profile).not.toMatch(/Editar|Guardar/);
    // A colegio provisioned before Agregar colegio: no profile fields, or explicit nulls.
    for (const legacy of [school({}), school({ rnc: null, address: null, country: null, province: null, province_name: null })]) {
      detail({ ...customer, schools: [legacy] });
      html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
      expect(html.match(/No registrado/g)).toHaveLength(4); expect(html).toContain("COL-0A1B2C3D4E"); expect(html).toContain("Acceso preparado"); expect(html).toContain("Estructura del cliente");
    }
    detail(customer); html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    expect(html).not.toContain("Información del colegio"); expect(html).toContain("No hay escuelas registradas.");
  });
  it("profile editing: Editar información and Renombrar only with the profile capability, for active or suspended customers", async () => {
    const school = { id: "00000000-0000-4000-8000-0000000000b1", name: "Colegio Ficticio", code: "COL-0A1B2C3D4E", status: "active", business_timezone: "America/Santo_Domingo", rnc: null, address: null, country: null, province: null, province_name: null,
      locations: [{ id: "00000000-0000-4000-8000-0000000000c1", name: "Sede principal", code: "SEDE-PRINCIPAL", status: "active", cafeterias: [{ id: "00000000-0000-4000-8000-0000000000d1", name: "Cafetería principal", code: "CAF-PRINCIPAL", status: "active" }] }] };
    const render = async (status: string, caps: string[], kind = "customer") => { mocks.requirePlatform.mockResolvedValue({ ...session, capabilities: [...session.capabilities, ...caps] });
      detail({ ...customer, tenant_kind: kind, account: { ...customer.account, status }, schools: [school] }); return renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) })); };
    const profile = ["platform:customer:profile:manage"];
    for (const status of ["active", "suspended"]) {
      const html = await render(status, profile);
      expect(html).toContain("Editar información"); expect(html).toContain('aria-label="Renombrar sede Sede principal"'); expect(html).toContain('aria-label="Renombrar cafetería Cafetería principal"');
    }
    for (const [status, caps, kind] of [["closed", profile, "customer"], ["active", ["platform:customer:operations:manage", "platform:tenant:lifecycle:manage"], "customer"], ["active", profile, "sandbox"]] as const) {
      const html = await render(status, [...caps], kind); expect(html).not.toContain("Editar información"); expect(html).not.toContain("Renombrar");
    }
  });
  it("sandbox details do not expose customer-admin completion actions", async () => {
    mocks.readPlatform.mockResolvedValue({ kind: "ready", value: { ...customer, tenant_kind: "sandbox" } });
    const html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    expect(html).toContain("Sandbox · Demostración"); expect(html).not.toContain("Verificar identidad y completar acceso");
  });
  it("existing administrator prevents initial-admin provisioning UI", async () => {
    detail({ ...customer, administrators: [{ display_name: "Ana", status: "active", person_status: "active" }] });
    const html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    expect(html).toContain("Ana"); expect(html).not.toContain("Verificar identidad y completar acceso"); expect(html).not.toContain("Preparar administrador");
  });
  it("detail accepts a well-formed fixture account identifier and still rejects malformed ones", async () => {
    mocks.readPlatform.mockResolvedValue({ kind: "missing" });
    await CustomerPage({ params: Promise.resolve({ accountId: "00000000-0000-0000-0000-000000000001" }) });
    expect(mocks.readPlatform).toHaveBeenLastCalledWith(expect.anything(), "platform:tenant:lifecycle:read", "platform_get_customer_overview", { p_account_id: "00000000-0000-0000-0000-000000000001" }, expect.anything());
    mocks.readPlatform.mockClear();
    await CustomerPage({ params: Promise.resolve({ accountId: "not-an-id" }) });
    expect(mocks.readPlatform).not.toHaveBeenCalled();
  });
  it("Demo workspace keeps the real operator identity and the Foundation B experiences", async () => {
    const target = { account_id: "03e71159-69e9-4387-9b3b-65799d49faf0", account_name: "Colegio Horizonte", cafeteria_id: "b9496342-5079-46ae-83b8-05c39bcbd7fe", cafeteria_name: "Cafetería Escolar", school_id: "df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488", persona_display_name: "José Ramírez" };
    const rpc = vi.fn().mockResolvedValue({ data: ["cashier", "school_admin", "cafeteria_admin"].map(pov_code => ({ ...target, pov_code })), error: null });
    mocks.requirePlatform.mockResolvedValue({ ...session, supabase: { rpc } });
    mocks.launcher.mockResolvedValue({ kind: "targets", targets: [] });
    const html = renderToStaticMarkup(await DemonstrationPage());
    expect(html).toContain("Explorar PIKAS"); expect(html).toContain("Sigues actuando como Operador");
    for (const label of ["Administración", "Operaciones", "Caja / POS", "Próximamente"]) expect(html).toContain(label);
    expect(mocks.launcher).toHaveBeenCalledWith({ rpc }, session.identity);
  });
  it("lifecycle: status, history and only the valid actions for operators with the manage capability; none without it", async () => {
    mocks.requirePlatform.mockResolvedValue({ ...session, capabilities: [...session.capabilities, "platform:tenant:lifecycle:manage"] });
    detail({ ...customer, account: { ...customer.account, status: "suspended" } }, [{ occurred_at: "2026-10-19T15:00:00Z", action: "customer_suspended", from: "active", to: "suspended", reason: "Pago pendiente", actor_name: "Operador" }]);
    let html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    expect(html).toContain("Estado del cliente"); expect(html).toContain("Suspendido"); expect(html).toContain("Cliente suspendido · Activo → Suspendido"); expect(html).toContain("Motivo: Pago pendiente");
    expect(html).toContain(">Reactivar<"); expect(html).toContain(">Cerrar cliente<"); expect(html).not.toContain(">Suspender<"); expect(html).not.toContain("Reabrir cliente");
    expect(html).not.toContain("Verificar identidad y completar acceso"); expect(html).toContain("no se preparan nuevos accesos");
    detail({ ...customer, account: { ...customer.account, status: "closed" } });
    html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    expect(html).toContain("Cerrado"); expect(html).toContain(">Reabrir cliente<"); expect(html).not.toContain(">Reactivar<");
    mocks.requirePlatform.mockResolvedValue(session);
    html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
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
    let html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    expect(html).toContain(">Agregar sede<"); expect(html).toContain("Sede Uno"); expect(html).toContain("Cafetería Uno");
    detail({ ...withSchool, account: { ...customer.account, status: "suspended" } });
    html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) })); expect(html).not.toContain("Agregar sede");
    detail({ ...withSchool, tenant_kind: "sandbox" });
    html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) })); expect(html).not.toContain("Agregar sede");
    mocks.requirePlatform.mockResolvedValue({ ...session, capabilities: session.capabilities.filter(c => c !== "platform:tenant:provision") }); detail(withSchool);
    html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) })); expect(html).not.toContain("Agregar sede");
  });
});
