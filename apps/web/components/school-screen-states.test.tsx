import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn(), wallet: vi.fn(), pages: vi.fn(), shares: vi.fn() }));
vi.mock("../lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc, from: (table: string) => ({ select: () => ({ eq: () => mocks.shares(table) }) }) }) }));
vi.mock("../lib/auth/school-access", () => ({ resolveSchoolAccess: mocks.access }));
vi.mock("../lib/wallet/access", () => ({ readSchoolWalletAccess: mocks.wallet }));
vi.mock("./connected-school-shell", () => ({ ConnectedSchoolShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("./connected-school-pages", () => ({ ConnectedSchoolPages: (props: unknown) => { mocks.pages(props); return <p>PAGES</p>; } }));
(globalThis as { React?: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { SchoolScreen } from "./school-screen";
import { schoolId as id } from "../lib/school/overview-fixtures";

// UX 14: the School screen tells apart invalid filters, a lost permission, a missing school, an
// unreadable response and a failed call. Empty data stays with the pages (EmptyState), never here.
const scope = { actor_id: id, membership_id: id, role: "school_admin", account_id: id, school_id: id, account_name: "Cuenta", school_name: "Colegio", tenant_kind: "customer" };
const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await SchoolScreen({ section: "students", searchParams: Promise.resolve({ school: id, ...params }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ status: "authorized", context: { person_id: id, schools: [{ school_id: id }] } }); mocks.wallet.mockResolvedValue({ read: false }); mocks.shares.mockResolvedValue({ data: [], error: null }); });

describe("School screen states", () => {
  it("invalid filters: a validation state with Restablecer filtros, no read and no Reintentar", async () => {
    const html = await render({ status: "borrado" });
    expect(html).toContain('data-kind="validation"'); expect(html).toContain("Los filtros no son válidos."); expect(html).toContain("Restablecer filtros"); expect(html).toContain(`href="/admin/escuela/estudiantes?school=${id}"`);
    expect(html).not.toContain("Reintentar"); expect(html).not.toContain('role="alert"'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("a 42501 from the read is a permission state (access changed), with a way back in and no retry", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "school_authority_required" } });
    const html = await render();
    expect(html).toContain('data-kind="permission"'); expect(html).toContain("Ya no tienes acceso a esta sección del colegio."); expect(html).toContain("Volver a iniciar sesión");
    expect(html).not.toContain("Reintentar"); expect(html).not.toContain("problema temporal"); expect(html).not.toContain("PAGES");
  });
  it("a missing school (P0002) is not found with a contextual return, never a loading failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "no_data_found" } });
    const html = await render();
    expect(html).toContain('data-kind="not_found"'); expect(html).toContain("No encontramos este colegio."); expect(html).toContain("Ir a mi colegio"); expect(html).not.toContain("Reintentar");
  });
  it("an unreadable response is named as such (not temporary by habit) and still allows a retry", async () => {
    mocks.rpc.mockResolvedValue({ data: { nonsense: true }, error: null });
    const html = await render();
    expect(html).toContain('data-kind="temporary"'); expect(html).toContain("No pudimos mostrar esta información."); expect(html).toContain("avisa a PIKAS"); expect(html).toContain("Reintentar");
  });
  it("a failed call is the temporary state with Reintentar; a response for another scope is an unreadable response, never a permission claim", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "serialization" } });
    expect(await render()).toContain("No pudimos cargar esta sección.");
    mocks.rpc.mockResolvedValue({ data: { scope: { ...scope, actor_id: "4d700000-0000-4000-8000-000000000999" }, locations: [], rows: [], counts: { students: 0, active: 0, suspended: 0, inactive: 0, cafeterias: 0 } }, error: null });
    const html = await render(); expect(html).toContain("No pudimos mostrar esta información."); expect(html).not.toContain('data-kind="permission"');
  });
  it("zero students is not an error: the read succeeds and the page receives the empty roster", async () => {
    mocks.rpc.mockResolvedValue({ data: { scope, locations: [], rows: [], counts: { students: 0, active: 0, suspended: 0, inactive: 0, cafeterias: 0 } }, error: null });
    const html = await render();
    expect(html).toContain("PAGES"); expect(html).not.toContain("data-kind="); expect(mocks.pages).toHaveBeenCalled();
  });
});
