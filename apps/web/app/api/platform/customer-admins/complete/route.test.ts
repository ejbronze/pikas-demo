import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn(), identity: vi.fn() }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.identity }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
import { POST } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const payload = { intentId: id, displayName: "Administradora" };
function request(body: unknown = payload, origin = "http://localhost:3000") { return new NextRequest("http://localhost:3000/api/platform/customer-admins/complete", { method: "POST", headers: { origin, "Content-Type": "application/json", "Idempotency-Key": id }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.identity.mockResolvedValue({ status: "ready", user: { id: "operator" }, person: { id: "operator-person" }, platform: { capabilities: ["platform:customer_admin:provision", "platform:identity:link"] } }); });
describe("first-admin completion API", () => {
  it.each([{ ...payload, authUserId: id }, { ...payload, roleCode: "platform_admin" }, { ...payload, actor: id }])("rejects supplied identity/authority %j", async (body) => { expect((await POST(request(body))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("requires same origin", async () => { expect((await POST(request(payload, "https://untrusted.invalid"))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it.each(["unauthenticated", "unlinked", "sandbox"])("fails closed for %s", async (kind) => { mocks.identity.mockResolvedValue(kind === "sandbox" ? { status: "ready", platform: { capabilities: ["platform:sandbox:pov:enter"] } } : { status: kind }); expect((await POST(request())).status).toBe(kind === "unauthenticated" ? 401 : 403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("passes only prepared intent/display and key to the authenticated completion RPC", async () => {
    const result = { intent_id: id, membership_id: id, person_id: id, role_code: "account_admin", scope_kind: "account", status: "granted" };
    mocks.rpc.mockResolvedValue({ data: result, error: null }); const response = await POST(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ result }); expect(mocks.rpc).toHaveBeenCalledWith("platform_complete_initial_customer_admin", { p_request_id: id, p_intent_id: id, p_display_name: "Administradora" });
  });
  it.each(["23514", "42501", "23505"])("does not claim success for rejected %s", async (code) => { mocks.rpc.mockResolvedValue({ data: null, error: { code } }); const response = await POST(request()); expect(response.status).not.toBe(200); expect(await response.json()).not.toHaveProperty("result"); });
  it("rejects invalid success payload", async () => { mocks.rpc.mockResolvedValue({ data: { status: "granted" }, error: null }); expect((await POST(request())).status).toBe(502); });
});
