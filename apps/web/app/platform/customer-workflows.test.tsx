import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ReactModule from "react";
const mocks = vi.hoisted(() => ({ slots: [] as unknown[], refs: [] as { current: unknown }[], cursor: { state: 0, ref: 0 }, refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => { const index = mocks.cursor.state++; if (!(index in mocks.slots)) mocks.slots[index] = initial;
    return [mocks.slots[index], (value: unknown) => { mocks.slots[index] = typeof value === "function" ? value(mocks.slots[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = mocks.cursor.ref++; return mocks.refs[index] ??= { current: initial }; },
  // The wizard's draft/journal detection effect runs only in the browser.
  useEffect: () => {},
}));
(globalThis as { React?: unknown }).React = ReactModule;
import { CustomerWizard } from "./clientes/nuevo/customer-wizard";
import { AdministratorAction } from "./clientes/[accountId]/administrator-action";
const id = "00000000-0000-4000-8000-000000000001";
const tenant = { account_id: id, school_id: id, location_id: id, cafeteria_id: id, school_code: "COL-0A1B2C3D4E" };
const draft = { schoolName: "Colegio Ficticio", taxId: "101234567", addressLine: "Calle Ficticia 1", countryCode: "DO", provinceCode: "DO-01", administratorName: "Administradora", administratorEmail: "admin@example.invalid", administratorUsername: "admin.ficticia" };
type El = { type?: unknown; props?: { children?: unknown; [key: string]: unknown } };
function render(component: () => unknown) { mocks.cursor.state = 0; mocks.cursor.ref = 0; return component(); }
function find(node: unknown, label: string): El | null {
  if (!node || typeof node !== "object") return null;
  const el = node as El;
  if (el.type === "button" && el.props?.children === label) return el;
  const children = el.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) { const match = find(child, label); if (match) return match; }
  return null;
}
function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join(" ");
  return node && typeof node === "object" ? text((node as El).props?.children) : "";
}
// Every string/number reachable through element props (shallow render: component props are not rendered).
function deep(node: unknown, seen = new Set<unknown>()): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object" || seen.has(node)) return "";
  seen.add(node);
  if (Array.isArray(node)) return node.map(n => deep(n, seen)).join(" ");
  const props = (node as El).props; return props ? Object.values(props).map(v => deep(v, seen)).join(" ") : "";
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.slots.length = 0; mocks.refs.length = 0;
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } });
});
const wizard = () => CustomerWizard({ actor: "operator" });
async function create() { mocks.slots[0] = draft; mocks.slots[1] = true; const button = find(render(wizard), "Agregar colegio")!; await (button.props!.onClick as () => Promise<void>)(); }
describe("Agregar colegio and administrator workflow UI", () => {
  it("form shows locked República Dominicana, a canonical province selector and no school-code field", () => {
    const all = deep(render(wizard));
    expect(all).toContain("País"); expect(all).toContain("República Dominicana"); expect(all).toContain("Por ahora PIKAS opera en República Dominicana.");
    expect(all).toContain("Provincia"); expect(all).toContain("Distrito Nacional"); expect(all).toContain("DO-32");
    expect(all).not.toMatch(/Código del colegio|Código de la escuela|Código del cliente|Zona horaria/); expect(all).toContain("PIKAS genera el código del colegio");
    expect(all).toContain("Administrador del colegio"); expect(all).not.toMatch(/Crear estudiante|Agregar padre/);
  });
  it("does not show success after rejected provisioning", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 })); await create();
    const content = text(render(wizard)); expect(content).toContain("Tu sesión no permite"); expect(content).not.toContain("Colegio agregado");
  });
  it("shows authoritative success and honest pending identity without invitation success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ result: tenant }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ result: { intent_id: id, status: "pending" } }) }));
    await create(); const content = text(render(wizard)); expect(content).toContain("Colegio agregado"); expect(deep(render(wizard))).toContain("COL-0A1B2C3D4E"); expect(content).toContain("No se ha enviado una invitación ni otorgado acceso"); expect(content).toContain("Ver colegio y completar administrador");
  });
  it("partial failure distinguishes the created colegio from its unprepared administrator", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ result: tenant }) }).mockRejectedValueOnce(new Error("network")));
    await create(); const content = text(render(wizard)); expect(content).toContain("Colegio registrado"); expect(content).toContain("El colegio ya existe"); expect(content).not.toContain("Colegio agregado");
  });
  it("completion cannot display access granted on an uncertain response", async () => {
    mocks.slots[0] = "Administradora"; const fetch = vi.fn().mockRejectedValue(new Error("network")); vi.stubGlobal("fetch", fetch);
    const component = () => AdministratorAction({ actor: "operator", accountId: id, intentId: id });
    const form = render(component) as El; (form.props!.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await vi.waitFor(() => expect(mocks.slots[2]).toBe(false));
    expect(text(render(component))).not.toContain("Acceso de administrador otorgado"); expect(text(render(component))).toContain("No pudimos confirmar"); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("completion recovery uses the persisted key/body after reload without an entered name", async () => {
    const storageKey = `pikas:initial-admin:v1:operator:${id}`;
    sessionStorage.setItem(storageKey, JSON.stringify({ key: id, body: { intentId: id, displayName: "Administradora" } }));
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: { intent_id: id, membership_id: id, person_id: id, role_code: "account_admin", scope_kind: "account", status: "granted" } }) }); vi.stubGlobal("fetch", fetch);
    const component = () => AdministratorAction({ actor: "operator", accountId: id, intentId: id });
    const button = find(render(component), "Recuperar solicitud pendiente")!; (button.props!.onClick as () => void)();
    await vi.waitFor(() => expect(mocks.slots[4]).toBe(true));
    expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe(id); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ intentId: id, displayName: "Administradora" }); expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
