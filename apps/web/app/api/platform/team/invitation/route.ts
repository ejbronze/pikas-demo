import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../../../lib/supabase/server';
import { activationHandle,activationOrigin,digestActivation,invitationProvider,sameOrigin,newActivationToken,providerContext,inspectOwnedIdentity } from '../../../../../lib/auth/activation';
import { demoMutationBlock } from '../../../../../lib/auth/demo-guard';
const input = z.object({handle:activationHandle}).strict();
const prepared = z.object({handle:activationHandle,email:z.email()}).strict();
export async function POST(request:NextRequest) {
 if (!sameOrigin(request)) return NextResponse.json({error:'same_origin_required'},{status:403});
 try {
  const command = input.safeParse(await request.json());
  if (!command.success) return NextResponse.json({error:'invalid_payload'},{status:400});
  // Configuration is checked before any side effect. No browser-supplied email or Auth ID.
  const origin = activationOrigin(),provider = invitationProvider();
  const client = await createSupabaseServerClient();
  const block = await demoMutationBlock(client); if (block) return NextResponse.json({error:block.error},{status:block.status});
  const reservation = await client.rpc('platform_prepare_activation',{p_team_handle:command.data.handle});
  if (reservation.error) return NextResponse.json({error:'invitation_unavailable'},{status:reservation.error.code==='42501'?403:409});
  const intent = prepared.parse(reservation.data);
  const ownership=await provider.rpc('activation_provider_context',{p_handle:intent.handle});
  if(ownership.error) return NextResponse.json({error:'identity_unavailable'},{status:409});
  let context=providerContext.parse(ownership.data);
  if(!context.auth_id) {
   // createUser fails on an existing email; never use invite to adopt an unknown user.
   // The server-controlled marker reconciles a lost creation response on safe reissue.
   const created=await provider.auth.admin.createUser({email:context.email,email_confirm:false,app_metadata:{pikas_activation_owner:context.owner_key}});
   if(created.error) return NextResponse.json({error:'identity_unavailable'},{status:409});
   const recorded=await provider.rpc('activation_provider_context',{p_handle:intent.handle});
   if(recorded.error) return NextResponse.json({error:'identity_unavailable'},{status:409});
   context=providerContext.parse(recorded.data);
  }
  await inspectOwnedIdentity(provider,context);
  const token = newActivationToken();
  const bound = await client.rpc('platform_bind_activation',{p_handle:intent.handle,p_digest:digestActivation(token)});
  if (bound.error) return NextResponse.json({error:'invitation_unavailable'},{status:409});
  // Only the independent application credential reaches the recipient, never a native token/Auth UUID.
  return NextResponse.json({link:`${origin}/activar#token=${encodeURIComponent(token)}`,delivery:'link_only'},
   {headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 } catch { return NextResponse.json({error:'invitation_unavailable'},{status:503}); }
}
