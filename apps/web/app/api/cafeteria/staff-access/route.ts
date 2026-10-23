import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { resolveCafeteriaAccess } from '../../../../lib/auth/cafeteria-access';
import { invitationProvider } from '../../../../lib/auth/activation';
import { temporaryPassword } from '../../../../lib/identity/temporary-password';
import { identitySummarySchema } from '../../../../lib/identity/contracts';
import { isUsernameRejection } from '../../../../lib/identity/provisioning';
import { commandResultSchema } from '../../../../lib/cafeteria/contracts';
import { internalEmail, isInternalEmail, staffAccessRequestSchema, type StaffAccessResult } from '../../../../lib/identity/staff-access';

// UX 12B: one-step POS staff access for the Cafetería Admin, composed ONLY from the existing
// primitives in their existing order, each with its own authority check, journal and audit:
//   1. provisioning_prepare_with_username → staff_prepare (invitation + reserved username, this key)
//   2. a confirmed Auth identity for the invitation's address (service role, Auth only)
//   3. cafeteria_admin_command staff_complete (Person + membership; derived key, replayable)
//   4. identity_begin/finish_temporary_access (one-time credential, forced change) — only for an
//      identity that has never signed in; an existing person keeps their password
//   5. optional assignment_save to one caja (derived key)
// The temporary password exists only in this response: never logged, stored, audited or re-read.
// Sandbox and Demo personas are refused: there, identities are never provisioned.
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
const fail = (error: string, status: number) => json({ error }, status);
type RpcError = { code?: string; message?: string } | null;
// A deterministic request key per step, so an exact retry of the same request replays each step.
const deriveKey = (key: string, step: string) => { const h = createHash('sha256').update(`${key}:${step}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${(parseInt(h[16], 16) & 0x3 | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const rejected = (error: NonNullable<RpcError>, known: string[]) => {
  if (error.code === '42501') return error.message === 'tenant_identity_required' ? fail('identity_outside_customer', 422) : fail('cafeteria_authority_required', 403);
  if (isUsernameRejection(error.message)) return fail(error.message, 422);
  if (error.message && known.includes(error.message)) return fail(error.message, 422);
  if (error.code === '23505' && error.message === 'request_key_reused') return fail('request_key_reused', 409);
  return fail('operation_uncertain', 502);
};

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
    if (cafeteria.tenant_kind !== 'customer' || access.context.pov) return fail('sandbox_unsupported', 403);
    const provider = invitationProvider();
    const rpc = (name: string, args: Record<string, unknown>) => client.rpc(name, args) as unknown as Promise<{ data: unknown; error: RpcError }>;
    const command = (step: string, operation: string, payload: Record<string, unknown>) =>
      rpc('cafeteria_admin_command', { p_cafeteria_id: input.cafeteriaId, p_request_id: deriveKey(key.data, step), p_operation: operation, p_payload: payload });
    const email = input.email ?? internalEmail(input.username, key.data);

    // 1. Prepared access with the reserved username (the existing, exact-key journalled step).
    const prepared = await rpc('provisioning_prepare_with_username', { p_flow: 'cafeteria_staff', p_request_id: key.data, p_school_id: null, p_cafeteria_id: input.cafeteriaId, p_payload: { email, role: input.role }, p_username: input.username });
    if (prepared.error) return rejected(prepared.error, []);
    const invitation = commandResultSchema.safeParse(Object.fromEntries(Object.entries((prepared.data ?? {}) as Record<string, unknown>).filter(([k]) => k !== 'username')));
    if (!invitation.success || invitation.data.operation !== 'staff_prepare' || !invitation.data.target_id) return fail('operation_uncertain', 502);

    // 2. A confirmed Auth identity. An address already registered is an existing identity (or a
    //    previous attempt of this same request): never recreated, never duplicated.
    const password = temporaryPassword();
    const created = await provider.auth.admin.createUser({ email, password, email_confirm: true });
    const createdNow = !created.error;
    if (created.error && created.error.code !== 'email_exists' && !/already|exists|registered/i.test(created.error.message)) return fail('auth_create_failed', 502);

    // 3. Person + POS membership in THIS cafetería (the database re-checks every boundary).
    const completed = await command('complete', 'staff_complete', { invitation_id: invitation.data.target_id, display_name: input.display_name });
    if (completed.error) return rejected(completed.error, ['confirmed_identity_pending', 'existing_membership_not_active', 'active_person_required', 'pending_staff_invitation_required']);
    const membership = commandResultSchema.safeParse(completed.data);
    if (!membership.success || membership.data.operation !== 'staff_complete' || !membership.data.target_id) return fail('operation_uncertain', 502);
    const membershipId = membership.data.target_id;
    const read = await rpc('identity_support_read_membership', { p_membership_id: membershipId });
    if (read.error) return rejected(read.error, []);
    let summary = identitySummarySchema.safeParse(read.data);
    if (!summary.success) return fail('operation_uncertain', 502);

    // 4. One-time credential only for an identity that has never signed in; an identity created in
    //    an earlier attempt of this request gets a fresh one (the earlier password is unknown).
    const neverSignedIn = summary.data.last_sign_in_at === null;
    const issue = createdNow || (neverSignedIn && summary.data.must_change_password);
    let temporary: string | undefined;
    if (issue) {
      const begun = await rpc('identity_begin_temporary_access', { p_person_id: summary.data.person_id });
      if (begun.error) return rejected(begun.error, []);
      const authId = (begun.data as { auth_user_id?: string } | null)?.auth_user_id;
      if (!authId) return fail('operation_uncertain', 502);
      const updated = await provider.auth.admin.updateUserById(authId, { password });
      if (updated.error || updated.data.user?.id !== authId) return fail('auth_update_failed', 502);
      const finished = await rpc('identity_finish_temporary_access', { p_person_id: summary.data.person_id });
      if (finished.error) return rejected(finished.error, []);
      const after = identitySummarySchema.safeParse(finished.data);
      if (!after.success) return fail('operation_uncertain', 502);
      summary = after; temporary = password;
    }

    // 5. Optional caja. A refusal here never undoes the access: the admin assigns in Cajas.
    let register: StaffAccessResult['register'] = null;
    if (input.register_id) {
      const assigned = await command('assign', 'assignment_save', { membership_id: membershipId, register_id: input.register_id, status: 'active', version: null });
      register = { register_id: input.register_id, assigned: !assigned.error && commandResultSchema.safeParse(assigned.data).success };
    }
    const result: StaffAccessResult = {
      membership_id: membershipId, person_id: summary.data.person_id, display_name: summary.data.display_name, username: summary.data.username, role: input.role,
      email_kind: isInternalEmail(summary.data.email ?? email) ? 'internal' : 'real', existing_identity: !issue, must_change_password: summary.data.must_change_password, register,
    };
    return json(temporary ? { result, temporary_password: temporary } : { result });
  } catch { return fail('operation_uncertain', 502); }
}
