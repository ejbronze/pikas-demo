import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { activationHandle,activationOrigin,digestActivation,invitationProvider,sameOrigin,newActivationToken,providerContext,inspectOwnedIdentity } from "../../../../lib/auth/activation";
const input=z.object({invitationId:z.uuid()}).strict();
const reservation=z.discriminatedUnion("status",[z.object({status:z.literal("identity_ready")}).strict(),z.object({status:z.literal("prepared"),handle:activationHandle,email:z.email()}).strict()]);
const fail=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
export async function POST(request:NextRequest){
 if(!sameOrigin(request))return fail("same_origin_required",403);
 try{
  const command=input.safeParse(await request.json());if(!command.success)return fail("invalid_payload",400);
  // Check server-only configuration before any side effect. No browser-supplied email/Auth ID.
  const origin=activationOrigin(),provider=invitationProvider(),client=await createSupabaseServerClient();
  const prepared=await client.rpc("cafeteria_prepare_staff_activation",{p_invitation_id:command.data.invitationId});
  if(prepared.error)return fail(prepared.error.message==="activation_identity_unavailable"?"identity_unavailable":"invitation_unavailable",prepared.error.code==="42501"?403:409);
  const intent=reservation.parse(prepared.data);
  if(intent.status==="identity_ready")return NextResponse.json({status:"identity_ready"},{headers:{"Cache-Control":"no-store"}});
  const owned=await provider.rpc("activation_provider_context",{p_handle:intent.handle});
  if(owned.error)return fail("identity_unavailable",409);
  let context=providerContext.parse(owned.data);
  if(context.email!==intent.email)return fail("identity_unavailable",409);
  if(!context.auth_id){
   const created=await provider.auth.admin.createUser({email:context.email,email_confirm:false,app_metadata:{pikas_activation_owner:context.owner_key}});
   if(created.error)return fail("identity_unavailable",409);
   const recorded=await provider.rpc("activation_provider_context",{p_handle:intent.handle});
   if(recorded.error)return fail("identity_unavailable",409);
   context=providerContext.parse(recorded.data);
   if(context.email!==intent.email)return fail("identity_unavailable",409);
  }
  await inspectOwnedIdentity(provider,context);
  const token=newActivationToken();
  const bound=await client.rpc("cafeteria_bind_staff_activation",{p_invitation_id:command.data.invitationId,p_handle:intent.handle,p_digest:digestActivation(token)});
  if(bound.error)return fail("invitation_unavailable",409);
  return NextResponse.json({link:`${origin}/activar#token=${encodeURIComponent(token)}`,delivery:"link_only"},{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
 }catch{return fail("invitation_unavailable",503);}
}

export async function GET(request:NextRequest){
 const invitation=z.uuid().safeParse(request.nextUrl.searchParams.get('invitation'));
 if(!invitation.success)return fail('invalid_invitation',400);
 try{const client=await createSupabaseServerClient();const result=await client.rpc('cafeteria_staff_activation_status',{p_invitation_id:invitation.data});
 if(result.error)return fail('activation_unavailable',result.error.code==='42501'?403:503);
 return NextResponse.json(result.data,{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }catch{return fail('activation_unavailable',503);}
}
