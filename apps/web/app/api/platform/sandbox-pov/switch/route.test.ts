import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), identity: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: m.identity }));
import { POST } from "./route";
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const key = id(90);
const target = { account_id: id(1), school_id: id(2), cafeteria_id: id(3), account_name: "Demo", cafeteria_name: "Café", persona_display_name: "Ficción", pov_code: "school_admin" };
const active = { ...target, session_id: id(4), expires_at: "2099-01-01T00:00:00Z" };
const operator = { status: "ready", person: { id: id(7) }, platform: { capabilities: ["platform:sandbox:pov:enter"] } };
function request(body: unknown, origin = "http://localhost:3000", requestKey: string | null = key) {
  return POST(new NextRequest("http://localhost:3000/api/platform/sandbox-pov/switch", { method: "POST", headers: { origin, "Content-Type": "application/json", ...(requestKey ? { "Idempotency-Key": requestKey } : {}) }, body: JSON.stringify(body) }));
}
let current: unknown, targets: unknown;
beforeEach(() => {
  vi.clearAllMocks(); current = active;
  targets = [target, { ...target, pov_code: "cafeteria_admin" }, { ...target, pov_code: "cashier" }];
  m.identity.mockResolvedValue(operator);
  m.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "platform_get_active_sandbox_pov" ? current : name === "platform_list_sandbox_pov_targets" ? targets : { session_id: id(8), persona_person_id: id(9) } }));
});
describe("strict Demo switch", () => {
  it.each([["school", "school_admin", `/admin/escuela?school=${id(2)}`], ["cafeteria", "cafeteria_admin", `/admin/cafeteria?cafeteria=${id(3)}`], ["pos", "cashier", "/pos"]])("resolves %s server-side and reuses audited supersession", async (experience, code, destination) => {
    const response = await request({ experience }); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { destination, session_id: id(8) } });
    expect(m.rpc).toHaveBeenLastCalledWith("platform_enter_sandbox_pov", { p_request_id: key, p_account_id: id(1), p_cafeteria_id: id(3), p_pov_code: code });
    expect(operator.person.id).toBe(id(7)); // never replaced with the returned persona
  });
  it.each([{ experience: "parent" }, { experience: "cashier" }, { experience: "school", personaId: id(20) }, { experience: "pos", tenantId: id(20) }, { experience: "pos", cafeteriaId: id(20) }, { experience: "pos", destination: "https://evil.test" }])("rejects unsupported/client scope fields %j", async body => { expect((await request(body)).status).toBe(400); expect(m.rpc).not.toHaveBeenCalled(); });
  it.each([{ status: "unauthenticated" }, { status: "ready", platform: null }, { status: "ready", platform: { capabilities: ["platform:tenant:provision"] } }])("denies missing operator capability", async identity => { m.identity.mockResolvedValue(identity); expect((await request({ experience: "pos" })).status).toBe(identity.status === "unauthenticated" ? 401 : 403); expect(m.rpc).not.toHaveBeenCalled(); });
  it("requires origin and request key", async () => { expect((await request({ experience: "pos" }, "https://evil.test")).status).toBe(403); expect((await request({ experience: "pos" }, undefined, null)).status).toBe(400); expect(m.rpc).not.toHaveBeenCalled(); });
  it("never escapes the active account/cafeteria even if another target exists", async () => { targets = [{ ...target, pov_code: "cashier", cafeteria_id: id(30) }]; expect((await request({ experience: "pos" })).status).toBe(403); expect(m.rpc).not.toHaveBeenCalledWith("platform_enter_sandbox_pov", expect.anything()); });
  it("initial entry requires exactly one environment", async () => { current = null; expect((await request({ experience: "pos" })).status).toBe(200); targets = [target, { ...target, account_id: id(40) }]; expect((await request({ experience: "school" })).status).toBe(403); });
  it("rejects expired, duplicate and malformed targets", async () => { current = { ...active, expires_at: "2000-01-01T00:00:00Z" }; expect((await request({ experience: "school" })).status).toBe(403); current = active; targets = [target, target]; expect((await request({ experience: "school" })).status).toBe(403); targets = [{}]; expect((await request({ experience: "school" })).status).toBe(403); });
  it("never assumes RPC rejection succeeded", async () => { m.rpc.mockImplementation(async (name: string) => name === "platform_enter_sandbox_pov" ? { error: { code: "42501" }, data: null } : { error: null, data: name === "platform_get_active_sandbox_pov" ? active : targets }); expect((await request({ experience: "pos" })).status).toBe(403); });
});
