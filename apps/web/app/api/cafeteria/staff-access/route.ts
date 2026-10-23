import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveCafeteriaAccess } from '../../../../lib/auth/cafeteria-access';
import { invitationProvider } from '../../../../lib/auth/activation';
import { temporaryPassword } from '../../../../lib/identity/temporary-password';
import { staffAccessRequestSchema } from '../../../../lib/identity/staff-access';
import { runStaffAccess, type RpcError } from '../../../../lib/identity/staff-access-flow';

// UX 12B: one-step POS staff access for the Cafetería Admin. The composition lives in
// lib/identity/staff-access-flow (shared with the Platform route, UX 15); this route only decides
// the Cafetería's own authority and binds each step to the Cafetería's own commands:
//   prepare  → provisioning_prepare_with_username (flow cafeteria_staff, this request key)
//   complete → cafeteria_admin_command staff_complete (derived key)
//   assign   → cafeteria_admin_command assignment_save (derived key)
// Inside the sandbox (Demo Lab) the cafetería-admin POV creates Personal POS of ITS sandbox cafetería: the
// database admits only that (username ending in .demo, sandbox identity targets). Real tenants never run under a POV.
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
const fail = (error: string, status: number) => json({ error }, status);

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return fail('same_origin_required', 403);
  const key = z.uuid().safeParse(request.headers.get('Idempotency-Key'));
  if (!key.success) return fail('invalid_request_key', 400);
  let body: unknown; try { body = await request.json(); } catch { return fail('invalid_payload', 400); }
  const parsed = staffAccessRequestSchema.safeParse(body); if (!parsed.success) return fail('invalid_payload', 400);
  const input = parsed.data;
  try {
    const client = await createSupabaseServerClient(); const access = await resolveCafeteriaAccess(client);
    if (access.status === 'unauthenticated') return fail('authentication_required', 401);
    if (access.status === 'unavailable') return fail('authorization_unavailable', 503);
    if (access.status !== 'authorized') return fail('cafeteria_authority_required', 403);
    const cafeteria = access.context.cafeterias.find(c => c.cafeteria_id === input.cafeteriaId);
    if (!cafeteria) return fail('cafeteria_authority_required', 403);
    if (cafeteria.tenant_kind === 'customer' ? !!access.context.pov : access.context.pov?.pov_code !== 'cafeteria_admin') return fail('sandbox_unsupported', 403);
    const rpc = (name: string, args: Record<string, unknown>) => client.rpc(name, args) as unknown as Promise<{ data: unknown; error: RpcError }>;
    const command = (requestId: string, operation: string, payload: Record<string, unknown>) =>
      rpc('cafeteria_admin_command', { p_cafeteria_id: input.cafeteriaId, p_request_id: requestId, p_operation: operation, p_payload: payload });
    const outcome = await runStaffAccess(input, key.data, temporaryPassword(), {
      rpc, provider: invitationProvider(), authorityError: 'cafeteria_authority_required',
      prepare: email => rpc('provisioning_prepare_with_username', { p_flow: 'cafeteria_staff', p_request_id: key.data, p_school_id: null, p_cafeteria_id: input.cafeteriaId, p_payload: { email, role: input.role }, p_username: input.username }),
      complete: (invitationId, requestId) => command(requestId, 'staff_complete', { invitation_id: invitationId, display_name: input.display_name }),
      assign: (membershipId, registerId, requestId) => command(requestId, 'assignment_save', { membership_id: membershipId, register_id: registerId, status: 'active', version: null }),
    });
    return json(outcome.body, outcome.status);
  } catch { return fail('operation_uncertain', 502); }
}
