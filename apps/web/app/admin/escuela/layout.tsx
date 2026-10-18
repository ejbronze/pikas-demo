import { redirectDemoDenial } from "@/lib/platform/demo-recovery";
import { isDemoMode } from "@/lib/env";
import { requireAdminRole } from "@/lib/auth/require-admin-role";
import { resolveSchoolAccess } from "@/lib/auth/school-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (isDemoMode()) {
    await requireAdminRole("school_admin");
    const { AdminShell } = await import("@/components/admin-shell");
    return <AdminShell kind="school">{children}</AdminShell>;
  }
  const client = await createSupabaseServerClient();
  const access = await resolveSchoolAccess(client);
  if (access.status === "unauthenticated") redirect("/login?next=%2Fadmin%2Fescuela");
  if (access.status !== "authorized") await redirectDemoDenial(client, "/login?error=school_authority");
  return children;
}
