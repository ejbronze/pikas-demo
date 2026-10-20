import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn() }));
vi.mock("../../../../lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock("../../../../lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.resolve }));
import { POST as transactions } from "./transactions/route";
import { POST as reports } from "./reports/route";

const account = "7a000000-0000-4000-8000-0000000000a1", caf = "7a000000-0000-4000-8000-0000000000c1", purchase = "7a000000-0000-4000-8000-0000000000p1".replace("p", "e");
const list = { operation: "list", cafeteria_id: caf, period: "last_7_days", from: null, to: null, tender: null, refund_status: null, receipt: null, offset: 0 };
const post = (route: typeof transactions, body: unknown, origin = "https://pikas.test") => route(new Request("https://pikas.test/api/x", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const ready = (caps: string[]) => ({ status: "ready", platform: { capabilities: caps } });

describe("Backoffice customer-operations read routes", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.resolve.mockResolvedValue(ready(["platform:customer:operations:read"])); mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "x" } }); });
  it("call only the Platform support wrappers with the explicit account; never a tenant RPC", async () => {
    await post(transactions, { account_id: account, request: list });
    expect(mocks.rpc).toHaveBeenCalledWith("platform_support_cafeteria_transactions_read", { p_account_id: account, p_cafeteria_id: caf, p_period: "last_7_days", p_from: null, p_to: null, p_tender: null, p_refund_status: null, p_receipt: null, p_offset: 0 });
    await post(transactions, { account_id: account, request: { operation: "detail", cafeteria_id: caf, purchase_id: purchase } });
    expect(mocks.rpc).toHaveBeenLastCalledWith("platform_support_cafeteria_transaction_detail", { p_account_id: account, p_cafeteria_id: caf, p_purchase_id: purchase });
    await post(reports, { account_id: account, request: { cafeteria_id: caf, kind: "sales_summary", period: "today", from: null, to: null } });
    expect(mocks.rpc).toHaveBeenLastCalledWith("platform_support_cafeteria_report_read", { p_account_id: account, p_cafeteria_id: caf, p_kind: "sales_summary", p_period: "today", p_from: null, p_to: null });
    expect(mocks.rpc.mock.calls.map(c => c[0]).every((n: string) => n.startsWith("platform_support_"))).toBe(true);
  });
  it("require operations:read; tenant users and other Platform capabilities are refused before the database", async () => {
    for (const identity of [ready(["platform:tenant:lifecycle:manage", "platform:identity:support"]), { status: "ready", platform: null, memberships: [{ roleCode: "cafeteria_admin" }] }]) {
      mocks.resolve.mockResolvedValue(identity);
      expect((await post(transactions, { account_id: account, request: list })).status).toBe(403);
      expect((await post(reports, { account_id: account, request: { cafeteria_id: caf, kind: "sales_summary", period: "today", from: null, to: null } })).status).toBe(403);
    }
    mocks.resolve.mockResolvedValue({ status: "unauthenticated" });
    expect((await post(transactions, { account_id: account, request: list })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("cross-origin and malformed requests (missing account, extra fields) never reach the database", async () => {
    expect((await post(transactions, { account_id: account, request: list }, "https://evil.test")).status).toBe(403);
    expect((await post(transactions, { request: list })).status).toBe(400);
    expect((await post(transactions, { account_id: account, request: list, actor_id: account })).status).toBe(400);
    expect((await post(transactions, { account_id: "nope", request: list })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("a scope refusal reveals nothing about the customer or cafeteria", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "customer_operations_scope_required" } });
    const r = await post(transactions, { account_id: account, request: list });
    expect(r.status).toBe(403); expect(await r.json()).toEqual({ error: "customer_operations_scope_required" });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "internal detail" } });
    const u = await post(reports, { account_id: account, request: { cafeteria_id: caf, kind: "top_products", period: "today", from: null, to: null } });
    expect(u.status).toBe(502); expect(await u.text()).not.toContain("internal detail");
  });
});
