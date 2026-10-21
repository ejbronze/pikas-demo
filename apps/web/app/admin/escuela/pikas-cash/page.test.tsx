import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), access: vi.fn(), wallet: vi.fn(), cash: vi.fn(), redirect: vi.fn((u: string) => { throw Object.assign(new Error("redirect"), { url: u }); }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../../../lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("../../../../lib/auth/school-access", () => ({ resolveSchoolAccess: mocks.access }));
vi.mock("../../../../lib/wallet/access", () => ({ readSchoolWalletAccess: mocks.wallet }));
vi.mock("../../../../components/connected-school-shell", () => ({ ConnectedSchoolShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../../../../components/school-pikas-cash", () => ({ SchoolPikasCash: (props: unknown) => { mocks.cash(props); return null; } }));
(globalThis as { React?: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import Page from "./page";

const school = "4d700000-0000-4000-8000-000000000001", other = "4d700000-0000-4000-8000-0000000000ff";
const ana = "4d700000-0000-4000-8000-000000000101", beto = "4d700000-0000-4000-8000-000000000102", caro = "4d700000-0000-4000-8000-000000000103";
const scope = (school_id = school) => ({ actor_id: school, membership_id: school, role: "school_admin", account_id: school, school_id, account_name: "Cuenta", school_name: "Colegio", tenant_kind: "customer" });
const st = (id: string, name: string, code: string) => ({ id, first_name: name, last_name: "Ficticia", display_name: `${name} Ficticia`, student_code: code, status: "active", enrollment: null });
const report = { school_id: school, tenant_kind: "customer", business_timezone: "America/Santo_Domingo", currency_code: "DOP", period: "last_7_days", from: "2026-10-15", to: "2026-10-21", today: "2026-10-21", as_of: "2026-10-21T12:00:00Z",
  current: { total_balance_minor: "24500", wallet_count: 3, active_wallet_count: 2, frozen_wallet_count: 1, negative_wallet_count: 1, negative_balance_minor: "-500" },
  movements: { replenishments: { amount_minor: "50000", count: 2 }, reversals: { amount_minor: "0", count: 0 }, net_replenished_minor: "50000", purchases: { amount_minor: "6500", count: 1 }, refunds: { amount_minor: "0", count: 0 },
    adjustment_credits: { amount_minor: "0", count: 0 }, adjustment_debits: { amount_minor: "0", count: 0 }, historical_adjustments: { net_minor: "0", count: 0 }, net_movement_minor: "43500", entry_count: 3, wallets_with_movement: 2 },
  cafeterias: [{ cafeteria_id: "4d700000-0000-4000-8000-0000000000c1", name: "Cafetería Comercial", spent_minor: "6500", purchase_count: 1, refunded_minor: "0", refund_count: 0 }] };
// Chainable, thenable stand-in for supabase.from(...) that records filters per call.
const tables: Record<string, unknown[]> = {}, calls: { table: string; ops: [string, unknown[]][] }[] = [];
const builder = (table: string) => { const call = { table, ops: [] as [string, unknown[]][] }; calls.push(call); const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "order", "limit"]) b[m] = (...a: unknown[]) => { call.ops.push([m, a]); return b; };
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: typeof tables[table] === "function" ? (tables[table] as unknown as (c: typeof call) => unknown)(call) : tables[table] ?? [], error: null }).then(ok); return b; };
const roster = (rosterScope = scope(), rows = [st(ana, "Ana", "EST-1"), st(beto, "Beto", "EST-2")]) => mocks.rpc.mockImplementation(async (rpc: string) => ({ error: null, data:
  rpc === "school_student_roster" ? { scope: rosterScope, locations: [], rows, grades: [], next_cursor: null } : rpc === "school_wallet_report" ? report : null }));
const run = async (sp: Record<string, string> = {}) => { renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ school, ...sp }) })); return mocks.cash.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined; };
beforeEach(() => { vi.clearAllMocks(); calls.length = 0; mocks.wallet.mockResolvedValue({ read: true });
  mocks.access.mockResolvedValue({ status: "authorized", context: { person_id: school, pov: null, schools: [{ school_id: school, school_name: "Colegio Ficticio" }] } }); mocks.from.mockImplementation(builder);
  tables.student_wallets = ((c: { ops: [string, unknown[]][] }) => c.ops.some(([m]) => m === "or")
    ? [{ student_id: caro, status: "frozen", current_balance_minor: "-500" }]
    : [{ student_id: ana, status: "active", current_balance_minor: "15000" }]) as unknown as unknown[];
  tables.students = [{ id: caro, display_name: "Caro Ficticia", student_code: "EST-3", status: "active" }]; roster(); });

