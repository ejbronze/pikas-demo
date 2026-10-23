import { createHash } from 'node:crypto';
import { identitySummarySchema } from './contracts';
import { isUsernameRejection } from './provisioning';
import { z } from 'zod';
import { commandResultSchema } from '../cafeteria/contracts';

// Step results: request key, operation and target. The Platform commands may add fields; extra keys are ignored.
const stepResultSchema = z.object({ request_id: z.uuid(), operation: z.string(), target_id: z.guid().nullable() }).loose();
import { internalEmail, isInternalEmail, type StaffAccessRequest, type StaffAccessResult } from './staff-access';

// One-step POS staff access (UX 12B), as a shared composition. The Cafetería Admin route and the
// Platform route run the SAME steps in the SAME order; what differs is who prepares, completes and
// assigns (each caller's own command, with its own authority re-checked by the database):
//   1. prepare: invitation + reserved username (the caller's exact-key journalled step)
//   2. a confirmed Auth identity for the invitation's address (service role, Auth only)
//   3. complete: Person + POS membership in THIS cafetería (derived key, replayable)
//   4. identity_begin/finish_temporary_access — only for an identity that has never signed in
//   5. optional assignment to one caja (derived key); a refusal never undoes the access
// The temporary password exists only in the response: never logged, stored, audited or re-read.
export type RpcError = { code?: string; message?: string } | null;
export type RpcResult = { data: unknown; error: RpcError };
export type AuthAdmin = { auth: { admin: {
  createUser: (attrs: { email: string; password: string; email_confirm: boolean }) => Promise<{ data: { user: { id: string } | null } | null; error: { code?: string; message: string } | null }>;
  updateUserById: (id: string, attrs: { password: string }) => Promise<{ data: { user: { id: string } | null } | null; error: unknown }>;
} } };
export type StaffAccessDeps = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  provider: AuthAdmin;
  prepare: (email: string) => Promise<RpcResult>;
  complete: (invitationId: string, requestId: string) => Promise<RpcResult>;
  assign: (membershipId: string, registerId: string, requestId: string) => Promise<RpcResult>;
  // The caller's name for an authority refusal (42501) and its definite, explained rejections.
  authorityError: string;
};
export type StaffAccessOutcome = { status: number; body: unknown };

// A deterministic request key per step, so an exact retry of the same request replays each step.
export const deriveKey = (key: string, step: string) => { const h = createHash('sha256').update(`${key}:${step}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${(parseInt(h[16], 16) & 0x3 | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const fail = (error: string, status: number): StaffAccessOutcome => ({ status, body: { error } });
const completeRejections = ['confirmed_identity_pending', 'existing_membership_not_active', 'active_person_required', 'pending_staff_invitation_required', 'customer_provisioning_inactive', 'inactive_cafeteria'];
export const rejected = (error: NonNullable<RpcError>, known: string[], authorityError: string): StaffAccessOutcome => {
  if (error.code === '42501') return error.message === 'tenant_identity_required' ? fail('identity_outside_customer', 422) : error.message === 'identity_support_required' ? fail('identity_support_required', 403) : fail(authorityError, 403);
  if (isUsernameRejection(error.message)) return fail(error.message!, 422);
  if (error.message && known.includes(error.message)) return fail(error.message, 422);
  if (error.code === '23505' && error.message === 'request_key_reused') return fail('request_key_reused', 409);
  return fail('operation_uncertain', 502);
};

export async function runStaffAccess(input: StaffAccessRequest, key: string, password: string, deps: StaffAccessDeps): Promise<StaffAccessOutcome> {
  const email = input.email ?? internalEmail(input.username, key);
  // 1. Prepared access with the reserved username.
  const prepared = await deps.prepare(email);
  if (prepared.error) return rejected(prepared.error, [], deps.authorityError);
  const invitation = stepResultSchema.safeParse(prepared.data);
  if (!invitation.success || invitation.data.operation !== 'staff_prepare' || !invitation.data.target_id) return fail('operation_uncertain', 502);

  // 2. A confirmed Auth identity. An address already registered is an existing identity (or a
  //    previous attempt of this same request): never recreated, never duplicated.
  const created = await deps.provider.auth.admin.createUser({ email, password, email_confirm: true });
  const createdNow = !created.error;
  if (created.error && created.error.code !== 'email_exists' && !/already|exists|registered/i.test(created.error.message)) return fail('auth_create_failed', 502);

  // 3. Person + POS membership (the database re-checks every boundary).
  const completed = await deps.complete(invitation.data.target_id, deriveKey(key, 'complete'));
  if (completed.error) return rejected(completed.error, completeRejections, deps.authorityError);
  const membership = stepResultSchema.safeParse(completed.data);
  if (!membership.success || membership.data.operation !== 'staff_complete' || !membership.data.target_id) return fail('operation_uncertain', 502);
  const membershipId = membership.data.target_id;
  const read = await deps.rpc('identity_support_read_membership', { p_membership_id: membershipId });
  if (read.error) return rejected(read.error, [], deps.authorityError);
  let summary = identitySummarySchema.safeParse(read.data);
  if (!summary.success) return fail('operation_uncertain', 502);

  // 4. One-time credential only for an identity that has never signed in; an identity created in
  //    an earlier attempt of this request gets a fresh one (the earlier password is unknown).
  const neverSignedIn = summary.data.last_sign_in_at === null;
  const issue = createdNow || (neverSignedIn && summary.data.must_change_password);
  let temporary: string | undefined;
  if (issue) {
    const begun = await deps.rpc('identity_begin_temporary_access', { p_person_id: summary.data.person_id });
    if (begun.error) return rejected(begun.error, [], deps.authorityError);
    const authId = (begun.data as { auth_user_id?: string } | null)?.auth_user_id;
    if (!authId) return fail('operation_uncertain', 502);
    const updated = await deps.provider.auth.admin.updateUserById(authId, { password });
    if (updated.error || updated.data?.user?.id !== authId) return fail('auth_update_failed', 502);
    const finished = await deps.rpc('identity_finish_temporary_access', { p_person_id: summary.data.person_id });
    if (finished.error) return rejected(finished.error, [], deps.authorityError);
    const after = identitySummarySchema.safeParse(finished.data);
    if (!after.success) return fail('operation_uncertain', 502);
    summary = after; temporary = password;
  }

  // 5. Optional caja. A refusal here never undoes the access.
  let register: StaffAccessResult['register'] = null;
  if (input.register_id) {
    const assigned = await deps.assign(membershipId, input.register_id, deriveKey(key, 'assign'));
    register = { register_id: input.register_id, assigned: !assigned.error && commandResultSchema.safeParse(assigned.data).success };
  }
  const result: StaffAccessResult = {
    membership_id: membershipId, person_id: summary.data.person_id, display_name: summary.data.display_name, username: summary.data.username, role: input.role,
    email_kind: isInternalEmail(summary.data.email ?? email) ? 'internal' : 'real', existing_identity: !issue, must_change_password: summary.data.must_change_password, register,
  };
  return { status: 200, body: temporary ? { result, temporary_password: temporary } : { result } };
}
