import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  backofficeHome,
  hasAppRole,
  hasPlatformAuthority,
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
  it("routes an active account administrator to the school workspace", () => {
    expect(pilotHome(readyIdentity([tenantMembership], null))).toBe(
      "/admin/escuela",
    );
  });

  it("does not route a platform-only administrator through public tenant login", () => {
    const identity = readyIdentity([], {
      role: "platform_admin",
 roles: ["platform_admin"],
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
 roles: ["platform_admin"],
          capabilities: ["platform:audit:read"],
        }),
      ),
    ).toBe("/admin/escuela");
    expect(
      backofficeHome(
        readyIdentity([tenantMembership], {
          role: "platform_admin",
 roles: ["platform_admin"],
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

const adminCaps = [
  "platform:tenant:provision",
  "platform:identity:link",
  "platform:customer_admin:provision",
  "platform:tenant:lifecycle:read",
  "platform:audit:read",
];
const sandboxCap = "platform:sandbox:pov:enter";

function supabaseWithPlatform(platformData: unknown): SupabaseClient {
  const personQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: "person-id", display_name: "Operator" },
      error: null,
    }),
  };
  personQuery.select.mockReturnValue(personQuery);
  personQuery.eq.mockReturnValue(personQuery);
  const membershipQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    then: (resolve: (value: unknown) => unknown) =>
      resolve({ data: [], error: null }),
  };
  membershipQuery.select.mockReturnValue(membershipQuery);
  membershipQuery.eq.mockReturnValue(membershipQuery);
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "auth-user-id" } },
        error: null,
      }),
    },
    from: vi.fn((table: string) =>
      table === "persons" ? personQuery : membershipQuery,
    ),
    rpc: vi.fn().mockResolvedValue({ data: platformData, error: null }),
  } as unknown as SupabaseClient;
}

describe("multi-role platform context", () => {
  it.each([
    [
      "platform_admin",
      { role: "platform_admin", roles: ["platform_admin"], capabilities: adminCaps },
    ],
    [
      "platform_sandbox_operator",
      {
        role: "platform_sandbox_operator",
        roles: ["platform_sandbox_operator"],
        capabilities: [sandboxCap],
      },
    ],
    [
      "dual role",
      {
        role: "platform_admin",
        roles: ["platform_admin", "platform_sandbox_operator"],
        capabilities: [...adminCaps, sandboxCap],
      },
    ],
  ])("parses %s and grants Backoffice access", async (_n, data) => {
    const identity = await resolvePikasIdentity(supabaseWithPlatform(data));
    expect(identity.status).toBe("ready");
    expect(identity.platform).toEqual(data);
    expect(hasPlatformAuthority(identity)).toBe(true);
    expect(backofficeHome(identity)).toBe("/platform");
    expect(pilotHome(identity)).toBeNull();
  });

  it("does not add sandbox authority to platform_admin or admin authority to the sandbox operator", async () => {
    const admin = await resolvePikasIdentity(
      supabaseWithPlatform({
        role: "platform_admin",
        roles: ["platform_admin"],
        capabilities: adminCaps,
      }),
    );
    const sandbox = await resolvePikasIdentity(
      supabaseWithPlatform({
        role: "platform_sandbox_operator",
        roles: ["platform_sandbox_operator"],
        capabilities: [sandboxCap],
      }),
    );
    expect(admin.platform?.capabilities).not.toContain(sandboxCap);
    expect(sandbox.platform?.capabilities).toEqual([sandboxCap]);
  });

  it.each([
    ["unknown role", { role: "root", roles: ["root"], capabilities: ["x"] }],
    ["missing roles", { role: "platform_admin", capabilities: ["x"] }],
    ["empty roles", { role: "platform_admin", roles: [], capabilities: ["x"] }],
    [
      "role not in roles",
      { role: "platform_admin", roles: ["platform_sandbox_operator"], capabilities: ["x"] },
    ],
    [
      "unknown listed role",
      { role: "platform_admin", roles: ["platform_admin", "root"], capabilities: ["x"] },
    ],
    ["missing capabilities", { role: "platform_admin", roles: ["platform_admin"] }],
    [
      "non-string capability",
      { role: "platform_admin", roles: ["platform_admin"], capabilities: [1] },
    ],
    ["non-object", "platform_admin"],
  ])("fails closed on malformed context: %s", async (_n, data) => {
    await expect(
      resolvePikasIdentity(supabaseWithPlatform(data)),
    ).rejects.toThrow("Invalid platform context response");
  });

  it("denies Backoffice to a Person with no platform context or no capabilities", async () => {
    const none = await resolvePikasIdentity(supabaseWithPlatform(null));
    expect(backofficeHome(none)).toBeNull();
    expect(hasPlatformAuthority(none)).toBe(false);
    const empty = readyIdentity([], {
      role: "platform_admin",
      roles: ["platform_admin"],
      capabilities: [],
    });
    expect(backofficeHome(empty)).toBeNull();
  });
});

it("routes explicit cafeteria administrators to their connected workspace",()=>{expect(pilotHome(readyIdentity([{...tenantMembership,scopeKind:"cafeteria",roleCode:"cafeteria_admin",cafeteriaId:"cafeteria-id"}],null))).toBe("/admin/cafeteria");});
