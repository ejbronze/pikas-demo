import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { activationHandle,sameOrigin,invitationProvider,providerContext,passwordFingerprint } from '../../../../lib/auth/activation';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
const input=z.object({handle:activationHandle,password:z.string().min(10).max(128)}).strict();
export async function POST(request:NextRequest) {
 if (!sameOrigin(request)) return NextResponse.json({error:'same_origin_required'},{status:403});
 try {
  const parsed=input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({error:'invalid_payload'},{status:400});
  const client=await createSupabaseServerClient();
  const user=await client.auth.getUser();
  if (user.error||!user.data.user) return NextResponse.json({error:'recipient_required'},{status:401});
  const state=await client.rpc('activation_password_status',{p_handle:parsed.data.handle});
  if(state.error) return NextResponse.json({error:'recipient_required'},{status:403});
  if(state.data==='ready') return NextResponse.json({status:'identity_ready'},{headers:{'Cache-Control':'no-store'}});
  const provider=invitationProvider();
  const owned=await provider.rpc('activation_provider_context',{p_handle:parsed.data.handle});
  if(owned.error) return NextResponse.json({error:'recipient_required'},{status:403});
  const context=providerContext.parse(owned.data);
  if(context.auth_id!==user.data.user.id) return NextResponse.json({error:'recipient_required'},{status:403});
  const fingerprint=passwordFingerprint(parsed.data.password,context.owner_key);
  const claimed=await client.rpc('activation_claim_password',{p_handle:parsed.data.handle,p_fingerprint:fingerprint});
  if(claimed.error) return NextResponse.json({error:'same_password_required'},{status:409});
  const changed=await client.auth.updateUser({password:parsed.data.password});
  if (changed.error) {
   if(changed.error.code==='weak_password') await provider.rpc('activation_reject_password',{p_handle:parsed.data.handle,p_fingerprint:fingerprint,p_auth_id:user.data.user.id});
   return NextResponse.json({error:changed.error.code==='weak_password'?'weak_password':'password_unavailable'},{status:400});
  }
  const finalized=await client.rpc('activation_password_status',{p_handle:parsed.data.handle});
  if(finalized.error||finalized.data!=='ready') return NextResponse.json({error:'activation_unavailable'},{status:503});
  return NextResponse.json({status:'identity_ready'},{headers:{'Cache-Control':'no-store'}});
 } catch { return NextResponse.json({error:'activation_unavailable'},{status:503}); }
}
