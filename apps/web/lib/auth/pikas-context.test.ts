import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  backofficeHome,
  hasAppRole,
  pilotHome,
  resolvePikasIdentity,
  type PikasIdentity,
} from "./pikas-context";
import type { SupabaseClient } from "@supabase/supabase-js";

const activePerson = {
  id: "person-id",
  displayName: "Edwin",
};

const tenantMembership = {
  id: "membership-id",
  accountId: "account-id",
  schoolId: null,
  cafeteriaId: null,
  roleCode: "account_admin" as const,
  scopeKind: "account" as const,
};

function readyIdentity(
  memberships: Extract<PikasIdentity, { status: "ready" }>["memberships"],
  platform: Extract<PikasIdentity, { status: "ready" }>["platform"],
): Extract<PikasIdentity, { status: "ready" }> {
  return {
    status: "ready",
    user: { id: "auth-user-id" } as Extract<PikasIdentity, { status: "ready" }>["user"],
    person: activePerson,
    memberships,
    platform,
  };
}

describe("authenticated login destination", () => {
  it("keeps an active tenant-only user on the existing pilot destination", () => {
    expect(pilotHome(readyIdentity([tenantMembership], null))).toBe(
      "/pilot/connected",
    );
  });

  it("does not route a platform-only administrator through public tenant login", () => {
    const identity = readyIdentity([], {
      role: "platform_admin",
      capabilities: ["platform:audit:read"],
    });

    expect(pilotHome(identity)).toBeNull();
    expect(backofficeHome(identity)).toBe("/platform");
    expect(identity.memberships).toEqual([]);
    expect(hasAppRole(identity, "school_admin")).toBe(false);
    expect(hasAppRole(identity, "cafeteria_admin")).toBe(false);
    expect(hasAppRole(identity, "pos_operator")).toBe(false);
  });

  it("denies an active person with neither tenant nor platform authority", () => {
    const identity = readyIdentity([], null);
    expect(pilotHome(identity)).toBeNull();
    expect(backofficeHome(identity)).toBeNull();
  });

  it("preserves the tenant destination when tenant and platform authority coexist", () => {
    expect(
      pilotHome(
        readyIdentity([tenantMembership], {
          role: "platform_admin",
          capabilities: ["platform:audit:read"],
        }),
      ),
    ).toBe("/pilot/connected");
    expect(
      backofficeHome(
        readyIdentity([tenantMembership], {
          role: "platform_admin",
          capabilities: ["platform:audit:read"],
        }),
      ),
    ).toBe("/platform");
  });

  it("denies inactive or invalid identities", () => {
    expect(
      pilotHome({
        status: "unlinked",
        user: { id: "auth-user-id" } as Extract<
          PikasIdentity,
          { status: "unlinked" }
        >["user"],
        person: null,
        memberships: [],
        platform: null,
      }),
    ).toBeNull();
    expect(
      backofficeHome({
        status: "unlinked",
        user: { id: "auth-user-id" } as Extract<
          PikasIdentity,
          { status: "unlinked" }
        >["user"],
        person: null,
        memberships: [],
        platform: null,
      }),
    ).toBeNull();

    expect(
      pilotHome({
        status: "unauthenticated",
        user: null,
        person: null,
        memberships: [],
        platform: null,
      }),
    ).toBeNull();
  });

  it("resolves an inactive Person as unlinked and denies login", async () => {
    const personQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    personQuery.select.mockReturnValue(personQuery);
    personQuery.eq.mockReturnValue(personQuery);
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "auth-user-id" } },
          error: null,
        }),
      },
      from: vi.fn(() => personQuery),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    const identity = await resolvePikasIdentity(supabase);

    expect(personQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(identity.status).toBe("unlinked");
    expect(pilotHome(identity)).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
