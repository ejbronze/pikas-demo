import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn() }));
vi.mock("../../../../lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock("../../../../lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.resolve }));
import { POST as transactions } from "./transactions/route";
import { POST as reports } from "./reports/route";
import { POST as cafeteriaCommand } from "./cafeteria/route";

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

describe("Backoffice customer-operations management routes", () => {
  const key = "7a000000-0000-4000-8000-0000000000d1";
  const product = { cafeteriaId: caf, operation: "product_save", payload: { id: purchase, version: null, name: "Producto ficticio", description: "", unit: "Unidad", category: "Comida", price_minor: 1000, active: true, available: true, ingredients: [], allergens: [] } };
  const commandPost = (route: typeof cafeteriaCommand, request: unknown) => route(new Request("https://pikas.test/api/x", { method: "POST", headers: { origin: "https://pikas.test", "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ account_id: account, request }) }));
  beforeEach(() => { vi.clearAllMocks(); mocks.resolve.mockResolvedValue(ready(["platform:customer:operations:read", "platform:customer:operations:manage"])); });
  it("sends catalog writes only to the bounded Platform wrapper with the explicit account", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { request_id: key, operation: "product_save", target_id: purchase }, error: null });
    expect((await commandPost(cafeteriaCommand, product)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("platform_support_cafeteria_command", { p_account_id: account, p_cafeteria_id: caf, p_request_id: key, p_operation: "product_save", p_payload: product.payload });
    expect(mocks.rpc.mock.calls.every(c => String(c[0]).startsWith("platform_support_"))).toBe(true);
  });
  it("reports definite domain rejections (e.g. unconfirmed POS identity) as rejected, never uncertain or leaked", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "active_confirmed_pos_identity_required" } });
    const assignment = { cafeteriaId: caf, operation: "assignment_save", payload: { membership_id: purchase, register_id: purchase, status: "active", version: null } };
    const r = await commandPost(cafeteriaCommand, assignment); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: "cafeteria_state_invalid" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "customer_operations_scope_required" } });
    expect((await commandPost(cafeteriaCommand, assignment)).status).toBe(403);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "internal detail" } });
    const u = await commandPost(cafeteriaCommand, assignment); expect(u.status).toBe(502); expect(await u.text()).not.toContain("internal detail");
  });
  it("exposes no Platform school, roster or student-import route: those belong to School Admin", () => {
    for (const removed of ["school", "students"]) expect(existsSync(fileURLToPath(new URL(`./${removed}`, import.meta.url)))).toBe(false);
    expect(existsSync(fileURLToPath(new URL("./cafeteria/route.ts", import.meta.url)))).toBe(true);
  });
  it("rejects read-only support, provisioning operations and financial operation names before any RPC", async () => {
    mocks.resolve.mockResolvedValue(ready(["platform:customer:operations:read"]));
    expect((await commandPost(cafeteriaCommand, product)).status).toBe(403);
    mocks.resolve.mockResolvedValue(ready(["platform:customer:operations:manage"]));
    const forbidden = [
      { route: cafeteriaCommand, request: { cafeteriaId: caf, operation: "staff_prepare", payload: { email: "new@example.invalid", role: "pos_cashier" } } },
      { route: cafeteriaCommand, request: { cafeteriaId: caf, operation: "student_create", payload: {} } },
      { route: cafeteriaCommand, request: { cafeteriaId: caf, operation: "staff_status", payload: {} } },
      { route: cafeteriaCommand, request: { cafeteriaId: caf, operation: "checkout_purchase", payload: {} } },
      { route: cafeteriaCommand, request: { cafeteriaId: caf, operation: "wallet_adjust", payload: {} } },
      { route: cafeteriaCommand, request: { cafeteriaId: caf, operation: "refund_purchase", payload: {} } },
    ];
    for (const item of forbidden) expect((await commandPost(item.route, item.request)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
