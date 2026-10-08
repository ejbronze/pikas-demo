import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  backofficeHome,
  isDemoMode,
  resolvePikasIdentity,
  signInWithPassword,
  signOut,
} = vi.hoisted(() => ({
  backofficeHome: vi.fn(),
  isDemoMode: vi.fn(),
  resolvePikasIdentity: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isDemoMode }));
vi.mock("@/lib/auth/pikas-context", () => ({
  backofficeHome,
  resolvePikasIdentity,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { signInWithPassword, signOut },
  })),
}));

import { POST } from "./route";

const postCredentials = () => {
  const form = new FormData();
  form.set("identifier", "operator@example.com");
  form.set("password", "password");
  return POST(
    new NextRequest("https://pikas-pikas.app/api/auth/backoffice-login", {
      method: "POST",
      body: form,
    }),
  );
};

describe("private backoffice login route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDemoMode.mockReturnValue(false);
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "auth-user-id" } },
      error: null,
    });
    signOut.mockResolvedValue({ error: null });
    resolvePikasIdentity.mockResolvedValue({
      status: "ready",
      user: { id: "auth-user-id" },
      person: { id: "person-id", displayName: "Platform Operator" },
      memberships: [],
      platform: {
        role: "platform_admin",
        capabilities: ["platform:audit:read"],
      },
    });
    backofficeHome.mockReturnValue("/platform");
  });

  it("allows an active platform-only identity without tenant memberships", async () => {
    const response = await postCredentials();

    expect(resolvePikasIdentity).toHaveBeenCalledOnce();
    expect(backofficeHome).toHaveBeenCalledWith(
      expect.objectContaining({ memberships: [] }),
    );
    expect(response.headers.get("location")).toBe(
      "https://pikas-pikas.app/platform",
    );
    expect(signOut).not.toHaveBeenCalled();
  });

  it("denies an authenticated tenant-only user and clears the Auth session", async () => {
    resolvePikasIdentity.mockResolvedValue({
      status: "ready",
      user: { id: "auth-user-id" },
      person: { id: "person-id", displayName: "Tenant User" },
      memberships: [
        {
          id: "tenant-membership",
          roleCode: "account_admin",
          scopeKind: "account",
        },
      ],
      platform: null,
    });
    backofficeHome.mockReturnValue(null);

    const response = await postCredentials();

    expect(response.headers.get("location")).toBe(
      "https://pikas-pikas.app/backoffice/login?error=platform",
    );
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("denies identities without a linked active Person", async () => {
    resolvePikasIdentity.mockResolvedValue({
      status: "unlinked",
      user: { id: "auth-user-id" },
      person: null,
      memberships: [],
      platform: null,
    });
    backofficeHome.mockReturnValue(null);

    const response = await postCredentials();

    expect(response.headers.get("location")).toBe(
      "https://pikas-pikas.app/backoffice/login?error=identity",
    );
    expect(signOut).toHaveBeenCalledOnce();
  });
});
