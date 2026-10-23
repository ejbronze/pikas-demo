import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requirePlatform: vi.fn(), readPlatform: vi.fn() }));
vi.mock("@/lib/platform/customer-console", () => ({ requirePlatform: mocks.requirePlatform, readPlatform: mocks.readPlatform }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => "/platform/clientes", redirect: (href: string) => { throw new Error(`redirect:${href}`); } }));
vi.mock("../../components/connected-cafeteria-provider", () => ({ ConnectedCafeteriaProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="support-cafeteria-provider">{children}</div> }));
vi.mock("../../components/connected-cafeteria-pages", () => ({ SupportCafeteriaManagement: ({ section }: { section: string }) => <div>Editor de soporte: {section}</div> }));
(globalThis as { React?: typeof React }).React = React;
import ManagementPage from "./clientes/[accountId]/gestion/page";
import CafeteriaPage from "./clientes/[accountId]/gestion/cafeterias/[cafeteriaId]/page";
import CustomerPage from "./clientes/[accountId]/page";

const A = "7b000000-0000-4000-8000-0000000000a1", C1 = "7b000000-0000-4000-8000-0000000000c1", C2 = "7b000000-0000-4000-8000-0000000000c2", OP = "7b000000-0000-4000-8000-0000000000f1";
const caps = ["platform:tenant:lifecycle:read", "platform:customer:operations:read"];
const session = (c = caps) => ({ identity: { user: { id: "op" }, person: { displayName: "Operador" } }, supabase: {}, capabilities: c });
const overview = { account: { id: A, name: "Colegio Ficticio Dos Sedes", code: "CF2", status: "active" }, schools: [{ id: A, name: "Colegio Ficticio", status: "active", locations: [
  { id: C1, name: "Sede Norte", status: "active", cafeterias: [{ id: C1, name: "Cafetería Norte", code: "CN", status: "active" }] },
  { id: C2, name: "Sede Sur", status: "active", cafeterias: [{ id: C2, name: "Cafetería Sur", code: "CS", status: "active" }] }] }] };
const read = (status = "active") => ({ scope: { cafeteria_id: C1, cafeteria_name: "Cafetería Norte", cafeteria_status: "active", account_id: A, account_name: "Colegio Ficticio Dos Sedes", account_status: status,
  school_name: "Colegio Ficticio", location_name: "Sede Norte", tenant_kind: "customer", actor_id: OP, membership_id: null, capabilities: [], support: true },
  settings: { currency: "DOP", scheduling_enabled: false, version: 1 }, categories: [{ id: C1, name: "Comida", status: "active", display_order: 1, version: 1 }],
  products: [{ id: C2, name: "Empanada ficticia", description: "", unit: "Unidad", category_id: C1, price_minor: 8000, active: true, available: false, ingredients: ["Harina"], allergens: [], version: 1 }],
  menus: [], shifts: [], registers: [{ id: A, code: "R1", name: "Caja Norte", status: "active", version: 1, has_history: true, open: true }],
  staff: [{ id: OP, name: "Cajera Ficticia", role: "pos_cashier", status: "active", open: true }], assignments: [{ id: C2, membership_id: OP, register_id: A, status: "active", version: 1 }],
  invitations: [], service: null });
const html = async (node: Promise<React.ReactElement>) => renderToStaticMarkup(await node);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const reads = (over: Record<string, unknown> = {}) => mocks.readPlatform.mockImplementation(async (_s: unknown, _c: unknown, rpc: string) => ({ kind: "ready", value: rpc === "platform_customer_operations_overview" ? overview : rpc === "platform_support_cafeteria_read" ? (over.read ?? read()) : over.detail }));
const cafeteria = (seccion?: string) => CafeteriaPage({ params: Promise.resolve({ accountId: A, cafeteriaId: C1 }), searchParams: Promise.resolve(seccion ? { seccion } : {}) });

beforeEach(() => { vi.clearAllMocks(); mocks.requirePlatform.mockResolvedValue(session()); reads(); });

