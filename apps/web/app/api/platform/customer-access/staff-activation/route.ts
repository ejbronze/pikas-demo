import { NextRequest,NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { activationHandle,activationOrigin,digestActivation,invitationProvider,sameOrigin,newActivationToken,providerContext,inspectOwnedIdentity } from "../../../../../lib/auth/activation";
import { CUSTOMER_ACCESS_PROVISION, staffActivationSchema } from "../../../../../lib/platform/customer-provisioning";
import { z } from "zod";
// Platform version of the cafeteria staff activation route: the same server-side link issuance,
// through the Platform 'provision' wrappers. The browser never supplies an email or Auth ID.
const reservation=z.discriminatedUnion("status",[z.object({status:z.literal("identity_ready")}).strict(),z.object({status:z.literal("prepared"),handle:activationHandle,email:z.email()}).strict()]);
const fail=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
export async function POST(request:NextRequest){
 if(!sameOrigin(request))return fail("same_origin_required",403);
 try{
  const command=staffActivationSchema.safeParse(await request.json());if(!command.success)return fail("invalid_payload",400);
  const origin=activationOrigin(),provider=invitationProvider(),client=await createSupabaseServerClient();
  const identity=await resolvePikasIdentity(client);
  if(identity.status!=="ready"||!identity.platform?.capabilities.includes(CUSTOMER_ACCESS_PROVISION))return fail("platform_authorization_required",403);
  const scope={p_account_id:command.data.accountId,p_cafeteria_id:command.data.cafeteriaId,p_invitation_id:command.data.invitationId};
  const prepared=await client.rpc("platform_staff_activation_prepare",scope);
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
  const bound=await client.rpc("platform_staff_activation_bind",{...scope,p_handle:intent.handle,p_digest:digestActivation(token)});
  if(bound.error)return fail("invitation_unavailable",409);
  return NextResponse.json({link:`${origin}/activar#token=${encodeURIComponent(token)}`,delivery:"link_only"},{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
 }catch{return fail("invitation_unavailable",503);}
}
