import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), identity: vi.fn(), headers: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.identity, hasPlatformAuthority: (i: { platform: { capabilities: string[] } | null }) => !!i.platform && i.platform.capabilities.length > 0 }));
import { readActiveDemo, requirePlatform } from "./customer-console";

const operator = (capabilities: string[]) => ({ status: "ready", user: { id: "u" }, person: { id: "p", displayName: "Operadora ficticia" }, memberships: [], platform: { role: "platform_admin", roles: ["platform_admin"], capabilities } });
const caps = ["platform:tenant:lifecycle:read", "platform:customer:operations:read", "platform:sandbox:pov:enter"];
const active = (expires = "2030-01-01T00:00:00Z") => ({ session_id: "5c300000-0000-4000-8000-000000000001", account_id: "5c300000-0000-4000-8000-000000000002", account_name: "Colegio Horizonte",
  school_id: "5c300000-0000-4000-8000-000000000003", cafeteria_id: "5c300000-0000-4000-8000-000000000004", cafeteria_name: "Cafetería Escolar", pov_code: "cafeteria_admin", persona_display_name: "Marta Demo", expires_at: expires });
class Redirected extends Error { constructor(public to: string) { super("NEXT_REDIRECT"); } }
beforeEach(() => { vi.resetAllMocks(); mocks.identity.mockResolvedValue(operator(caps)); mocks.headers.mockResolvedValue(new Headers({ "x-pikas-url": "/platform/clientes?q=norte" })); mocks.redirect.mockImplementation((to: string) => { throw new Redirected(to); }); });

describe("UX 11 mode resolution (server)", () => {
  it("1. no current POV → normal Platform mode", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const session = await requirePlatform(); expect(session.demo).toBeNull(); expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("platform_get_active_sandbox_pov");
  });
  it("2. current POV → Demo mode: a real route is intercepted with the validated requested path", async () => {
    mocks.rpc.mockResolvedValue({ data: active(), error: null });
    await expect(requirePlatform()).rejects.toMatchObject({ to: "/platform/demostracion/salir?next=%2Fplatform%2Fclientes%3Fq%3Dnorte" });
    const allowed = await requirePlatform({ demo: "allow" });
    expect(allowed.demo).toMatchObject({ povCode: "cafeteria_admin", accountName: "Colegio Horizonte", cafeteriaName: "Cafetería Escolar", personaName: "Marta Demo" });
  });
  it("3. expired POV → normal Platform mode (never traps the operator)", async () => {
    mocks.rpc.mockResolvedValue({ data: active("2020-01-01T00:00:00Z"), error: null });
    expect((await requirePlatform()).demo).toBeNull(); expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("4. exited POV → the resolver returns nothing → normal mode", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await requirePlatform({ demo: "allow" })).demo).toBeNull();
  });
  it("5. Demo state is read for the authenticated operator only, and only when that operator can use Demo", async () => {
    mocks.identity.mockResolvedValue(operator(["platform:tenant:lifecycle:read"]));
    mocks.rpc.mockResolvedValue({ data: active(), error: null });
    expect((await requirePlatform()).demo).toBeNull(); expect(mocks.rpc).not.toHaveBeenCalledWith("platform_get_active_sandbox_pov");
    const state = await readActiveDemo({ rpc: mocks.rpc } as never, operator(caps) as never); expect(state.kind).toBe("active");
  });
  it("an unavailable resolver grants nothing and does not pretend Demo is active", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    expect((await requirePlatform()).demo).toBeNull();
    expect((await readActiveDemo({ rpc: mocks.rpc } as never, operator(caps) as never)).kind).toBe("unknown");
  });
  it("an unsafe or missing requested path falls back to the Platform home", async () => {
    mocks.rpc.mockResolvedValue({ data: active(), error: null });
    mocks.headers.mockResolvedValue(new Headers({ "x-pikas-url": "https://evil.invalid/platform" }));
    await expect(requirePlatform()).rejects.toMatchObject({ to: "/platform/demostracion/salir" });
    mocks.headers.mockResolvedValue(new Headers());
    await expect(requirePlatform()).rejects.toMatchObject({ to: "/platform/demostracion/salir" });
  });
});
