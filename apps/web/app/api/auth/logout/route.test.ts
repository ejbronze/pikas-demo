import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser, signOut: mocks.signOut } }) }));
import { POST } from "./route";
const sid = "00000000-0000-4000-8000-000000000001";
const request = () => new NextRequest("https://pikas.test/api/auth/logout", { method: "POST", headers: { Origin: "https://pikas.test", "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sid }) });
beforeEach(() => { vi.resetAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: sid } }, error: null }); mocks.rpc.mockResolvedValue({ error: null }); mocks.signOut.mockResolvedValue({ error: null }); });
it("ends the exact application session before browser-local Auth logout", async () => { expect((await POST(request())).status).toBe(200); expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("pikas_session_end", { p_expected_session_id: sid }); expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" }); expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]); });
it("never logs out a new cookie session on behalf of an old tab", async () => { mocks.rpc.mockResolvedValue({ error: { code: "PT409", message: "authentication_session_changed" } }); expect((await POST(request())).status).toBe(409); expect(mocks.signOut).not.toHaveBeenCalled(); });

it("an unbound legacy form cannot sign out replacement cookies", async () => { const response=await POST(new NextRequest("https://pikas.test/api/auth/logout",{method:"POST",headers:{Origin:"https://pikas.test"},body:new FormData()}));expect(response.status).toBe(400);expect(mocks.signOut).not.toHaveBeenCalled(); });