describe("School PIKAS Cash server reads", () => {
  it("joins the roster page with wallet state and balance; students without a wallet stay listed", async () => {
    const props = await run();
    expect(props!.students).toEqual([{ id: ana, name: "Ana Ficticia", code: "EST-1", status: "active", wallet: { status: "active", balance_minor: "15000" } },
      { id: beto, name: "Beto Ficticia", code: "EST-2", status: "active", wallet: null }]);
    expect(props!.overview).toEqual({ wallet_count: 3, active: 2, frozen: 1, negative: 1, total_balance_minor: "24500", with_movement: 2, from: "2026-10-15", to: "2026-10-21" });
    expect(props!.attentionCount).toBe(1);
  });
  it("every read is scoped to this school; wallet reads are limited to the page's students and to DOP", async () => {
    await run({ q: "Ana" });
    expect(mocks.rpc).toHaveBeenCalledWith("school_student_roster", expect.objectContaining({ p_school_id: school, p_query: "Ana", p_limit: 50 }));
    expect(mocks.rpc).toHaveBeenCalledWith("school_wallet_report", expect.objectContaining({ p_school_id: school, p_period: "last_7_days" }));
    for (const c of calls) expect(c.ops).toContainEqual(["eq", ["school_id", school]]);
    const page = calls.find(c => c.table === "student_wallets" && c.ops.some(([m]) => m === "in"))!;
    expect(page.ops).toContainEqual(["in", ["student_id", [ana, beto]]]); expect(page.ops).toContainEqual(["eq", ["currency_code", "DOP"]]);
  });
  it("attention is factual: frozen or below zero only, capped, never ordered by balance", async () => {
    const props = await run({ vista: "atencion" });
    const att = calls.find(c => c.ops.some(([m]) => m === "or"))!;
    expect(att.ops).toContainEqual(["or", ["status.eq.frozen,current_balance_minor.lt.0"]]); expect(att.ops).toContainEqual(["order", ["student_id"]]); expect(att.ops).toContainEqual(["limit", [50]]);
    expect(mocks.rpc.mock.calls.map(c => c[0])).not.toContain("school_student_roster");
    expect(props!.students).toEqual([{ id: caro, name: "Caro Ficticia", code: "EST-3", status: "active", wallet: { status: "frozen", balance_minor: "-500" } }]);
  });
  it("passes no purchases, purchase lines, receipts, products or per-cafetería commercial fields", async () => {
    const json = JSON.stringify(await run()) + JSON.stringify(await run({ vista: "atencion" }));
    expect(json).not.toMatch(/Cafetería Comercial|spent_minor|purchase|receipt|items|6500|refund|cafeterias|movements|net_replenished/);
    expect(mocks.rpc.mock.calls.map(c => c[0])).not.toContain("school_wallet_read");
  });
  it("another school's roster is discarded", async () => {
    roster(scope(other));
    expect((await run())!.students).toBeNull();
  });
  it("a report for another school is discarded", async () => {
    mocks.rpc.mockImplementation(async (rpc: string) => ({ error: null, data: rpc === "school_wallet_report" ? { ...report, school_id: other } : { scope: scope(), locations: [], rows: [], next_cursor: null } }));
    expect((await run())!.overview).toBeNull();
  });
  it("without wallet authority nothing financial is read", async () => {
    mocks.wallet.mockResolvedValue({ read: false });
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ school }) }));
    expect(html).toContain("Tu rol no tiene acceso a PIKAS Cash"); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.cash).not.toHaveBeenCalled();
  });
  it("a sandbox POV keeps its financial exclusion", async () => {
    mocks.access.mockResolvedValue({ status: "authorized", context: { person_id: school, pov: { role: "school_admin" }, schools: [{ school_id: school, school_name: "Colegio" }] } });
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ school }) }));
    expect(html).toContain("no están habilitados"); expect(mocks.wallet).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("an unknown school redirects; invalid paging input is ignored", async () => {
    await run({ after: "not-a-uuid", q: "x".repeat(200) });
    expect(mocks.rpc).toHaveBeenCalledWith("school_student_roster", expect.objectContaining({ p_after: null, p_query: "" }));
    mocks.access.mockResolvedValue({ status: "authorized", context: { person_id: school, pov: null, schools: [{ school_id: other, school_name: "Otro" }] } });
    await expect(Page({ searchParams: Promise.resolve({ school }) })).rejects.toMatchObject({ url: "/admin/escuela" });
  });
});
