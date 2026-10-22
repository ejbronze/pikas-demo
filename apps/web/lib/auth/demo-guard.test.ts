import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn() }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.identity }));
import { demoMutationBlock } from "./demo-guard";
const id = "5c300000-0000-4000-8000-000000000001";
const operator = (capabilities: string[]) => ({ status: "ready", user: { id: "u" }, person: { id: "p", displayName: "Operadora" }, memberships: [], platform: { role: "platform_admin", roles: ["platform_admin"], capabilities } }) as never;
const tenant = { status: "ready", user: { id: "u" }, person: { id: "p", displayName: "Directora" }, memberships: [{ id, scope_kind: "school", role_code: "school_admin" }], platform: null } as never;
const active = (expires = "2030-01-01T00:00:00Z") => ({ session_id: id, account_id: id, account_name: "Colegio Horizonte", school_id: id, cafeteria_id: id, cafeteria_name: "Cafetería Escolar", pov_code: "cashier", persona_display_name: "José", expires_at: expires });
const client = (pov: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data: pov, error })) }) as never;
describe("UX 11 Demo mutation guard", () => {
  it("1. no POV → no block", async () => { expect(await demoMutationBlock(client(null), operator(["platform:sandbox:pov:enter"]))).toBeNull(); });
  it("2. current POV → refused with a stable outcome", async () => { expect(await demoMutationBlock(client(active()), operator(["platform:sandbox:pov:enter"]))).toEqual({ error: "demo_mode_active", status: 403 }); });
  it("3. expired POV → no block", async () => { expect(await demoMutationBlock(client(active("2020-01-01T00:00:00Z")), operator(["platform:sandbox:pov:enter"]))).toBeNull(); });
  it("5. an operator without Demo access is never blocked and never asks", async () => { const c = client(active()); expect(await demoMutationBlock(c, operator(["platform:team:manage"]))).toBeNull(); expect((c as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled(); });
  it("tenant users (no Platform context) are never affected", async () => { const c = client(active()); expect(await demoMutationBlock(c, tenant)).toBeNull(); expect((c as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled(); });
  it("resolves the identity itself when a route has none", async () => { mocks.identity.mockResolvedValue(operator(["platform:sandbox:pov:enter"])); expect(await demoMutationBlock(client(active()))).toEqual({ error: "demo_mode_active", status: 403 }); });
  it("fails closed when the Demo state or the identity cannot be established", async () => {
    expect(await demoMutationBlock(client(null, { code: "XX000" }), operator(["platform:sandbox:pov:enter"]))).toEqual({ error: "authorization_unavailable", status: 503 });
    mocks.identity.mockRejectedValue(new Error("down")); expect(await demoMutationBlock(client(null))).toEqual({ error: "authorization_unavailable", status: 503 });
  });
});
