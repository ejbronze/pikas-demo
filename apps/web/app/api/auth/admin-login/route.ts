import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {isDemoMode} from "@/lib/env";
import {workspaceFor,type AdminRole} from "@/lib/admin-policy";

const accounts={
  "admin.escuela@demo.pikas.do":{password:"pikas-demo",role:"school_admin"},
  "admin.cafeteria@demo.pikas.do":{password:"pikas-demo",role:"cafeteria_admin"},
  "cafeteria@demo.pikas.do":{password:"pikas-demo",role:"pos_operator"},
} as const;
const schema=z.object({identifier:z.string().email(),password:z.string().min(4)});
export async function POST(req:NextRequest){
  if(!isDemoMode())return NextResponse.redirect(new URL("/admin/login?error=production-pending",req.url),303);
  const parsed=schema.safeParse(Object.fromEntries(await req.formData()));
  const account=parsed.success?accounts[parsed.data.identifier as keyof typeof accounts]:undefined;
  if(!parsed.success||!account||account.password!==parsed.data.password)return NextResponse.redirect(new URL("/admin/login?error=credentials",req.url),303);
  const role=account.role as AdminRole;
  const res=NextResponse.redirect(new URL(workspaceFor(role),req.url),303);
  const secure=req.nextUrl.protocol==="https:";
  res.cookies.set("pikas_demo_role",role==="pos_operator"?"pos":"admin",{httpOnly:true,sameSite:"lax",secure,maxAge:60*60*8,path:"/"});
  res.cookies.set("pikas_demo_admin_role",role,{httpOnly:true,sameSite:"lax",secure,maxAge:60*60*8,path:"/"});
  return res;
}
