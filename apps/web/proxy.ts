import {NextRequest,NextResponse} from "next/server";
import {createServerClient} from "@supabase/ssr";
import {isDemoMode} from "@/lib/env";

const requiredRole=(path:string)=>path.startsWith("/familias")?"parent":path.startsWith("/estudiante")?"student":path.startsWith("/pos")?"pos_operator":path.startsWith("/admin/escuela")?"school_admin":path.startsWith("/admin/cafeteria")?"cafeteria_admin":undefined;
const home=(role:string)=>role==="parent"?"/familias":role==="student"?"/estudiante":role==="pos_operator"||role==="pos"?"/pos":role==="school_admin"?"/admin/escuela":"/admin/cafeteria";

export async function proxy(req:NextRequest){
  const needed=requiredRole(req.nextUrl.pathname);
  if(!needed)return NextResponse.next();
  let role:string|undefined;
  if(isDemoMode()){
    const base=req.cookies.get("pikas_demo_role")?.value;
    const admin=req.cookies.get("pikas_demo_admin_role")?.value;
    role=base==="admin"?admin:base==="pos"?"pos_operator":base;
  }else{
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(url&&key){
      const response=NextResponse.next({request:req});
      const supabase=createServerClient(url,key,{cookies:{getAll:()=>req.cookies.getAll(),setAll:values=>values.forEach(({name,value,options})=>response.cookies.set(name,value,options))}});
      const {data:{user}}=await supabase.auth.getUser();
      if(user){const {data:profile}=await supabase.from("profiles").select("role").eq("id",user.id).single();role=profile?.role}
      if(role===needed)return response;
    }
  }
  if(!role)return NextResponse.redirect(new URL(`${needed.endsWith("_admin")?"/admin/login":"/login"}?next=${encodeURIComponent(req.nextUrl.pathname)}`,req.url));
  if(role!==needed)return NextResponse.redirect(new URL(`${home(role)}?aviso=sin-permiso`,req.url));
  return NextResponse.next();
}
export const config={matcher:["/familias/:path*","/estudiante/:path*","/pos/:path*","/admin/escuela/:path*","/admin/cafeteria/:path*"]};
