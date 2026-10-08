import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@pikas/shared-types";
import { isDemoMode } from "@/lib/env";
import { hasAppRole, resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const homeForRole = (role: UserRole) =>
  role === "parent"
    ? "/familias"
    : role === "student"
      ? "/estudiante"
      : role === "school_admin"
        ? "/admin/escuela"
        : role === "cafeteria_admin"
          ? "/admin/cafeteria"
          : "/pos";

export async function requireRole(required: UserRole) {
  if (isDemoMode()) {
    const stored = (await cookies()).get("pikas_demo_role")?.value;
    const role = (stored === "pos" ? "pos_operator" : stored) as UserRole | undefined;

    if (!role) redirect(`/login?next=${encodeURIComponent(homeForRole(required))}`);
    if (role !== required) {
      redirect(`${homeForRole(role)}?aviso=sin-permiso`);
    }
    return { role, demo: true as const, userId: null };
  }

  const identity = await resolvePikasIdentity(await createSupabaseServerClient());
  if (identity.status === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(homeForRole(required))}`);
  }
  if (identity.status !== "ready") redirect("/login?error=identity");

  const authorized =
    required === "pos_operator"
      ? hasAppRole(identity, "pos_operator")
      : required === "school_admin" || required === "cafeteria_admin"
        ? hasAppRole(identity, required)
        : false;

  if (!authorized) redirect("/pilot/connected?aviso=sin-permiso");

  return {
    role: required,
    demo: false as const,
    userId: identity.user.id,
    personId: identity.person.id,
    memberships: identity.memberships,
  };
}
