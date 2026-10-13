import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } }) }));
import { POST } from "./route";
const sid = "00000000-0000-4000-8000-000000000001";
const request = (body: unknown, origin = "https://pikas.test") => new NextRequest("https://pikas.test/api/auth/session", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: sid } }, error: null }); mocks.rpc.mockResolvedValue({ error: { code: "42501", message: "application_session_expired" } }); });
it("rejects timestamps and cross-origin activity before any RPC", async () => {
  expect((await POST(request({ action: "activity", surface: "admin", session_id: sid, last_active_at: "2099-01-01" }))).status).toBe(400);
  expect((await POST(request({ action: "status", surface: "admin" }, "https://attacker.test"))).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not let activity proceed without an exact expected session", async () => expect((await POST(request({ action: "activity", surface: "admin" }))).status).toBe(400));
it("status does not call activity or implicitly start a session", async () => {
  expect((await POST(request({ action: "status", surface: "pos", session_id: sid }))).status).toBe(401);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("pikas_session_status", { p_expected_session_id: sid, p_pos: true });
});
it("stale tabs get conflict rather than touching replacement session", async () => { mocks.rpc.mockResolvedValue({ error: { code: "PT409", message: "authentication_session_changed" } }); expect((await POST(request({ action: "activity", surface: "admin", session_id: sid }))).status).toBe(409); });
