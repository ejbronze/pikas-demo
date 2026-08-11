import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@pikas/shared-types";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const homeFor = (role:UserRole) => role==="parent"?"/familias":role==="student"?"/estudiante":`/${role}`;

export async function requireRole(required:UserRole){
  if(isDemoMode()){
    const role=(await cookies()).get("pikas_demo_role")?.value as UserRole|undefined;
    if(!role)redirect(`/login?next=${encodeURIComponent(homeFor(required))}`);
    if(role!==required)redirect(`${homeFor(role)}?aviso=sin-permiso`);
    return {role,demo:true as const,userId:null};
  }
  const supabase=await createSupabaseServerClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)redirect(`/login?next=${encodeURIComponent(homeFor(required))}`);
  const {data:profile}=await supabase.from("profiles").select("role").eq("id",user.id).single();
  const role=profile?.role as UserRole|undefined;
  if(!role)redirect("/login?error=profile");
  if(role!==required)redirect(`${homeFor(role)}?aviso=sin-permiso`);
  return {role,demo:false as const,userId:user.id};
}
