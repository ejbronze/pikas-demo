import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Restaurar escenario inicial: capability, Demo guard, sandbox-only refusals from the database, Auth purge of the
// retired sandbox people (service role), and an honest report when the purge fails. Fictional identifiers only.
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), identity: vi.fn(), demo: vi.fn(), deleteUser: vi.fn() }));
vi.mock("../../../../../lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock("../../../../../lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.identity }));
vi.mock("../../../../../lib/auth/demo-guard", () => ({ demoMutationBlock: mocks.demo }));
vi.mock("../../../../../lib/auth/activation", () => ({ invitationProvider: () => ({ auth: { admin: { deleteUser: mocks.deleteUser } } }) }));
import { POST } from "./route";

const U = (n: number) => `7d000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const key = U(1), sandbox = U(2), authA = U(11), authB = U(12);
const operator = (caps: string[]) => ({ status: "ready", user: { id: "auth-user" }, person: { id: U(9), displayName: "Operadora" }, memberships: [], platform: { role: "platform_admin", roles: ["platform_admin"], capabilities: caps } });
const post = (body: unknown, k = key) => POST(new NextRequest("https://pikas.test/api/platform/sandbox/reset", { method: "POST", headers: { origin: "https://pikas.test", "Content-Type": "application/json", "Idempotency-Key": k }, body: JSON.stringify(body) }));
const result = { request_id: key, account_id: sandbox, baseline: "horizonte-v1", deleted: { purchases: 2, people_retired: 2 }, seeded: { students: 4 }, auth_user_ids: [authA, authB], reset_at: "2026-10-23T12:00:00Z" };
beforeEach(() => { vi.resetAllMocks(); mocks.identity.mockResolvedValue(operator(["platform:sandbox:manage", "platform:sandbox:pov:enter"])); mocks.demo.mockResolvedValue(null); mocks.deleteUser.mockResolvedValue({ data: {}, error: null }); });

describe("sandbox reset route", () => {
  it("resets through platform_reset_sandbox and purges the returned Auth users with the service role", async () => {
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    const r = await post({ accountId: sandbox }); expect(r.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("platform_reset_sandbox", { p_request_id: key, p_account_id: sandbox });
    expect(mocks.deleteUser.mock.calls.map(c => c[0])).toEqual([authA, authB]);
    expect((await r.json()).result).toMatchObject({ baseline: "horizonte-v1", auth_purged: 2, auth_failed: 0 });
  });
  it("a failed Auth purge is reported, never hidden, and never undoes the reset", async () => {
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    mocks.deleteUser.mockResolvedValueOnce({ data: null, error: { message: "boom" } }).mockResolvedValueOnce({ data: null, error: { message: "User not found" } });
    const r = await post({ accountId: sandbox }); expect(r.status).toBe(200); expect((await r.json()).result).toMatchObject({ auth_purged: 1, auth_failed: 1 });
  });
  it("needs platform:sandbox:manage (Demo access alone is not enough), refuses Demo mode and cross origin before any call", async () => {
    mocks.identity.mockResolvedValue(operator(["platform:sandbox:pov:enter", "platform:tenant:lifecycle:manage"]));
    expect((await post({ accountId: sandbox })).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.identity.mockResolvedValue(operator(["platform:sandbox:manage"])); mocks.demo.mockResolvedValue({ error: "demo_mode_active", status: 403 });
    expect(await (await post({ accountId: sandbox })).json()).toEqual({ error: "demo_mode_active" }); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.demo.mockResolvedValue(null);
    const cross = await POST(new NextRequest("https://pikas.test/api/platform/sandbox/reset", { method: "POST", headers: { origin: "https://evil.invalid", "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ accountId: sandbox }) }));
    expect(cross.status).toBe(403);
    expect((await post({ accountId: sandbox, purge: true })).status).toBe(400); expect((await post({ accountId: sandbox }, "not-a-uuid")).status).toBe(400);
  });
  it("database refusals keep their meaning: a real customer, a current POV, a reused key, an invalid result", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "sandbox_required" } });
    let r = await post({ accountId: sandbox }); expect(r.status).toBe(403); expect(await r.json()).toEqual({ error: "sandbox_required" }); expect(mocks.deleteUser).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "demo_mode_active" } });
    r = await post({ accountId: sandbox }); expect(r.status).toBe(403); expect(await r.json()).toEqual({ error: "demo_mode_active" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not_authorized" } }); expect((await post({ accountId: sandbox })).status).toBe(403);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "platform_request_conflict" } }); expect((await post({ accountId: sandbox })).status).toBe(409);
    mocks.rpc.mockResolvedValueOnce({ data: { ...result, account_id: U(3) }, error: null }); expect((await post({ accountId: sandbox })).status).toBe(502); expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
