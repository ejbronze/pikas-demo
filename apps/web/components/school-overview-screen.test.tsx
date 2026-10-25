import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn(), wallet: vi.fn(), pages: vi.fn(), shares: vi.fn() }));
// UX 13: the School's own sharing rows come from school_sharing_rows (same authority as the cafeterías read, Demo POV
// included); the mock answers it through `shares`. No direct table read exists: `from` is absent.
vi.mock("../lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: (name: string, args: unknown) => name === "school_sharing_rows" ? mocks.shares(name, args) : mocks.rpc(name, args) }) }));
vi.mock("../lib/auth/school-access", () => ({ resolveSchoolAccess: mocks.access }));
vi.mock("../lib/wallet/access", () => ({ readSchoolWalletAccess: mocks.wallet }));
vi.mock("./connected-school-shell", () => ({ ConnectedSchoolShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("./connected-school-pages", () => ({ ConnectedSchoolPages: (props: unknown) => { mocks.pages(props); return null; } }));
(globalThis as { React?: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { SchoolScreen } from "./school-screen";
import { schoolId as id } from "../lib/school/overview-fixtures";

const scope = { actor_id: id, membership_id: id, role: "school_admin", account_id: id, school_id: id, account_name: "Cuenta", school_name: "Colegio", tenant_kind: "customer" };
const cafeteria = { id: "4d700000-0000-4000-8000-000000000101", name: "Cafetería Ficticia", location: "Sede", status: "active", sharing_status: "active", categories: [], customer_count: 2,
  customers: [{ student_id: "4d700000-0000-4000-8000-000000000201", display_name: "Estudiante Privada Ficticia", status: "active" }] };
const report = { school_id: id, tenant_kind: "customer", business_timezone: "America/Santo_Domingo", currency_code: "DOP", period: "last_7_days", from: "2026-10-15", to: "2026-10-21", today: "2026-10-21", as_of: "x",
  current: { total_balance_minor: "5000", wallet_count: 1, active_wallet_count: 1, frozen_wallet_count: 0, negative_wallet_count: 0, negative_balance_minor: "0" },
  movements: { replenishments: { amount_minor: "0", count: 0 }, reversals: { amount_minor: "0", count: 0 }, net_replenished_minor: "0", purchases: { amount_minor: "424242", count: 9 }, refunds: { amount_minor: "0", count: 0 },
    adjustment_credits: { amount_minor: "0", count: 0 }, adjustment_debits: { amount_minor: "0", count: 0 }, historical_adjustments: { net_minor: "0", count: 0 }, net_movement_minor: "0", entry_count: 9, wallets_with_movement: 1 },
  cafeterias: [{ cafeteria_id: "4d700000-0000-4000-8000-000000000101", name: "Cafetería Ficticia", spent_minor: "424242", purchase_count: 9, refunded_minor: "0", refund_count: 0 }] };
const reads = () => mocks.rpc.mockImplementation(async (rpc: string, args: { p_section?: string }) => ({ error: null, data:
  rpc === "school_wallet_report" ? report : args.p_section === "summary" ? { scope, locations: [], counts: { students: 3, active: 3, suspended: 0, inactive: 0, cafeterias: 1 } }
  : args.p_section === "cafeterias" ? { scope, locations: [], rows: [cafeteria] } : { scope, locations: [], memberships: [], invitations: [{ id, email: "x@example.invalid", status: "expired", expires_at: "2026-10-01T00:00:00Z" }] } }));
const run = async () => { renderToStaticMarkup(await SchoolScreen({ section: "summary", searchParams: Promise.resolve({ school: id }) })); return mocks.pages.mock.calls.at(-1)![0] as { overview?: unknown }; };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ status: "authorized", context: { person_id: id, schools: [{ school_id: id }] } }); mocks.shares.mockResolvedValue({ data: [{ cafeteria_id: cafeteria.id, status: "active" }], error: null }); reads(); });

describe("School Overview server reads", () => {
  it("with wallet authority: School reads plus the wallet report, reduced before reaching the page", async () => {
    mocks.wallet.mockResolvedValue({ read: true });
    const props = await run(), json = JSON.stringify(props.overview);
    expect(mocks.rpc.mock.calls.map(c => [c[0], (c[1] as { p_section?: string; p_period?: string }).p_section ?? (c[1] as { p_period?: string }).p_period]))
      .toEqual(expect.arrayContaining([["school_admin_read", "summary"], ["school_admin_read", "cafeterias"], ["school_admin_read", "administrators"], ["school_wallet_report", "last_7_days"]]));
    expect(json).toContain('"wallets_with_movement":1'); expect(json).toContain('"enabled_students":1'); expect(json).toContain('"sharing_state":"active"'); expect(mocks.shares).toHaveBeenCalledWith("school_sharing_rows", { p_school_id: id });
    expect((props as { sharing?: unknown }).sharing).toEqual({ [cafeteria.id]: "active" });
    expect(json).not.toMatch(/424242|spent|purchase|Estudiante Privada|x@example/);
  });
  it("without wallet authority the wallet report is never requested", async () => {
    mocks.wallet.mockResolvedValue({ read: false });
    const props = await run();
    expect(mocks.rpc.mock.calls.map(c => c[0])).not.toContain("school_wallet_report"); expect((props.overview as { wallet: unknown }).wallet).toBeNull();
  });
  it("a failed sharing or wallet read stays contained", async () => {
    mocks.wallet.mockResolvedValue({ read: true });
    mocks.rpc.mockImplementation(async (rpc: string, args: { p_section?: string }) => rpc === "school_wallet_report" || args.p_section === "cafeterias" ? { error: { code: "42501" }, data: null }
      : { error: null, data: args.p_section === "summary" ? { scope, locations: [], counts: { students: 0, active: 0, suspended: 0, inactive: 0, cafeterias: 0 } } : { scope, locations: [], memberships: [], invitations: [] } });
    const o = (await run()).overview as { cafeterias: unknown; wallet: unknown };
    expect(o.cafeterias).toBeNull(); expect(o.wallet).toBeNull();
  });
  it("UX 13: no share row means never shared; an unavailable sharing-rows read degrades to 'inactive' (never 'revoked')", async () => {
    mocks.wallet.mockResolvedValue({ read: false }); mocks.shares.mockResolvedValue({ data: [], error: null });
    mocks.rpc.mockImplementation(async (rpc: string, args: { p_section?: string }) => ({ error: null, data: args.p_section === "summary" ? { scope, locations: [], counts: { students: 3, active: 3, suspended: 0, inactive: 0, cafeterias: 0 } }
      : args.p_section === "cafeterias" ? { scope, locations: [], rows: [{ ...cafeteria, sharing_status: "revoked", customer_count: 0, customers: [] }] } : { scope, locations: [], memberships: [], invitations: [] } }));
    expect(JSON.stringify((await run()).overview)).toContain('"sharing_state":"never"');
    mocks.shares.mockRejectedValue(new Error("down"));
    const o = (await run()).overview as { cafeterias: { sharing_state: string }[] }; expect(o.cafeterias[0].sharing_state).toBe("inactive");
    mocks.shares.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(((await run()).overview as { cafeterias: { sharing_state: string }[] }).cafeterias[0].sharing_state).toBe("inactive");
  });
  it("Pilot Hardening: an active share is «Compartición activa» whatever the share-rows read says, so the label never contradicts «Cafetería compartida · COMPLETO»", async () => {
    for (const rows of [{ data: [], error: null }, { data: null, error: { code: "42501" } }]) {
      mocks.shares.mockResolvedValue(rows);
      const o = (await run()).overview as { cafeterias: { sharing_state: string; sharing: boolean }[] };
      expect(o.cafeterias[0]).toMatchObject({ sharing: true, sharing_state: "active" });
    }
  });
  it("Estudiantes: the roster gets the school's own status counts; another school's counts are discarded", async () => {
    mocks.wallet.mockResolvedValue({ read: false });
    mocks.rpc.mockImplementation(async (rpc: string) => ({ error: null, data: rpc === "school_student_roster" ? { scope, locations: [], rows: [] }
      : { scope, locations: [], counts: { students: 14, active: 12, suspended: 1, inactive: 1, cafeterias: 1 } } }));
    renderToStaticMarkup(await SchoolScreen({ section: "students", searchParams: Promise.resolve({ school: id }) }));
    expect(mocks.rpc).toHaveBeenCalledWith("school_admin_read", expect.objectContaining({ p_school_id: id, p_section: "summary" }));
    expect((mocks.pages.mock.calls.at(-1)![0] as { studentCounts?: unknown }).studentCounts).toEqual({ students: 14, active: 12, suspended: 1, inactive: 1, cafeterias: 1 });
    mocks.rpc.mockImplementation(async (rpc: string) => ({ error: null, data: rpc === "school_student_roster" ? { scope, locations: [], rows: [] }
      : { scope: { ...scope, school_id: "4d700000-0000-4000-8000-0000000000ff" }, locations: [], counts: { students: 99, active: 99, suspended: 0, inactive: 0, cafeterias: 0 } } }));
    renderToStaticMarkup(await SchoolScreen({ section: "students", searchParams: Promise.resolve({ school: id }) }));
    expect((mocks.pages.mock.calls.at(-1)![0] as { studentCounts?: unknown }).studentCounts).toBeUndefined();
  });
  it("another school's read is never used", async () => {
    mocks.wallet.mockResolvedValue({ read: true });
    const other = { ...scope, school_id: "4d700000-0000-4000-8000-0000000000ff" };
    mocks.rpc.mockImplementation(async (rpc: string, args: { p_section?: string }) => ({ error: null, data: rpc === "school_wallet_report" ? { ...report, school_id: other.school_id }
      : args.p_section === "summary" ? { scope, locations: [], counts: { students: 1, active: 1, suspended: 0, inactive: 0, cafeterias: 0 } } : { scope: other, locations: [], rows: [cafeteria], memberships: [], invitations: [] } }));
    const o = (await run()).overview as { cafeterias: unknown; wallet: unknown; invitations: unknown };
    expect(o.cafeterias).toBeNull(); expect(o.wallet).toBeNull(); expect(o.invitations).toBeNull();
  });
});
