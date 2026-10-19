import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.resolve }));
import { POST } from "./route";
const id = "6c000000-0000-4000-8000-000000000001", key = "6c000000-0000-4000-8000-000000000002";
const body = { accountId: id, expectedStatus: "active", action: "suspend", reason: "Pago pendiente" };
const post = (b: unknown, origin = "https://pikas.test") => POST(new NextRequest("https://pikas.test/api/platform/customer-lifecycle", { method: "POST", headers: { origin, "Idempotency-Key": key, "Content-Type": "application/json" }, body: JSON.stringify(b) }));

describe("Platform customer lifecycle route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.resolve.mockResolvedValue({ status: "ready", platform: { capabilities: ["platform:tenant:lifecycle:read", "platform:tenant:lifecycle:manage"] } });
    mocks.rpc.mockResolvedValue({ data: { account_id: id, status: "suspended", previous_status: "active" }, error: null }); });
  it("passes the expected state, action, reason and request key to the authoritative function", async () => {
    expect((await post(body)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("platform_set_customer_lifecycle", { p_request_id: key, p_account_id: id, p_expected_status: "active", p_action: "suspend", p_reason: "Pago pendiente" });
  });
  it("requires the lifecycle manage capability (read-only operators and tenants are refused before the database)", async () => {
    mocks.resolve.mockResolvedValue({ status: "ready", platform: { capabilities: ["platform:tenant:lifecycle:read"] } });
    expect((await post(body)).status).toBe(403);
    mocks.resolve.mockResolvedValue({ status: "ready", platform: null });
    expect((await post(body)).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...body, reason: "x" }, { ...body, action: "delete" }, { ...body, expectedStatus: "inactive" }, { ...body, extra: 1 }])("invalid request %# never reaches the database", async b => {
    expect((await post(b)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["lifecycle_state_changed", "invalid_lifecycle_transition", "lifecycle_reason_required"])("%s is a definite 422 with its code", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: code === "lifecycle_state_changed" ? "40001" : "22023", message: code } });
    const r = await post(body); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: code });
  });
  it("cross-origin is refused", async () => { expect((await post(body, "https://evil.test")).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
});
