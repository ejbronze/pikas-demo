import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveCafeteriaAccess } from '../../../../lib/auth/cafeteria-access';
import { cafeteriaRequestSchema, cafeteriaReadSchema } from '../../../../lib/wallet/contracts';
// Read-only cafeteria balance lookup; cafeteria administrators never mutate wallets.
export async function POST(request: Request) {
  const json = (body: unknown,status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({error:'same_origin_required'},403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({error:'invalid_payload'},400); }
  const parsed = cafeteriaRequestSchema.safeParse(body);
  if (!parsed.success) return json({error:'invalid_payload'},400);
  const input = parsed.data;
  try {
    const client = await createSupabaseServerClient();
    const access = await resolveCafeteriaAccess(client);
    if (access.status === 'unauthenticated') return json({error:'authentication_required'},401);
    if (access.status === 'unavailable') return json({error:'authority_unavailable'},503);
    if (access.status !== 'authorized' || access.context.pov || !access.context.cafeterias.some(c=>c.cafeteria_id===input.cafeteria_id)) return json({error:'wallet_authority_required'},403);
    const {data,error} = await client.rpc('cafeteria_wallet_read',{p_cafeteria_id:input.cafeteria_id,p_query:input.query});
    if (error) return json({error: error.code==='42501' ? 'wallet_authority_required' : 'wallet_unavailable'},error.code==='42501' ? 403 : 502);
    const result = cafeteriaReadSchema.safeParse(data);
    if (!result.success || result.data.cafeteria_id !== input.cafeteria_id) return json({error:'wallet_unavailable'},502);
    return json({result:result.data});
  } catch { return json({error:'wallet_unavailable'},502); }
}
