import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveSchoolAccess } from '../../../../lib/auth/school-access';
import { requestSchema, historySchema, resultSchema } from '../../../../lib/wallet/contracts';
export async function POST(request: Request) {
  const json = (body: unknown,status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({error:'same_origin_required'},403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({error:'invalid_payload'},400); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return json({error:'invalid_payload'},400);
  const input = parsed.data;
  if (input.operation === 'replenish' && request.headers.get('Idempotency-Key') !== input.request_key) return json({error:'invalid_request_key'},400);
  try {
    const client = await createSupabaseServerClient();
    const access = await resolveSchoolAccess(client);
    if (access.status === 'unauthenticated') return json({error:'authentication_required'},401);
    if (access.status === 'unavailable') return json({error:'authority_unavailable'},503);
    if (access.status !== 'authorized' || access.context.pov || !access.context.schools.some(s=>s.school_id===input.school_id)) return json({error:'wallet_authority_required'},403);
    const credit = input.operation === 'replenish';
    const {data,error} = await client.rpc(credit ? 'school_wallet_replenish' : 'school_wallet_read',credit ? {p_school_id:input.school_id,p_student_id:input.student_id,p_amount_minor:input.amount_minor,p_request_key:input.request_key,p_reference:input.reference,p_note:input.note} : {p_school_id:input.school_id,p_student_id:input.student_id,p_before:input.before});
    if (error) return json({error: error.code==='42501' ? 'wallet_authority_required' : ['22023','22003','23514','23503','22001'].includes(error.code) ? 'wallet_state_invalid' : 'operation_uncertain'},error.code==='42501' ? 403 : ['22023','22003','23514','23503','22001'].includes(error.code) ? 422 : 502);
    const result = credit ? resultSchema.safeParse(data) : historySchema.safeParse(data);
    if (!result.success || result.data.school_id !== input.school_id || result.data.student_id !== input.student_id) return json({error:'operation_uncertain'},502);
    return json({result:result.data});
  } catch { return json({error:'operation_uncertain'},502); }
}
