import "server-only";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import type {AdminRole} from "@/lib/admin-policy";
import {workspaceFor} from "@/lib/admin-policy";
import {isDemoMode} from "@/lib/env";

export async function requireAdminRole(required:"school_admin"|"cafeteria_admin"){
  if(!isDemoMode())redirect("/admin/login?error=production-pending");
  const jar=await cookies();
  const baseRole=jar.get("pikas_demo_role")?.value;
  const role=jar.get("pikas_demo_admin_role")?.value as AdminRole|undefined;
  if(baseRole!=="admin"||!role)redirect("/admin/login");
  if(role!==required)redirect(`${workspaceFor(role)}?aviso=sin-permiso`);
  return role;
}
