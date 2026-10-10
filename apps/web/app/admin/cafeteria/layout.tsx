import { isDemoMode } from "@/lib/env";
import { requireAdminRole } from "@/lib/auth/require-admin-role";
import { resolveCafeteriaAccess } from "@/lib/auth/cafeteria-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
export default async function Layout({children}:{children:React.ReactNode}) {
 if(isDemoMode()){await requireAdminRole("cafeteria_admin"); const {AdminShell}=await import("@/components/admin-shell");return <AdminShell kind="cafeteria">{children}</AdminShell>;}
 const access=await resolveCafeteriaAccess(await createSupabaseServerClient());
 if(access.status==="unauthenticated")redirect("/login?next=%2Fadmin%2Fcafeteria");
 if(access.status!=="authorized")redirect("/login?error=cafeteria_authority");
 return children;
}
