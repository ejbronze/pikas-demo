import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {isDemoMode} from "@/lib/env";
import {workspaceFor,type AdminRole} from "@/lib/admin-policy";
import {createSupabaseServerClient} from "@/lib/supabase/server";

const accounts={
  "admin.escuela@demo.pikas.do":{password:"pikas-demo",role:"school_admin"},
  "admin.cafeteria@demo.pikas.do":{password:"pikas-demo",role:"cafeteria_admin"},
  "cafeteria@demo.pikas.do":{password:"pikas-demo",role:"pos_operator"},
} as const;
const schema=z.object({identifier:z.string().email(),password:z.string().min(4)});
export async function POST(req:NextRequest){
  const parsed=schema.safeParse(Object.fromEntries(await req.formData()));
  if(!isDemoMode()){
    if(!parsed.success)return NextResponse.redirect(new URL("/admin/login?error=credentials",req.url),303);
    try{
      const supabase=await createSupabaseServerClient();
      const {data,error}=await supabase.auth.signInWithPassword({email:parsed.data.identifier,password:parsed.data.password});
      if(error||!data.user)return NextResponse.redirect(new URL("/admin/login?error=credentials",req.url),303);
      const {data:profile}=await supabase.from("profiles").select("role").eq("id",data.user.id).single();
      const role=profile?.role as AdminRole|undefined;
      if(role!=="school_admin"&&role!=="cafeteria_admin"&&role!=="pos_operator"){await supabase.auth.signOut();return NextResponse.redirect(new URL("/admin/login?error=role",req.url),303)}
      const {data:membership}=await supabase.from("organization_memberships").select("id").eq("profile_id",data.user.id).eq("role",role).eq("status","active").limit(1).maybeSingle();
      if(!membership){await supabase.auth.signOut();return NextResponse.redirect(new URL("/admin/login?error=scope",req.url),303)}
      return NextResponse.redirect(new URL(workspaceFor(role),req.url),303);
    }catch{return NextResponse.redirect(new URL("/admin/login?error=config",req.url),303)}
  }
  const account=parsed.success?accounts[parsed.data.identifier as keyof typeof accounts]:undefined;
  if(!parsed.success||!account||account.password!==parsed.data.password)return NextResponse.redirect(new URL("/admin/login?error=credentials",req.url),303);
  const role=account.role as AdminRole;
  const res=NextResponse.redirect(new URL(workspaceFor(role),req.url),303);
  const secure=req.nextUrl.protocol==="https:";
  res.cookies.set("pikas_demo_role",role==="pos_operator"?"pos":"admin",{httpOnly:true,sameSite:"lax",secure,maxAge:60*60*8,path:"/"});
  res.cookies.set("pikas_demo_admin_role",role,{httpOnly:true,sameSite:"lax",secure,maxAge:60*60*8,path:"/"});
  return res;
}
