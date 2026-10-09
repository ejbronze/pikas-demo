import { beforeEach, describe, expect, it, vi } from "vitest";
import { posContext } from "../pos/access-context.test-fixtures";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), rpc: vi.fn(), demo: vi.fn(), client: vi.fn(), role: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

import { requirePosAccess, resolvePosAccess } from "./pos-access";

const client = { auth: { getUser: mocks.getUser }, rpc: mocks.rpc } as unknown as Parameters<typeof resolvePosAccess>[0];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.client.mockResolvedValue(client);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "initiator-auth" } }, error: null });
  mocks.rpc.mockResolvedValue({ data: posContext(), error: null });
});

describe("authoritative POS access", () => {
  it.each([true, false])("resolves sandbox=%s without sending authority arguments", async (sandbox) => {
    const context = posContext(sandbox);
    mocks.rpc.mockResolvedValue({ data: context, error: null });
    expect(await resolvePosAccess(client)).toEqual({ status: "authorized", context });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_pos_access_context");
  });
  it("does not query context without an Auth session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await resolvePosAccess(client)).toEqual({ status: "unauthenticated" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("recognizes missing-session errors", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    expect(await resolvePosAccess(client)).toEqual({ status: "unauthenticated" });
  });
  it("fails closed on Auth verification errors", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u" } }, error: { name: "AuthApiError" } });
    expect(await resolvePosAccess(client)).toEqual({ status: "unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("denies a platform operator with no effective POS authority", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await resolvePosAccess(client)).toEqual({ status: "forbidden" });
  });
  it.each([["42501", "forbidden"], ["PGRST202", "unavailable"]])("fails closed on RPC error %s", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    expect(await resolvePosAccess(client)).toEqual({ status });
  });
  it("fails closed if the RPC throws", async () => {
    mocks.rpc.mockRejectedValue(new Error("offline"));
    expect(await resolvePosAccess(client)).toEqual({ status: "unavailable" });
  });
  it.each([
    { ...posContext(), memberships: [] },
    { ...posContext(), memberships: [{ ...posContext().memberships[0], role_code: "platform_admin" }] },
    { ...posContext(), memberships: [{ ...posContext().memberships[0], tenant_kind: "customer" }] },
    { ...posContext(), memberships: [...posContext().memberships, ...posContext().memberships] },
    { ...posContext(), actor: { person_id: "not-a-uuid", display_name: "Fake" } },
    { ...posContext(), pov: { ...posContext().pov!, expires_at: "2000-01-01T00:00:00Z" } },
  ])("rejects malformed, conflicting or expired context %#", async (context) => {
    mocks.rpc.mockResolvedValue({ data: context, error: null });
    expect(await resolvePosAccess(client)).toEqual({ status: "unavailable" });
  });
  it("revalidates the DB on every call instead of caching POV authority", async () => {
    expect((await resolvePosAccess(client)).status).toBe("authorized");
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await resolvePosAccess(client)).status).toBe("forbidden");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});

describe("server page gate", () => {
  it("passes authoritative connected context to the page", async () => {
    expect(await requirePosAccess()).toEqual({ demo: false, context: posContext() });
  });
  it("preserves the existing demo-role gate", async () => {
    mocks.demo.mockReturnValue(true);
    expect(await requirePosAccess()).toEqual({ demo: true, context: null });
    expect(mocks.role).toHaveBeenCalledExactlyOnceWith("pos_operator");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("redirects anonymous page access to login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requirePosAccess()).rejects.toThrow("redirect:/login?next=%2Fpos");
  });
  it("denies page access without POS authority", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(requirePosAccess()).rejects.toThrow("redirect:/login?error=pos_authority");
  });
  it("does not render a connected page while authorization is unavailable", async () => {
    mocks.rpc.mockRejectedValue(new Error("offline"));
    await expect(requirePosAccess()).rejects.toThrow("redirect:/login?error=pos_unavailable");
  });
});
