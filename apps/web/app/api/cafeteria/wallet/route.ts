import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveCafeteriaAccess } from '../../../../lib/auth/cafeteria-access';
import { adjustResultSchema, cafeteriaRequestSchema, cafeteriaReadSchema } from '../../../../lib/wallet/contracts';
// Cafeteria balance lookup (read) and 5C.3 scoped administrative adjustments for connected students.
export async function POST(request: Request) {
  const json = (body: unknown,status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({error:'same_origin_required'},403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({error:'invalid_payload'},400); }
  const parsed = cafeteriaRequestSchema.safeParse(body);
  if (!parsed.success) return json({error:'invalid_payload'},400);
  const input = parsed.data;
  const adjust = 'operation' in input;
  if (adjust && request.headers.get('Idempotency-Key') !== input.request_key) return json({error:'invalid_request_key'},400);
  try {
    const client = await createSupabaseServerClient();
    const access = await resolveCafeteriaAccess(client);
    if (access.status === 'unauthenticated') return json({error:'authentication_required'},401);
    if (access.status === 'unavailable') return json({error:'authority_unavailable'},503);
    if (access.status !== 'authorized' || access.context.pov || !access.context.cafeterias.some(c=>c.cafeteria_id===input.cafeteria_id)) return json({error:'wallet_authority_required'},403);
    const {data,error} = adjust
      ? await client.rpc('cafeteria_wallet_adjust',{p_cafeteria_id:input.cafeteria_id,p_student_id:input.student_id,p_amount_minor:input.amount_minor,p_reason:input.reason,p_explanation:input.explanation,p_request_key:input.request_key})
      : await client.rpc('cafeteria_wallet_read',{p_cafeteria_id:input.cafeteria_id,p_query:input.query});
    if (error) return json({error: error.code==='42501' ? 'wallet_authority_required' : adjust && ['22023','22003','23514'].includes(error.code) ? 'wallet_state_invalid' : 'wallet_unavailable'},
      error.code==='42501' ? 403 : adjust && ['22023','22003','23514'].includes(error.code) ? 422 : 502);
    if (adjust) {
      const result = adjustResultSchema.safeParse(data);
      if (!result.success || result.data.cafeteria_id !== input.cafeteria_id || result.data.student_id !== input.student_id || result.data.amount_minor !== input.amount_minor) return json({error:'wallet_unavailable'},502);
      return json({result:result.data});
    }
    const result = cafeteriaReadSchema.safeParse(data);
    if (!result.success || result.data.cafeteria_id !== input.cafeteria_id) return json({error:'wallet_unavailable'},502);
    return json({result:result.data});
  } catch { return json({error:'wallet_unavailable'},502); }
}
