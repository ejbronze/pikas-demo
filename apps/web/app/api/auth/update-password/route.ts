import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {pilotHome,resolvePikasIdentity} from "@/lib/auth/pikas-context";
import {accessState,type AccessSummary} from "../../../../lib/auth/post-change-access";

const schema=z.object({password:z.string().min(10).max(128)});
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
  if(next)return NextResponse.json({ok:true,next});
  // Lifecycle & Access Management: nothing opens → say why, truthfully, from the person's own access summary
  // (names and states only). Password/security state is already saved and is not touched here.
  const summary=await supabase.rpc("identity_access_summary");
  const access=accessState((summary.data??null) as AccessSummary);
  return NextResponse.json({ok:true,next:null,access});
 }catch{return NextResponse.json({error:"config"},{status:503})}
}
