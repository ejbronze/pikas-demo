import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveSchoolAccess } from '../../../../lib/auth/school-access';
import { requestSchema, historySchema, resultSchema, reversalResultSchema, adjustResultSchema } from '../../../../lib/wallet/contracts';
export async function POST(request: Request) {
  const json = (body: unknown,status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({error:'same_origin_required'},403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({error:'invalid_payload'},400); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return json({error:'invalid_payload'},400);
  const input = parsed.data;
  if (input.operation !== 'read' && request.headers.get('Idempotency-Key') !== input.request_key) return json({error:'invalid_request_key'},400);
  try {
    const client = await createSupabaseServerClient();
    const access = await resolveSchoolAccess(client);
    if (access.status === 'unauthenticated') return json({error:'authentication_required'},401);
    if (access.status === 'unavailable') return json({error:'authority_unavailable'},503);
    // A Demo POV may READ fictional PIKAS Cash (the database scopes it to the sandbox); it never mutates a wallet.
    if (access.status !== 'authorized' || !access.context.schools.some(s=>s.school_id===input.school_id)) return json({error:'wallet_authority_required'},403);
    if (access.context.pov && input.operation !== 'read') return json({error:'demo_mode_active'},403);
    const {data,error} = input.operation === 'replenish'
      ? await client.rpc('school_wallet_replenish',{p_school_id:input.school_id,p_student_id:input.student_id,p_amount_minor:input.amount_minor,p_request_key:input.request_key,p_reference:input.reference,p_note:input.note})
      : input.operation === 'adjust'
      ? await client.rpc('school_wallet_adjust',{p_school_id:input.school_id,p_student_id:input.student_id,p_amount_minor:input.amount_minor,p_reason:input.reason,p_explanation:input.explanation,p_request_key:input.request_key})
      : input.operation === 'reverse'
      ? await client.rpc('school_wallet_reverse_replenishment',{p_school_id:input.school_id,p_student_id:input.student_id,p_replenishment_id:input.replenishment_id,p_reason:input.reason,p_note:input.note||null,p_request_key:input.request_key})
      : await client.rpc('school_wallet_read',{p_school_id:input.school_id,p_student_id:input.student_id,p_before:input.before});
    if (error) {
      if (error.message === 'REPLENISHMENT_ALREADY_REVERSED') return json({error:'REPLENISHMENT_ALREADY_REVERSED'},409);
      return json({error: error.code==='42501' ? 'wallet_authority_required' : ['22023','22003','23514','23503','22001'].includes(error.code) ? 'wallet_state_invalid' : 'operation_uncertain'},error.code==='42501' ? 403 : ['22023','22003','23514','23503','22001'].includes(error.code) ? 422 : 502);
    }
    const result = input.operation === 'replenish' ? resultSchema.safeParse(data) : input.operation === 'adjust' ? adjustResultSchema.safeParse(data) : input.operation === 'reverse' ? reversalResultSchema.safeParse(data) : historySchema.safeParse(data);
    if (!result.success || result.data.school_id !== input.school_id || result.data.student_id !== input.student_id) return json({error:'operation_uncertain'},502);
    if (input.operation === 'adjust' && 'amount_minor' in result.data && result.data.amount_minor !== input.amount_minor) return json({error:'operation_uncertain'},502);
    if (input.operation === 'reverse' && (!('replenishment_id' in result.data) || result.data.replenishment_id !== input.replenishment_id)) return json({error:'operation_uncertain'},502);
    return json({result:result.data});
  } catch { return json({error:'operation_uncertain'},502); }
}
