import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.resolve }));
import { POST } from "./route";
const id = "6b000000-0000-4000-8000-000000000001", key = "6b000000-0000-4000-8000-000000000002";
const base = { accountId: id, scopeKind: "account", schoolId: null, cafeteriaId: null, roleCode: "account_admin", intendedEmail: "manuel@example.invalid", expiresAt: "2026-10-26T00:00:00.000Z" };
const post = (body: unknown) => POST(new NextRequest("https://pikas.test/api/platform/customer-admins/prepare", { method: "POST", headers: { origin: "https://pikas.test", "Idempotency-Key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) }));

describe("Phase 6A Platform initial administrator with username", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.resolve.mockResolvedValue({ status: "ready", platform: { capabilities: ["platform:customer_admin:provision"] } }); mocks.rpc.mockResolvedValue({ data: { intent_id: id, status: "pending" }, error: null }); });
  it("reserves through the transactional wrapper (normalized)", async () => {
    expect((await post({ ...base, intendedUsername: " Manuel.Admin " })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("platform_prepare_customer_admin_with_username", expect.objectContaining({ p_request_id: key, p_intended_email: "manuel@example.invalid", p_username: "manuel.admin" }));
  });
  it("legacy saved requests without username keep the original RPC", async () => {
    await post(base); expect(mocks.rpc).toHaveBeenCalledWith("platform_prepare_customer_admin", expect.not.objectContaining({ p_username: expect.anything() }));
  });
  it("a taken username is a definite 422 with its code; malformed never reaches the database", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "username_unavailable" } });
    const r = await post({ ...base, intendedUsername: "taken" }); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: "username_unavailable" });
    mocks.rpc.mockClear(); expect((await post({ ...base, intendedUsername: "a..b" })).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
