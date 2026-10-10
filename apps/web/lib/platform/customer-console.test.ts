import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn(), identity: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(path); }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.identity, hasPlatformAuthority: (identity: { platform?: unknown }) => Boolean(identity.platform) }));
import { requirePlatform, readPlatform } from "./customer-console";
const identity = { status: "ready", user: { id: "real-operator" }, person: { id: "operator-person", displayName: "Operador" }, memberships: [], platform: { capabilities: ["platform:tenant:lifecycle:read"] } };
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.identity.mockResolvedValue(identity); });
describe("platform server customer access", () => {
  it("fails closed with a safe login message when authorization is unavailable", async () => {
    mocks.identity.mockRejectedValue(new Error("private backend detail"));
    await expect(requirePlatform()).rejects.toThrow("/backoffice/login?error=platform_unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses the real authenticated operator", async () => { const session = await requirePlatform(); expect(session.identity.user.id).toBe("real-operator"); expect(session.identity.person.id).toBe("operator-person"); });
  it.each([{ status: "unauthenticated" }, { status: "unlinked" }, { ...identity, platform: null }])("fails closed for invalid identity %j", async (value) => { mocks.identity.mockResolvedValue(value); await expect(requirePlatform()).rejects.toThrow("/backoffice/login"); });
  it("sandbox capability alone cannot list customers and does not call the RPC", async () => {
    mocks.identity.mockResolvedValue({ ...identity, platform: { capabilities: ["platform:sandbox:pov:enter"] } });
    expect(await readPlatform(await requirePlatform(), "platform:tenant:lifecycle:read", "platform_list_customers", {}, z.array(z.string()))).toEqual({ kind: "forbidden" }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ error: { code: "42501" }, data: null, kind: "forbidden" }, { error: { code: "P0002" }, data: null, kind: "missing" }, { error: null, data: {}, kind: "unavailable" }])("validates read response and maps failures %j", async ({ error, data, kind }) => {
    mocks.rpc.mockResolvedValue({ error, data }); expect(await readPlatform(await requirePlatform(), "platform:tenant:lifecycle:read", "platform_list_customers", {}, z.array(z.string()))).toEqual({ kind });
  });
  it("accepts intentional empty list and catches server errors", async () => {
    const session = await requirePlatform(); mocks.rpc.mockResolvedValue({ error: null, data: [] }); expect(await readPlatform(session, "platform:tenant:lifecycle:read", "platform_list_customers", {}, z.array(z.string()))).toEqual({ kind: "ready", value: [] });
    mocks.rpc.mockRejectedValue(new Error("network")); expect(await readPlatform(session, "platform:tenant:lifecycle:read", "platform_list_customers", {}, z.array(z.string()))).toEqual({ kind: "unavailable" });
  });
});
