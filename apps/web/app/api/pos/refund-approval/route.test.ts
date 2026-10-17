import { beforeEach, describe, expect, it, vi } from "vitest";
import { posContext } from "../../../../lib/pos/access-context.test-fixtures";

const mocks = vi.hoisted(() => ({ cashier: vi.fn(), access: vi.fn(), createClient: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), approverRpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.cashier }) }));
vi.mock("@/lib/auth/pos-access", () => ({ resolvePosAccess: mocks.access }));
vi.mock("@/lib/supabase/config", () => ({ getSupabasePublicConfig: () => ({ url: "http://127.0.0.1:1", anonKey: "anon" }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { POST } from "./route";

const id = (n: number) => `5c100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = posContext(false);
const session = { cafeteria_id: context.memberships[0].cafeteria_id, register_id: id(1), assignment_id: id(2), session_id: id(3), status: "open", version: 1,
  opening_cash_minor: "0", currency_code: "DOP", register_code_snapshot: "R1", register_name_snapshot: "Caja" };
const body = { purchase_id: id(4), items: [{ purchase_item_id: id(5), quantity: 1 }], reason: "wrong_product", notes: "", issuance_key: id(6),
  approver_email: "supervisor@example.invalid", approver_password: "fictional-pass" };
const token = `x.${Buffer.from(JSON.stringify({ session_id: id(9) })).toString("base64url")}.y`;
function call(b: unknown = body, key = body.issuance_key) {
  return POST(new Request("https://pikas-pikas.app/api/pos/refund-approval", { method: "POST", headers: { "Content-Type": "application/json",
    Origin: "https://pikas-pikas.app", "Idempotency-Key": key }, body: JSON.stringify(b) }));
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.access.mockResolvedValue({ status: "authorized", context });
  mocks.cashier.mockResolvedValue({ data: [session], error: null });
  mocks.signIn.mockResolvedValue({ data: { session: { access_token: token } }, error: null }); mocks.signOut.mockResolvedValue({ error: null });
  mocks.approverRpc.mockImplementation(async (name: string) => name === "issue_purchase_item_refund_approval"
    ? { data: { approval_id: id(7), purchase_id: id(4), amount_minor: "5000", approver_role: "pos_supervisor", issued_at: "t", expires_at: "t" }, error: null } : { data: {}, error: null });
  mocks.createClient.mockImplementation((_u: string, _k: string, options: { accessToken?: unknown }) => options.accessToken
    ? { rpc: mocks.approverRpc } : { auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut } });
});
describe("same-device refund override", () => {
  it("authenticates the approver on an isolated client bound to its own session and signs it out", async () => {
    const r = await call(); expect(r.status).toBe(200);
    const isolated = mocks.createClient.mock.calls[0][2];
    expect(isolated.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
    expect(mocks.createClient.mock.calls[1][2].global.headers).toEqual({ "X-Pikas-Session-Id": id(9) });
    expect(mocks.approverRpc).toHaveBeenCalledWith("issue_purchase_item_refund_approval", expect.objectContaining({ p_register_session_id: id(3), p_issuance_request_key: id(6) }));
    expect(mocks.approverRpc).toHaveBeenCalledWith("pikas_session_end"); expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("rejects wrong approver credentials without touching the database", async () => {
    mocks.signIn.mockResolvedValue({ data: { session: null }, error: { message: "Invalid" } });
    expect((await call()).status).toBe(401); expect(mocks.approverRpc).not.toHaveBeenCalled();
  });
  it("maps an unscoped approver to 403 and still signs out", async () => {
    mocks.approverRpc.mockImplementation(async (name: string) => name === "issue_purchase_item_refund_approval" ? { data: null, error: { code: "42501", message: "APPROVER_NOT_AUTHORIZED" } } : { data: {}, error: null });
    expect((await call()).status).toBe(403); expect(mocks.signOut).toHaveBeenCalled();
  });
  it("denies sandbox POV, cross-origin and mismatched keys", async () => {
    expect((await call(body, id(8))).status).toBe(400);
    expect((await POST(new Request("https://pikas-pikas.app/api/pos/refund-approval", { method: "POST", headers: { Origin: "https://other.invalid" }, body: "{}" }))).status).toBe(403);
    mocks.access.mockResolvedValue({ status: "authorized", context: { ...context, pov: {} } });
    expect((await call()).status).toBe(403); expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it("requires the cashier's single open register", async () => {
    mocks.cashier.mockResolvedValue({ data: [], error: null }); expect((await call()).status).toBe(409); expect(mocks.signIn).not.toHaveBeenCalled();
  });
});
