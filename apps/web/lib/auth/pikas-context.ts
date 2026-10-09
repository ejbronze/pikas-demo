import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

export type PikasRole =
  | "account_admin"
  | "school_admin"
  | "cafeteria_admin"
  | "pos_cashier"
  | "pos_supervisor";

export type PikasMembership = {
  id: string;
  accountId: string;
  schoolId: string | null;
  cafeteriaId: string | null;
  roleCode: PikasRole;
  scopeKind: "account" | "school" | "cafeteria";
};

export type PikasPlatformRole = "platform_admin" | "platform_sandbox_operator";

export type PikasPlatformContext = {
  role: PikasPlatformRole;
  roles: PikasPlatformRole[];
  capabilities: string[];
};

const platformRoleCodes = new Set<string>([
  "platform_admin",
  "platform_sandbox_operator",
]);

function isPlatformRole(value: unknown): value is PikasPlatformRole {
  return typeof value === "string" && platformRoleCodes.has(value);
}

export type PikasIdentity =
  | {
      status: "unauthenticated";
      user: null;
      person: null;
      memberships: [];
      platform: null;
    }
  | {
      status: "unlinked";
      user: User;
      person: null;
      memberships: [];
      platform: null;
    }
  | {
      status: "ready";
      user: User;
      person: { id: string; displayName: string };
      memberships: PikasMembership[];
      platform: PikasPlatformContext | null;
    };

const roleCodes = new Set<PikasRole>([
  "account_admin",
  "school_admin",
  "cafeteria_admin",
  "pos_cashier",
  "pos_supervisor",
]);

export async function resolvePikasIdentity(
  supabase: SupabaseClient,
): Promise<PikasIdentity> {
  let user: User | null;
  try {
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError) throw authError;
    user = authUser;
  } catch (error) {
    if (error instanceof Error && error.name === "AuthSessionMissingError") {
      return {
        status: "unauthenticated",
        user: null,
        person: null,
        memberships: [],
        platform: null,
      };
    }
    throw error;
  }

  if (!user) {
    return {
      status: "unauthenticated",
      user: null,
      person: null,
      memberships: [],
      platform: null,
    };
  }

  const { data: person, error: personError } = await supabase
    .from("persons")
    .select("id,display_name")
    .eq("auth_user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (personError) throw personError;
  if (!person) {
    return {
      status: "unlinked",
      user,
      person: null,
      memberships: [],
      platform: null,
    };
  }

  const [accountResult, schoolResult, cafeteriaResult] = await Promise.all([
    supabase
      .from("account_memberships")
      .select("id,account_id,role_code")
      .eq("person_id", person.id)
      .eq("status", "active"),
    supabase
      .from("school_memberships")
      .select("id,account_id,school_id,role_code")
      .eq("person_id", person.id)
      .eq("status", "active"),
    supabase
      .from("cafeteria_memberships")
      .select("id,account_id,school_id,cafeteria_id,role_code")
      .eq("person_id", person.id)
      .eq("status", "active"),
  ]);

  if (accountResult.error) throw accountResult.error;
  if (schoolResult.error) throw schoolResult.error;
  if (cafeteriaResult.error) throw cafeteriaResult.error;

  const memberships: PikasMembership[] = [];

  for (const membership of accountResult.data) {
    if (!isRole(membership.role_code, "account_admin")) continue;
    const { data, error } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", membership.account_id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      memberships.push({
        id: membership.id,
        accountId: membership.account_id,
        schoolId: null,
        cafeteriaId: null,
        roleCode: membership.role_code,
        scopeKind: "account",
      });
    }
  }

  for (const membership of schoolResult.data) {
    if (!isRole(membership.role_code, "school_admin")) continue;
    const { data, error } = await supabase
      .from("schools")
      .select("id")
      .eq("account_id", membership.account_id)
      .eq("id", membership.school_id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      memberships.push({
        id: membership.id,
        accountId: membership.account_id,
        schoolId: membership.school_id,
        cafeteriaId: null,
        roleCode: membership.role_code,
        scopeKind: "school",
      });
    }
  }

  for (const membership of cafeteriaResult.data) {
    if (!isCafeteriaRole(membership.role_code)) continue;

    if (membership.role_code === "cafeteria_admin") {
      const { data, error } = await supabase
        .from("cafeterias")
        .select("id")
        .eq("account_id", membership.account_id)
        .eq("school_id", membership.school_id)
        .eq("id", membership.cafeteria_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) continue;
    } else {
      const { error } = await supabase.rpc("get_cafeteria_saleable_catalog", {
        p_cafeteria_id: membership.cafeteria_id,
      });
      if (error) {
        if (error.code === "42501") continue;
        throw error;
      }
    }

    memberships.push({
      id: membership.id,
      accountId: membership.account_id,
      schoolId: membership.school_id,
      cafeteriaId: membership.cafeteria_id,
      roleCode: membership.role_code,
      scopeKind: "cafeteria",
    });
  }

  const { data: platformData, error: platformError } =
    await supabase.rpc("platform_get_context");
  if (platformError) throw platformError;

  let platform: PikasPlatformContext | null = null;
  if (platformData !== null) {
    const response: unknown = platformData;
    if (
      typeof response !== "object" ||
      response === null ||
      !("role" in response) ||
      !isPlatformRole(response.role) ||
      !("roles" in response) ||
      !Array.isArray(response.roles) ||
      response.roles.length === 0 ||
      !response.roles.every(isPlatformRole) ||
      !response.roles.includes(response.role) ||
      !("capabilities" in response) ||
      !Array.isArray(response.capabilities) ||
      !response.capabilities.every(
        (capability: unknown) =>
          typeof capability === "string" && capability.length > 0,
      )
    ) {
      throw new Error("Invalid platform context response");
    }
    platform = {
      role: response.role,
      roles: [...new Set<PikasPlatformRole>(response.roles)],
      capabilities: response.capabilities as string[],
    };
  }

  return {
    status: "ready",
    user,
    person: { id: person.id, displayName: person.display_name },
    memberships,
    platform,
  };
}

