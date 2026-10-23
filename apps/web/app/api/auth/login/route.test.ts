import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isDemoMode, pilotHome, resolvePikasIdentity, signInWithPassword, signOut, rpc, serviceRpc } =
  vi.hoisted(() => ({
    serviceRpc: vi.fn(),
    isDemoMode: vi.fn(),
    pilotHome: vi.fn(),
    resolvePikasIdentity: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    rpc: vi.fn(),
  }));

vi.mock("@/lib/env", () => ({ isDemoMode }));
vi.mock("@/lib/auth/pikas-context", () => ({
  pilotHome,
  resolvePikasIdentity,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { signInWithPassword, signOut }, rpc,
  })),
}));

vi.mock("@/lib/auth/activation", () => ({ invitationProvider: () => ({ rpc: serviceRpc }) }));

import { POST } from "./route";

const activeTenantIdentity = {
  status: "ready",
  user: { id: "auth-user-id" },
  person: { id: "person-id", displayName: "Tenant User" },
  memberships: [
    {
      id: "tenant-membership",
      accountId: "account-id",
      schoolId: null,
      cafeteriaId: null,
      roleCode: "account_admin",
      scopeKind: "account",
    },
  ],
  platform: null,
};

describe("public tenant login route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDemoMode.mockReturnValue(false);
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "auth-user-id" } },
      error: null,
    });
    rpc.mockResolvedValue({data: {}, error: null});
    signOut.mockResolvedValue({ error: null });
    resolvePikasIdentity.mockResolvedValue(activeTenantIdentity);
    pilotHome.mockReturnValue("/pilot/connected");
  });

  it("keeps an active tenant user on the existing tenant destination without a role field", async () => {
    const form = new FormData();
    form.set("identifier", "tenant@example.com");
    form.set("password", "password");

    const response = await POST(
      new NextRequest("https://pikas-pikas.app/api/auth/login", {
        method: "POST",
        body: form,
      }),
    );

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "tenant@example.com",
      password: "password",
    });
    expect(response.headers.get("location")).toBe(
      "https://pikas-pikas.app/pilot/connected",
    );
    expect(signOut).not.toHaveBeenCalled();
  });

  it("denies platform-only users on public tenant login and signs them out", async () => {
    resolvePikasIdentity.mockResolvedValue({
      ...activeTenantIdentity,
      memberships: [],
      platform: {
        role: "platform_admin",
    roles: ["platform_admin"],
        capabilities: ["platform:audit:read"],
      },
    });
    pilotHome.mockReturnValue(null);

    const form = new FormData();
    form.set("identifier", "operator@example.com");
    form.set("password", "password");

    const response = await POST(
      new NextRequest("https://pikas-pikas.app/api/auth/login", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://pikas-pikas.app/login?error=membership",
    );
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("returns a credentials error for invalid passwords", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: new Error("invalid credentials"),
    });
    const form = new FormData();
    form.set("identifier", "tenant@example.com");
    form.set("password", "incorrect");

    const response = await POST(
      new NextRequest("https://pikas-pikas.app/api/auth/login", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://pikas-pikas.app/login?error=credentials",
    );
    expect(resolvePikasIdentity).not.toHaveBeenCalled();
  });

  const login = (identifier: string, password = "password") => {
    const form = new FormData(); form.set("identifier", identifier); form.set("password", password);
    return POST(new NextRequest("https://pikas-pikas.app/api/auth/login", { method: "POST", body: form }));
  };

  it("Phase 6A: a username resolves server-side to the same Auth email and lands like an email login", async () => {
    serviceRpc.mockResolvedValue({ data: "cajera@example.com", error: null });
    const byUsername = await login("  Cajera.Norte ");
    expect(serviceRpc).toHaveBeenCalledWith("login_identifier_email", { p_username: "cajera.norte" });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "cajera@example.com", password: "password" });
    expect(byUsername.headers.get("location")).toBe("https://pikas-pikas.app/pilot/connected");
    signInWithPassword.mockClear();
    const byEmail = await login("cajera@example.com");
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "cajera@example.com", password: "password" });
    expect(byEmail.headers.get("location")).toBe(byUsername.headers.get("location"));
    expect(serviceRpc).toHaveBeenCalledOnce();
  });

  it("Phase 6A: unknown or malformed identifiers answer exactly like a wrong password (no enumeration)", async () => {
    serviceRpc.mockResolvedValue({ data: null, error: null });
    for (const identifier of ["nadie.aqui", "a..b", "x@y", "UPPER CASE"]) {
      const response = await login(identifier);
      expect(response.headers.get("location")).toBe("https://pikas-pikas.app/login?error=credentials");
    }
    expect(serviceRpc).toHaveBeenCalledOnce();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("Phase 6A: a suspended login is signed out with the generic credentials error", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "identity_credential_state" ? { login_suspended: true, must_change_password: false } : {}, error: null }));
    const response = await login("tenant@example.com");
    expect(response.headers.get("location")).toBe("https://pikas-pikas.app/login?error=credentials");
    expect(signOut).toHaveBeenCalledOnce();
    expect(rpc.mock.calls.map(c => c[0])).toEqual(["pikas_session_start", "identity_credential_state"]);
    expect(resolvePikasIdentity).not.toHaveBeenCalled();
  });

  it("Phase 6A: a temporary password leads to the forced change, not the workspace", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "identity_credential_state" ? { login_suspended: false, must_change_password: true } : {}, error: null }));
    const response = await login("tenant@example.com");
    expect(response.headers.get("location")).toBe("https://pikas-pikas.app/actualizar-contrasena?motivo=temporal");
    expect(rpc).toHaveBeenCalledWith("pikas_session_start");
    expect(resolvePikasIdentity).not.toHaveBeenCalled();
  });
  it("UX 12B closure: the database refusing to start a session for an expired temporary password maps to the same explanation", async () => {
    rpc.mockImplementation(async (name: string) => name === "pikas_session_start" ? { data: null, error: { code: "42501", message: "temporary_access_expired" } } : { data: {}, error: null });
    const response = await login("tenant@example.com");
    expect(response.headers.get("location")).toBe("https://pikas-pikas.app/login?error=temporary_expired"); expect(signOut).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("identity_credential_state");
  });
  it("UX 12B closure: an expired temporary password is refused with its own explanation and the Auth session is dropped", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "identity_credential_state" ? { login_suspended: false, must_change_password: true, temporary_expired: true } : {}, error: null }));
    const response = await login("tenant@example.com");
    expect(response.headers.get("location")).toBe("https://pikas-pikas.app/login?error=temporary_expired"); expect(signOut).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("pikas_session_start");
    expect(resolvePikasIdentity).not.toHaveBeenCalled();
  });

  it("customer lifecycle: an authenticated user of a suspended organization sees that, not a credentials or role error", async () => {
    resolvePikasIdentity.mockResolvedValue({ ...activeTenantIdentity, memberships: [] }); pilotHome.mockReturnValue(null);
    rpc.mockImplementation(async (name: string) => ({ data: name === "tenant_lifecycle_state" ? "suspended" : {}, error: null }));
    const response = await login("tenant@example.com");
    expect(response.headers.get("location")).toBe("https://pikas-pikas.app/login?error=organization_suspended"); expect(signOut).toHaveBeenCalledOnce();
    rpc.mockImplementation(async (name: string) => ({ data: name === "tenant_lifecycle_state" ? "closed" : {}, error: null }));
    expect((await login("tenant@example.com")).headers.get("location")).toBe("https://pikas-pikas.app/login?error=organization_closed");
  });
});
