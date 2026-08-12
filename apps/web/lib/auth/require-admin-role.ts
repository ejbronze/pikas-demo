import "server-only";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import type {AdminRole} from "@/lib/admin-policy";
import {workspaceFor} from "@/lib/admin-policy";
import {isDemoMode} from "@/lib/env";
import {createSupabaseServerClient} from "@/lib/supabase/server";

export async function requireAdminRole(required:"school_admin"|"cafeteria_admin"){
  if(!isDemoMode()){
    const supabase=await createSupabaseServerClient();
    const {data:{user}}=await supabase.auth.getUser();
    if(!user)redirect("/admin/login");
    const {data:profile}=await supabase.from("profiles").select("role").eq("id",user.id).single();
    const role=profile?.role as AdminRole|undefined;
    if(role!=="school_admin"&&role!=="cafeteria_admin")redirect("/admin/login?error=profile");
    if(role!==required)redirect(`${workspaceFor(role)}?aviso=sin-permiso`);
    const {data:membership}=await supabase.from("organization_memberships").select("id").eq("profile_id",user.id).eq("role",role).eq("status","active").limit(1).maybeSingle();
    if(!membership)redirect("/admin/login?error=scope");
    return role;
  }
  const jar=await cookies();
  const baseRole=jar.get("pikas_demo_role")?.value;
  const role=jar.get("pikas_demo_admin_role")?.value as AdminRole|undefined;
  if(baseRole!=="admin"||!role)redirect("/admin/login");
  if(role!==required)redirect(`${workspaceFor(role)}?aviso=sin-permiso`);
  return role;
}
