import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), access: vi.fn(), wallet: vi.fn(), workspace: vi.fn(), redirect: vi.fn((u: string) => { throw Object.assign(new Error("redirect"), { url: u }); }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../../../../lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("../../../../../lib/auth/school-access", () => ({ resolveSchoolAccess: mocks.access }));
vi.mock("../../../../../lib/wallet/access", () => ({ readSchoolWalletAccess: mocks.wallet }));
vi.mock("../../../../../components/connected-school-shell", () => ({ ConnectedSchoolShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../../../../../components/student-workspace", () => ({ StudentWorkspace: (props: unknown) => { mocks.workspace(props); return null; } }));
(globalThis as { React?: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import Page from "./page";

const school = "4d600000-0000-4000-8000-000000000001", sid = "4d600000-0000-4000-8000-000000000101", other = "4d600000-0000-4000-8000-0000000000ff";
const scope = (role = "school_admin", school_id = school) => ({ actor_id: school, membership_id: school, role, account_id: school, school_id, account_name: "Cuenta", school_name: "Colegio", tenant_kind: "customer" });
const st = { id: sid, first_name: "Ana", last_name: "Ficticia", display_name: "Ana Ficticia", student_code: "EST-1", status: "active", enrollment: null };
const cafe = { id: "4d600000-0000-4000-8000-0000000000c1", name: "Cafetería Santiago", location: "Sede", status: "active", sharing_status: "active", categories: [], customer_count: 5, customers: [{ student_id: sid, display_name: "Otro Estudiante Privado", status: "active" }] };
// Chainable, thenable stand-in for supabase.from(...).select().eq()... that records the filters.
const tables: Record<string, unknown[]> = {}, filters: Record<string, [string, unknown][]> = {};
const builder = (table: string) => { filters[table] = []; const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) b[m] = (...a: unknown[]) => { if (m === "eq") filters[table].push([a[0] as string, a[1]]); return b; };
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok); return b; };
const reads = (role = "school_admin", rosterScope = scope(role)) => mocks.rpc.mockImplementation(async (rpc: string) => ({ error: null, data:
  rpc === "school_student_roster" ? { scope: rosterScope, locations: [], rows: [st], grades: [], next_cursor: null }
  : rpc === "school_wallet_read" ? { school_id: school, student_id: sid, student_name: "Ana", wallet: { id: sid, status: "active", currency: "DOP", balance_minor: "15000", version: "3" },
    movements: [{ type: "purchase", amount_minor: "-6500", cafeteria: "Cafetería Santiago", receipt_number: "77", items: [{ name: "Empanada", quantity: 1, line_total_minor: "6500" }] }], next_before: null }
  : { scope: scope(role), locations: [], rows: [cafe] } }));
const run = async () => { renderToStaticMarkup(await Page({ params: Promise.resolve({ studentId: sid }), searchParams: Promise.resolve({ school }) })); return mocks.workspace.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined; };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ status: "authorized", context: { person_id: school, schools: [{ school_id: school }] } }); mocks.from.mockImplementation(builder);
  tables.cafeteria_customers = [{ cafeteria_id: cafe.id, status: "active" }]; tables.student_dietary_restrictions = [{ restriction_type: "allergen", display_label: "Maní", starts_on: "2026-08-01", ends_on: null }]; reads(); });

describe("Student workspace server reads", () => {
  it("finds exactly this student through the roster keyset, scoped to the school", async () => {
    mocks.wallet.mockResolvedValue({ read: true }); await run();
    expect(mocks.rpc).toHaveBeenCalledWith("school_student_roster", expect.objectContaining({ p_school_id: school, p_after: "4d600000-0000-4000-8000-000000000100", p_limit: 1, p_query: "", p_status: "" }));
    expect(filters.cafeteria_customers).toEqual([["school_id", school], ["student_id", sid], ["status", "active"]]);
  });
  it("passes only reduced data: wallet state and balance, service names, restriction labels; no purchases or other students", async () => {
    mocks.wallet.mockResolvedValue({ read: true });
    const props = await run(), json = JSON.stringify(props);
    expect((props!.inputs as { wallet: unknown }).wallet).toEqual({ status: "active", balance_minor: "15000" });
    expect((props!.inputs as { service: unknown }).service).toEqual([{ name: "Cafetería Santiago", location: "Sede", serving: true }]);
    expect((props!.inputs as { restrictions: unknown }).restrictions).toEqual([{ kind: "allergen", label: "Maní", until: null }]);
    expect(json).not.toMatch(/Empanada|6500|receipt|movements|Otro Estudiante Privado|customer_count|grades/);
  });
  it("without wallet authority the wallet read is never made", async () => {
    mocks.wallet.mockResolvedValue({ read: false });
    const props = await run();
    expect(mocks.rpc.mock.calls.map(c => c[0])).not.toContain("school_wallet_read"); expect(props!.walletRead).toBe(false); expect((props!.inputs as { wallet: unknown }).wallet).toBeUndefined();
  });
  it("restrictions are read only for the School Admin role", async () => {
    mocks.wallet.mockResolvedValue({ read: false }); reads("account_admin");
    const props = await run();
    expect(mocks.from.mock.calls.map(c => c[0])).not.toContain("student_dietary_restrictions"); expect((props!.inputs as { restrictions: unknown }).restrictions).toBeNull();
  });
  it("another school's or another student's row is never shown", async () => {
    mocks.wallet.mockResolvedValue({ read: false }); reads("school_admin", scope("school_admin", other));
    expect(await run()).toBeUndefined();
    mocks.rpc.mockImplementation(async (rpc: string) => ({ error: null, data: rpc === "school_student_roster" ? { scope: scope(), locations: [], rows: [{ ...st, id: other }] } : null }));
    expect(await run()).toBeUndefined();
  });
  it("an unknown school redirects back to the roster", async () => {
    mocks.access.mockResolvedValue({ status: "authorized", context: { person_id: school, schools: [{ school_id: other }] } });
    await expect(Page({ params: Promise.resolve({ studentId: sid }), searchParams: Promise.resolve({ school }) })).rejects.toMatchObject({ url: "/admin/escuela/estudiantes" });
  });
});
