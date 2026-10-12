import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@supabase/ssr';
import { activationHandle,activationToken,digestActivation,isolatedAuth,sameOrigin,invitationProvider,providerContext,inspectOwnedIdentity } from '../../../../lib/auth/activation';
import { getSupabasePublicConfig } from '../../../../lib/supabase/config';
const input = z.object({token:activationToken}).strict();
export async function POST(request:NextRequest) {
 if (!sameOrigin(request)) return NextResponse.json({error:'same_origin_required'},{status:403});
 try {
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({error:'invalid_invitation'},{status:400});
  const digest = digestActivation(parsed.data.token),client = isolatedAuth();
  const preview = await client.rpc('activation_preview',{p_digest:digest});
  if (preview.error || !preview.data) return NextResponse.json({error:'invalid_invitation'},{status:400});
  const provider=invitationProvider();
  const ownership=await provider.rpc('activation_provider_context',{p_digest:digest});
  if(ownership.error) return NextResponse.json({error:'invalid_invitation'},{status:400});
  const context=providerContext.parse(ownership.data);
  const user=await inspectOwnedIdentity(provider,context);
  // Auth operations are not atomic with SQL/cookies. The high-entropy credential
  // may resume the exact owned identity until its first password closes recovery.
  const type=user.email_confirmed_at?'magiclink':'invite';
  const generated=await provider.auth.admin.generateLink({type,email:context.email});
  if(generated.error||generated.data.user.id!==user.id) return NextResponse.json({error:'invalid_invitation'},{status:400});
  // Native token/session remain server-side; inviter cookies are never read.
  const verified = await client.auth.verifyOtp({token_hash:generated.data.properties.hashed_token,type});
  if (verified.error || !verified.data.session) return NextResponse.json({error:'invalid_invitation'},{status:400});
  const consumed = await client.rpc('activation_consume',{p_digest:digest});
  if (consumed.error || !consumed.data) return NextResponse.json({error:'invalid_invitation'},{status:400});
  const confirmed = z.object({handle:activationHandle}).strict().parse(consumed.data);
  const response = NextResponse.json({handle:confirmed.handle},{headers:{'Cache-Control':'no-store'}});
  const {url,anonKey} = getSupabasePublicConfig();
  const cookiePrefix = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  request.cookies.getAll().filter(cookie=>cookie.name===cookiePrefix||cookie.name.startsWith(`${cookiePrefix}.`)).forEach(cookie=>response.cookies.set(cookie.name,'',{path:'/',maxAge:0}));
  const recipient = createServerClient(url,anonKey,{cookies:{getAll:()=>[],setAll:values=>{
   values.forEach(({name,value,options})=>response.cookies.set(name,value,options));
  }}});
  const saved = await recipient.auth.setSession(verified.data.session);
  if (saved.error) return NextResponse.json({error:'activation_unavailable'},{status:503});
  return response;
 } catch { return NextResponse.json({error:'activation_unavailable'},{status:503}); }
}
