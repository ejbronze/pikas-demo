import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@pikas/shared-types";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const homeForRole = (role:UserRole) => role==="parent"?"/familias":role==="student"?"/estudiante":role==="school_admin"?"/admin/escuela":role==="cafeteria_admin"?"/admin/cafeteria":"/pos";

export async function requireRole(required:UserRole){
  if(isDemoMode()){
    const stored=(await cookies()).get("pikas_demo_role")?.value;
    const role=(stored==="pos"?"pos_operator":stored) as UserRole|undefined;
    if(!role)redirect(`/login?next=${encodeURIComponent(homeForRole(required))}`);
    if(role!==required)redirect(`${homeForRole(role)}?aviso=sin-permiso`);
    return {role,demo:true as const,userId:null};
  }
  const supabase=await createSupabaseServerClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)redirect(`/login?next=${encodeURIComponent(homeForRole(required))}`);
  const {data:profile}=await supabase.from("profiles").select("role").eq("id",user.id).single();
  const role=profile?.role as UserRole|undefined;
  if(!role)redirect("/login?error=profile");
  if(role!==required)redirect(`${homeForRole(role)}?aviso=sin-permiso`);
  return {role,demo:false as const,userId:user.id};
}
