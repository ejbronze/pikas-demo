import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../../../lib/supabase/server';
import { resolvePikasIdentity } from '../../../../../lib/auth/pikas-context';
import { demoMutationBlock } from '../../../../../lib/auth/demo-guard';
import { invitationProvider } from '../../../../../lib/auth/activation';
import { temporaryPassword } from '../../../../../lib/identity/temporary-password';
import { CUSTOMER_ACCESS_PROVISION } from '../../../../../lib/platform/customer-provisioning';
import { runStaffAccess, type RpcError } from '../../../../../lib/identity/staff-access-flow';
import { platformStaffAccessSchema } from '../../../../../lib/platform/staff-access';

// UX 15: the canonical Platform way to create Personal POS, the SAME one-step workflow as the
// Cafetería Admin's (lib/identity/staff-access-flow), bound to the Platform's existing commands:
//   prepare  → platform_customer_staff_command staff_prepare (platform:customer:access:provision)
//   complete → platform_customer_staff_command staff_complete (derived key)
//   assign   → platform_support_cafeteria_command assignment_save (platform:customer:operations:manage)
// The temporary credential uses the identity-support commands (platform:identity:support). Every
// step keeps its own database authority; no capability is widened here. Platform provisions
// Personal de caja only (pos_cashier), as before. Real Platform mutations are refused inside a Demo.
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
const fail = (error: string, status: number) => json({ error }, status);

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return fail('same_origin_required', 403);
  const key = z.uuid().safeParse(request.headers.get('Idempotency-Key'));
  if (!key.success) return fail('invalid_request_key', 400);
  let body: unknown; try { body = await request.json(); } catch { return fail('invalid_payload', 400); }
  const parsed = platformStaffAccessSchema.safeParse(body); if (!parsed.success) return fail('invalid_payload', 400);
  const input = parsed.data;
  try {
    const client = await createSupabaseServerClient(); const identity = await resolvePikasIdentity(client);
    if (identity.status === 'unauthenticated') return fail('authentication_required', 401);
    if (identity.status !== 'ready' || !identity.platform?.capabilities.includes(CUSTOMER_ACCESS_PROVISION)) return fail('customer_access_provision_required', 403);
    const block = await demoMutationBlock(client);
    if (block) return fail(block.error, block.status);
    const rpc = (name: string, args: Record<string, unknown>) => client.rpc(name, args) as unknown as Promise<{ data: unknown; error: RpcError }>;
    const outcome = await runStaffAccess({ ...input, role: 'pos_cashier' }, key.data, temporaryPassword(), {
      rpc, provider: invitationProvider(), authorityError: 'customer_access_provision_required',
      prepare: email => rpc('platform_customer_staff_command', { p_account_id: input.accountId, p_cafeteria_id: input.cafeteriaId, p_request_id: key.data, p_operation: 'staff_prepare', p_payload: { email, role: 'pos_cashier' }, p_username: input.username, p_display_name: input.display_name }),
      complete: (invitationId, requestId) => rpc('platform_customer_staff_command', { p_account_id: input.accountId, p_cafeteria_id: input.cafeteriaId, p_request_id: requestId, p_operation: 'staff_complete', p_payload: { invitation_id: invitationId, display_name: input.display_name } }),
      assign: (membershipId, registerId, requestId) => rpc('platform_support_cafeteria_command', { p_account_id: input.accountId, p_cafeteria_id: input.cafeteriaId, p_request_id: requestId, p_operation: 'assignment_save', p_payload: { membership_id: membershipId, register_id: registerId, status: 'active', version: null } }),
    });
    return json(outcome.body, outcome.status);
  } catch { return fail('operation_uncertain', 502); }
}
