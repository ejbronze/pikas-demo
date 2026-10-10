import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requirePlatform: vi.fn(), readPlatform: vi.fn(), launcher: vi.fn() }));
vi.mock("@/lib/platform/customer-console", () => ({ requirePlatform: mocks.requirePlatform, readPlatform: mocks.readPlatform }));
vi.mock("@/lib/platform/sandbox-launcher", () => ({ loadSandboxLauncherState: mocks.launcher }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
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
    mocks.readPlatform.mockResolvedValue({ kind: "ready", value: customer });
    const html = renderToStaticMarkup(await CustomerPage({ params: Promise.resolve({ accountId: id }) }));
    expect(html).toContain("Identidad pendiente"); expect(html).toContain("No enviamos invitaciones"); expect(html).toContain("Verificar identidad y completar acceso");
    expect(html.replace(/<[^>]*>/g, "")).not.toContain(id);
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
  it("demonstration preserves the existing launcher and real identity", async () => {
    mocks.launcher.mockResolvedValue({ kind: "active", active: { personaName: "José Ramírez", accountName: "Colegio Horizonte", cafeteriaName: "Cafetería Escolar", canOpenPos: true } });
    const html = renderToStaticMarkup(await DemonstrationPage()); expect(html).toContain('href="/pos"'); expect(html).toContain("José Ramírez"); expect(mocks.launcher).toHaveBeenCalledWith(session.supabase, session.identity);
  });
});