export function isRole(value: string, role: PikasRole): value is PikasRole {
  return roleCodes.has(value as PikasRole) && value === role;
}

export function isCafeteriaRole(value: string): value is
  | "cafeteria_admin"
  | "pos_cashier"
  | "pos_supervisor" {
  return (
    value === "cafeteria_admin" ||
    value === "pos_cashier" ||
    value === "pos_supervisor"
  );
}

export function hasAppRole(
  identity: PikasIdentity,
  role: "school_admin" | "cafeteria_admin" | "pos_operator",
): boolean {
  return (
    identity.status === "ready" &&
    identity.memberships.some((membership) => {
      if (role === "school_admin") return membership.roleCode === role;
      if (role === "cafeteria_admin") return membership.roleCode === role;
      return (
        membership.roleCode === "pos_cashier" ||
        membership.roleCode === "pos_supervisor"
      );
    })
  );
}

export function pilotHome(identity: PikasIdentity): string | null {
  if (identity.status !== "ready") return null;
  if (identity.memberships.some(({ roleCode }) => roleCode === "school_admin")) {
    return "/pilot/connected";
  }
  if (
    identity.memberships.some(
      ({ roleCode }) =>
        roleCode === "cafeteria_admin" ||
        roleCode === "pos_cashier" ||
        roleCode === "pos_supervisor",
    )
  ) {
    return "/pilot/connected";
  }
  if (identity.memberships.some(({ roleCode }) => roleCode === "account_admin")) {
    return "/pilot/connected";
  }
  return null;
}

export function backofficeHome(identity: PikasIdentity): string | null {
  if (identity.status !== "ready" || !hasPlatformAuthority(identity)) {
    return null;
  }
  return "/platform";
}

export function hasPlatformAuthority(identity: PikasIdentity): boolean {
  return (
    identity.status === "ready" &&
    identity.platform !== null &&
    identity.platform.capabilities.length > 0
  );
}

export function hasPlatformCapability(
  identity: PikasIdentity,
  capability: string,
): boolean {
  return (
    identity.status === "ready" &&
    identity.platform !== null &&
    identity.platform.capabilities.includes(capability)
  );
}
