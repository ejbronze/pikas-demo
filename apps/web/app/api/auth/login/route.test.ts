import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isDemoMode, pilotHome, resolvePikasIdentity, signInWithPassword, signOut } =
  vi.hoisted(() => ({
    isDemoMode: vi.fn(),
    pilotHome: vi.fn(),
    resolvePikasIdentity: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  }));

vi.mock("@/lib/env", () => ({ isDemoMode }));
vi.mock("@/lib/auth/pikas-context", () => ({
  pilotHome,
  resolvePikasIdentity,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { signInWithPassword, signOut },
  })),
}));

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
});
