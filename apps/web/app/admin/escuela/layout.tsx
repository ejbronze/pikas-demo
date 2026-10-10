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
  const access = await resolveSchoolAccess(await createSupabaseServerClient());
  if (access.status === "unauthenticated") redirect("/login?next=%2Fadmin%2Fescuela");
  if (access.status !== "authorized") redirect("/login?error=school_authority");
  return children;
}
