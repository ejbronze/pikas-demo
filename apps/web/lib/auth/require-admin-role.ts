import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AdminRole } from "@/lib/admin-policy";
import { workspaceFor } from "@/lib/admin-policy";
import { isDemoMode } from "@/lib/env";
import { hasAppRole, resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireAdminRole(required: "school_admin" | "cafeteria_admin") {
  if (!isDemoMode()) {
    const identity = await resolvePikasIdentity(await createSupabaseServerClient());
    if (identity.status === "unauthenticated") redirect("/admin/login");
    if (identity.status !== "ready") redirect("/admin/login?error=identity");

    if (
      !hasAppRole(identity, "school_admin") &&
      !hasAppRole(identity, "cafeteria_admin")
    ) {
      redirect("/pilot/connected?aviso=sin-permiso");
    }
    if (!hasAppRole(identity, required)) {
      const otherRole: AdminRole = required === "school_admin" ? "cafeteria_admin" : "school_admin";
      redirect(`${workspaceFor(otherRole)}?aviso=sin-permiso`);
    }
    return required;
  }

  const jar = await cookies();
  const baseRole = jar.get("pikas_demo_role")?.value;
  const role = jar.get("pikas_demo_admin_role")?.value as AdminRole | undefined;
  if (baseRole !== "admin" || !role) redirect("/admin/login");
  if (role !== required) redirect(`${workspaceFor(role)}?aviso=sin-permiso`);
  return role;
}
