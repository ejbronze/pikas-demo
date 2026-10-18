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
    mocks.readPlatform.mockImplementation(async (_session, _cap, rpc) => ({ kind: "ready", value: rpc === "platform_customer_activation_status" ? {intent_id:id,account_id:id,identity_state:"missing",link_state:"none",expires_at:null} : customer }));
    const html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    expect(html).toContain("Acceso preparado"); expect(html).toContain("Activación pendiente"); expect(html).toContain("No se envía correo"); expect(html).toContain("Verificar identidad y completar acceso"); expect(html).toContain("Generar enlace de activación");
    expect(html.replace(/<[^>]*>/g, "")).not.toContain(id);
  });
  it.each([['linked','Listo para completar'],['granted','Acceso completado']])('presents authoritative %s state without introducing invitation actions',async(status,label)=>{
    mocks.readPlatform.mockResolvedValue({kind:'ready',value:{...customer,administrator_intents:[{...customer.administrator_intents[0],status}]}});
    const html=renderToStaticMarkup(await CustomerPage({params:Promise.resolve({accountId:id})}));expect(html).toContain(label);expect(html).not.toContain('Crear enlace de invitación');
  });
  it("sandbox details do not expose customer-admin completion actions", async () => {
    mocks.readPlatform.mockResolvedValue({ kind: "ready", value: { ...customer, tenant_kind: "sandbox" } });
    const html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    expect(html).toContain("Sandbox · Demostración"); expect(html).not.toContain("Verificar identidad y completar acceso");
  });
  it("existing administrator prevents initial-admin provisioning UI", async () => {
    mocks.readPlatform.mockResolvedValue({ kind: "ready", value: { ...customer, administrators: [{ display_name: "Ana", status: "active", person_status: "active" }] } });
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
});
