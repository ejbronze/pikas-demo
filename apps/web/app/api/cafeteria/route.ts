import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { resolveCafeteriaAccess } from '../../../lib/auth/cafeteria-access';
import { commandSchema, commandResultSchema } from '../../../lib/cafeteria/contracts';
import { isUsernameRejection } from '../../../lib/identity/provisioning';
export async function POST(request: NextRequest) {
 const fail = (error:string,status:number) => NextResponse.json({error},{status});
 if (request.headers.get('origin') !== request.nextUrl.origin) return fail('same_origin_required',403);
 const key = z.uuid().safeParse(request.headers.get('Idempotency-Key'));
 if (!key.success) return fail('invalid_request_key',400);
 let body:unknown; try { body = await request.json(); } catch { return fail('invalid_payload',400); }
 const parsed = commandSchema.safeParse(body); if (!parsed.success) return fail('invalid_payload',400);
 try {
  const client = await createSupabaseServerClient(); const access = await resolveCafeteriaAccess(client);
  if (access.status === 'unauthenticated') return fail('authentication_required',401);
  if (access.status === 'unavailable') return fail('authorization_unavailable',503);
  if (access.status !== 'authorized' || !access.context.cafeterias.some(c=>c.cafeteria_id === parsed.data.cafeteriaId)) return fail('cafeteria_authority_required',403);
  // Phase 6A: a username at preparation is reserved in the same transaction as the existing command.
  const withUsername = parsed.data.operation === 'staff_prepare' && parsed.data.payload.username !== undefined;
  const {data:raw,error} = withUsername && parsed.data.operation === 'staff_prepare'
   ? await client.rpc('provisioning_prepare_with_username',{p_flow:'cafeteria_staff',p_request_id:key.data,p_school_id:null,p_cafeteria_id:parsed.data.cafeteriaId,p_payload:{email:parsed.data.payload.email,role:parsed.data.payload.role},p_username:parsed.data.payload.username})
   : await client.rpc('cafeteria_admin_command',{p_cafeteria_id:parsed.data.cafeteriaId,p_request_id:key.data,p_operation:parsed.data.operation,p_payload:parsed.data.payload});
  const data = withUsername && raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'username')) : raw;
  if (error) {
   if (error.code === '42501') return fail('cafeteria_authority_required',403);
   if (isUsernameRejection(error.message)) return fail(error.message,422);
   if (['23514','23503','23505','40001','40P01','22023','22007','22P02','23502'].includes(error.code)) return fail(error.message === 'confirmed_identity_pending' ? 'confirmed_identity_pending':'cafeteria_state_invalid',422);
   return fail('operation_uncertain',502);
  }
  const result = commandResultSchema.safeParse(data);
  if (!result.success || result.data.request_id !== key.data || result.data.operation !== parsed.data.operation) return fail('operation_uncertain',502);
  return NextResponse.json({result:result.data});
 } catch { return fail('operation_uncertain',502); }
}
