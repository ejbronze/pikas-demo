import { beforeEach, describe, expect, it, vi } from "vitest";
import { posContext } from "../../../lib/pos/access-context.test-fixtures";

const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
vi.mock("@/lib/auth/pos-access", () => ({ resolvePosAccess: mocks.access }));
import { POST } from "./route";

const id = (n: number) => `5c100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = posContext(false);
const cafe = context.memberships[0].cafeteria_id;
const register = { cafeteria_id: cafe, register_id: id(1), assignment_id: id(2), register_code: "R1", display_name: "Caja", register_version: 1, assignment_version: 1 };
const session = { ...register, session_id: id(3), status: "open", version: 1, opening_cash_minor: "10000", currency_code: "DOP", register_code_snapshot: "R1", register_name_snapshot: "Caja" };
const request = { purchase_id: id(4), items: [{ purchase_item_id: id(5), quantity: 1 }], reason: "wrong_product", notes: "", request_key: id(6), approval_id: null };
const result = { refund_id: id(7), purchase_id: id(4), refund_ordinal: "1", amount_minor: "5000", currency_code: "DOP", tender_type: "cash",
  occurred_at: "2026-10-18T12:00:00Z", business_date: "2026-10-18", business_timezone: "America/Santo_Domingo", purchase_number: "9",
  approval_used: false, reason: "wrong_product", notes: null, authorization_mode: "independent", approval_id: null, remaining_after_minor: "5000",
  sale_age_seconds: "60", override_required: false, override_reasons: [], approver_role: null, register_session_id: id(3),
  items: [{ purchase_item_id: id(5), name: "Agua", quantity: 1, amount_minor: "5000" }] };
let refundResponse: { data: unknown; error: unknown };
beforeEach(() => {
  vi.clearAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.access.mockResolvedValue({ status: "authorized", context });
  refundResponse = { data: result, error: null };
  mocks.rpc.mockImplementation(async (name: string) => name === "list_my_operable_registers" ? { data: [register], error: null }
    : name === "get_my_open_register_session" ? { data: [session], error: null } : name === "create_purchase_item_refund" ? refundResponse : { data: null, error: { code: "XX000", message: "x" } });
});
function call(body: unknown, key = request.request_key) {
  return POST(new Request("https://pikas-pikas.app/api/pos", { method: "POST", headers: { "Content-Type": "application/json",
    Origin: "https://pikas-pikas.app", "Idempotency-Key": key }, body: JSON.stringify(body) }));
}
describe("POS refund boundary", () => {
  it("uses the server-resolved open session and exact minor-unit items", async () => {
    const r = await call({ operation: "refund", request });
    expect(r.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("create_purchase_item_refund", { p_register_session_id: id(3), p_purchase_id: id(4),
      p_items: request.items, p_reason: "wrong_product", p_notes: null, p_request_key: id(6), p_approval_id: null });
  });
  it("requires matching idempotency key", async () => { expect((await call({ operation: "refund", request }, id(9))).status).toBe(400); });
  it.each([{ ...request, reason: "" }, { ...request, reason: "other", notes: "" }, { ...request, items: [] }, { ...request, amount_minor: "5000" },
    { ...request, items: [{ purchase_item_id: id(5), quantity: 0 }] }])("rejects invalid refund input %#", async (bad) => {
    expect((await call({ operation: "refund", request: bad })).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("surfaces required override with its reasons as a definite rejection", async () => {
    refundResponse = { data: null, error: { code: "42501", message: "REFUND_APPROVAL_REQUIRED", details: "sale_age,count_limit" } };
    const r = await call({ operation: "refund", request });
    expect(r.status).toBe(409); expect(await r.json()).toEqual({ error: "REFUND_APPROVAL_REQUIRED", definite: true, override_reasons: ["sale_age", "count_limit"] });
  });
  it("keeps unknown failures uncertain", async () => {
    refundResponse = { data: null, error: { code: "XX000", message: "private" } };
    const r = await call({ operation: "refund", request }); expect(r.status).toBe(502); expect(await r.text()).not.toContain("private");
  });
  it("rejects a result for another purchase or approval", async () => {
    refundResponse = { data: { ...result, approval_id: id(8) }, error: null }; expect((await call({ operation: "refund", request })).status).toBe(502);
  });
  it("denies sandbox POV refunds", async () => {
    mocks.access.mockResolvedValue({ status: "authorized", context: { ...context, pov: { expires_at: "2999-01-01T00:00:00Z" } } });
    expect((await call({ operation: "refund", request })).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalledWith("create_purchase_item_refund", expect.anything());
  });
});