describe("Backoffice Customer Management (M1)", () => {
  it("UX 15: the customer's Operación section is the one entry to management; the old gestión landing redirects there", async () => {
    await expect(ManagementPage({ params: Promise.resolve({ accountId: A }) })).rejects.toThrow(`redirect:/platform/clientes/${A}?seccion=operacion`);
    mocks.readPlatform.mockImplementation(async (_s: unknown, _c: unknown, rpc: string) => ({ kind: "ready", value: rpc === "platform_customer_lifecycle_history" ? { events: [] } : rpc === "platform_customer_readiness" ? { customers: [], sandbox: [], truncated: false } : { account: { id: A, name: "Colegio", code: "C", status: "active" }, tenant_kind: "customer", schools: [], administrators: [], customer_admin_onboarding: [], administrator_intents: [] } }));
    const ops = await html(CustomerPage({ params: Promise.resolve({ accountId: A }), searchParams: Promise.resolve({ seccion: "operacion" }) }));
    expect(ops).toContain('id="operacion"'); expect(ops).toContain("no como usuario del cliente"); expect(ops).not.toContain(`href="/platform/clientes/${A}/gestion"`); expect(ops).not.toContain("Administrar operación");
    mocks.requirePlatform.mockResolvedValue(session(["platform:tenant:lifecycle:read"]));
    const noOps = await html(CustomerPage({ params: Promise.resolve({ accountId: A }), searchParams: Promise.resolve({ seccion: "operacion" }) }));
    expect(noOps).not.toContain('id="operacion"'); expect(noOps).not.toContain("Administrar cliente");
  });
  it("cafetería management shows truthful support context, the hierarchy trail and the way back, never school roster management", async () => {
    const h = await html(cafeteria()), t = text(h);
    expect(t).toContain("Gestionando Colegio Ficticio Dos Sedes"); expect(t).toContain("Estás gestionando el contexto del cliente como personal de PIKAS.");
    expect(t).not.toMatch(/Actuando como|Vista de administrador|impersonar/i);
    expect(h).not.toContain("/gestion/escuelas/"); expect(t).not.toMatch(/Gestionar escuela|Crear estudiante|Importar estudiantes|Agregar padre|Agregar personal/i);
    // UX 15: Cliente → Colegio → Sede → Cafetería → area, inherited levels as text; the customer link returns to Operación.
    expect(h).toContain('aria-label="Ubicación en la estructura"'); expect(t).toMatch(/Cliente\s+Colegio Ficticio Dos Sedes.*Colegio\s+Colegio Ficticio.*Sede\s+Sede Norte.*Cafetería\s+Cafetería Norte.*Resumen/);
    expect(h).toContain(`href="/platform/clientes/${A}?seccion=operacion"`); expect(h).not.toContain(`href="/platform/clientes/${A}/gestion"`);
    expect(h).toContain(`href="/platform/clientes/${A}/gestion/cafeterias/${C2}`); expect((h.match(/<h1/g) ?? []).length).toBe(1);
    expect(mocks.readPlatform).toHaveBeenCalledWith(expect.anything(), "platform:customer:operations:read", "platform_customer_operations_overview", { p_account_id: A }, expect.anything());
  });
  it("active managers receive bounded catalog controls while read-only and suspended contexts do not", async () => {
    mocks.requirePlatform.mockResolvedValue(session([...caps, "platform:customer:operations:manage"]));
    let h = await html(cafeteria("productos"));
    expect(text(h)).toContain("Puedes realizar únicamente la configuración no financiera permitida.");
    expect(text(h)).toContain("Editor de soporte: products");
    expect(h).toContain("seccion=menus"); expect(h).toContain("seccion=turnos"); expect(h).toContain("seccion=configuracion");
    reads({ read: read("suspended") });
    h = await html(cafeteria("productos"));
    expect(text(h)).not.toContain("Editor de soporte"); expect(text(h)).toContain("Solo consulta");
  });
  it("unauthorized Platform operator is denied before any read", async () => {
    mocks.requirePlatform.mockResolvedValue(session(["platform:tenant:lifecycle:read"]));
    expect(text(await html(cafeteria()))).toContain("No tienes permiso");
    expect(mocks.readPlatform).not.toHaveBeenCalled();
  });
  it("a cafeteria outside the account (scope refusal) shows the same not-found message and no data", async () => {
    mocks.readPlatform.mockImplementation(async (_s: unknown, _c: unknown, rpc: string) => rpc === "platform_support_cafeteria_read" ? { kind: "forbidden" } : { kind: "ready", value: overview });
    const t = text(await html(cafeteria()));
    expect(t).toContain("No encontramos esta cafetería para este cliente."); expect(t).not.toContain("Cafetería Norte"); expect(t).not.toContain("RD$");
    expect(text(await html(CafeteriaPage({ params: Promise.resolve({ accountId: "nope", cafeteriaId: C1 }), searchParams: Promise.resolve({}) })))).toContain("No encontramos esta cafetería");
  });
  it("cafeteria switcher and section navigation keep the explicit account", async () => {
    const h = await html(cafeteria("productos"));
    expect(h).toMatch(/aria-current="true"[^>]*>.*Cafetería Norte/); expect(h).toContain(`href="/platform/clientes/${A}/gestion/cafeterias/${C2}?seccion=productos"`);
    expect(h).toMatch(/aria-current="page"[^>]*>Productos</);
  });
  it.each(["resumen", "productos", "cajas", "personal"])("%s is read-only: no forms, inputs or action buttons", async (seccion) => {
    const h = await html(cafeteria(seccion));
    const main = h.slice(h.indexOf('aria-label="Secciones de la cafetería"'));
    expect(main).not.toMatch(/<(form|input|select|textarea)\b/); expect(main.slice(main.indexOf("</nav>"))).not.toMatch(/<button\b/);
    expect(text(main)).not.toMatch(/Editar|Crear|Guardar|Importar|Agregar|Cerrar caja|Reembolsar|Recargar|Ajustar|Revertir|Preparar acceso/);
    expect((h.match(/<h1/g) ?? []).length).toBe(1);
  });
  it("sections show the operational data", async () => {
    expect(text(await html(cafeteria("productos")))).toMatch(/Comida.*Empanada ficticia.*RD\$ 80\.00.*Agotado/);
    expect(text(await html(cafeteria("cajas")))).toMatch(/Caja Norte.*Sesión abierta.*Cajera Ficticia/);
    expect(text(await html(cafeteria("personal")))).toMatch(/Cajera Ficticia.*Cajero.*Caja Norte/);
    const r = text(await html(cafeteria()));
    expect(r).toMatch(/Productos\s*1\s*0 disponibles/); expect(r).toContain("Venta por horario: Desactivada");
  });
  it("transactions and reports use the Platform read endpoints (read-only components)", async () => {
    const tx = await html(cafeteria("transacciones")); expect(text(tx)).toContain("Transacciones"); expect(tx).not.toMatch(/Reembolsar|Anular/);
    const rp = await html(cafeteria("reportes")); expect(text(rp)).toContain("Reportes");
  });
  it("suspended and closed customers remain readable with a clear notice", async () => {
    reads({ read: read("suspended") }); expect(text(await html(cafeteria()))).toContain("Cliente suspendido: su personal no tiene acceso.");
    reads({ read: read("closed") }); expect(text(await html(cafeteria()))).toContain("Cliente cerrado: solo consulta histórica.");
  });
});
