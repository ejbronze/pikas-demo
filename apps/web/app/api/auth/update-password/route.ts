import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {pilotHome,resolvePikasIdentity} from "@/lib/auth/pikas-context";

const schema=z.object({password:z.string().min(10).max(128)});
// Sets the password on the signed-in Auth user (recovery link or temporary access). Phase 6A: a
// pending forced change completes only when the stored hash differs from the issued temporary one.
export async function POST(req:NextRequest){
 const parsed=schema.safeParse(Object.fromEntries(await req.formData()));
 if(!parsed.success)return NextResponse.json({error:"invalid"},{status:400});
 try{
  const supabase=await createSupabaseServerClient();
  // Recovery links arrive without an application session; starting it is idempotent and the
  // pre-request guard requires it. UX 12B closure: the database refuses to start one for an unused
  // temporary password older than 15 minutes, so that refusal comes before any Auth change.
  const started=await supabase.rpc("pikas_session_start");
  if(started.error?.message==="temporary_access_expired")return NextResponse.json({error:"temporary_access_expired"},{status:409});
  const {error}=await supabase.auth.updateUser({password:parsed.data.password});
  if(error)return NextResponse.json({error:"invalid_session"},{status:401});
  const completed=started.error?null:await supabase.rpc("identity_complete_password_change");
  if(completed?.error?.message==="password_change_required")return NextResponse.json({error:"password_change_required"},{status:409});
  if(completed?.error?.message==="temporary_access_expired")return NextResponse.json({error:"temporary_access_expired"},{status:409});
  if(!completed||completed.error)return NextResponse.json({ok:true,next:null});
  let next:string|null=null;
  try{next=pilotHome(await resolvePikasIdentity(supabase));}catch{next=null;}
  return NextResponse.json({ok:true,next});
 }catch{return NextResponse.json({error:"config"},{status:503})}
}
