import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { invitationProvider, sameOrigin } from '../../../lib/auth/activation';
import { identityCommandSchema, identityErrors, identitySummarySchema } from '../../../lib/identity/contracts';
import { temporaryPassword } from '../../../lib/identity/temporary-password';
import { demoMutationBlock } from '../../../lib/auth/demo-guard';

// Phase 6A identity support. Authority (Platform support or tenant scope) is decided by the database
// for every step; the service role is used only for Auth-admin changes on the SAME Auth user. A
// temporary password exists only in this response: never logged, stored, audited or returned again.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
type RpcError = { code?: string; message?: string } | null;
const rpcFailure = (error: NonNullable<RpcError>) => {
  const known = error.message && error.message in identityErrors ? error.message : null;
  if (error.code === '42501') return json({ error: 'identity_support_required' }, 403);
  if (known && (error.code === '23505' || error.code === '40001')) return json({ error: known }, 409);
  if (known && error.code === '22023') return json({ error: known }, 422);
  return json({ error: 'identity_unavailable' }, 502);
};

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'same_origin_required' }, 403);
  let parsed;
  try { parsed = identityCommandSchema.safeParse(await request.json()); } catch { return json({ error: 'invalid_payload' }, 400); }
  if (!parsed.success) return json({ error: 'invalid_payload' }, 400);
  const op = parsed.data;
  try {
    const client = await createSupabaseServerClient();
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) return json({ error: 'authentication_required' }, 401);
    // UX 11: a Platform operator in a current Demo cannot change real identities (reads stay available).
    if (!['lookup', 'read', 'read_membership'].includes(op.operation)) {
      const block = await demoMutationBlock(client);
      if (block) return json({ error: block.error }, block.status);
    }
    const call = (name: string, args: Record<string, unknown>) => client.rpc(name, args) as unknown as Promise<{ data: unknown; error: RpcError }>;
    const summary = (data: unknown) => { const r = identitySummarySchema.safeParse(data); return r.success ? r.data : null; };
    const read = async (personId: string) => {
      const r = await call('identity_support_read', { p_person_id: personId });
      if (r.error) return rpcFailure(r.error);
      const s = summary(r.data); return s ? json({ result: s }) : json({ error: 'invalid_response' }, 502);
    };
    switch (op.operation) {
      case 'lookup': {
        const r = await call('identity_support_lookup', { p_identifier: op.identifier });
        if (r.error) return rpcFailure(r.error);
        const value = (r.data as { result?: unknown } | null)?.result ?? null;
        if (value === null) return json({ result: null });
        const s = summary(value); return s ? json({ result: { ...s, support_scope: 'platform' } }) : json({ error: 'invalid_response' }, 502);
      }
      case 'read': return read(op.person_id);
      case 'read_membership': {
        const r = await call('identity_support_read_membership', { p_membership_id: op.membership_id });
        if (r.error) return rpcFailure(r.error);
        const s = summary(r.data); return s ? json({ result: s }) : json({ error: 'invalid_response' }, 502);
      }
      case 'set_username': {
        const r = await call('identity_set_username', { p_person_id: op.person_id, p_username: op.username, p_expected_version: op.expected_version });
        return r.error ? rpcFailure(r.error) : read(op.person_id);
      }
      case 'change_email': {
        const begun = await call('identity_begin_email_change', { p_person_id: op.person_id, p_email: op.email, p_reason: op.reason });
        if (begun.error) return rpcFailure(begun.error);
        const authId = (begun.data as { auth_user_id?: string }).auth_user_id;
        if (!authId) return json({ error: 'identity_unavailable' }, 502);
        const updated = await invitationProvider().auth.admin.updateUserById(authId, { email: op.email, email_confirm: true });
        if (updated.error || updated.data.user?.id !== authId || updated.data.user.email?.toLowerCase() !== op.email) {
          return json({ error: updated.error && /already|exists|registered/i.test(updated.error.message) ? 'email_unavailable' : 'auth_update_failed' }, updated.error ? 409 : 502);
        }
        const finished = await call('identity_finish_email_change', { p_person_id: op.person_id });
        return finished.error ? rpcFailure(finished.error) : read(op.person_id);
      }
      case 'temporary_access': {
        const begun = await call('identity_begin_temporary_access', { p_person_id: op.person_id });
        if (begun.error) return rpcFailure(begun.error);
        const authId = (begun.data as { auth_user_id?: string }).auth_user_id;
        if (!authId) return json({ error: 'identity_unavailable' }, 502);
        const password = temporaryPassword();
        const updated = await invitationProvider().auth.admin.updateUserById(authId, { password });
        if (updated.error || updated.data.user?.id !== authId) return json({ error: 'auth_update_failed' }, 502);
        const finished = await call('identity_finish_temporary_access', { p_person_id: op.person_id });
        if (finished.error) return rpcFailure(finished.error);
        const s = summary(finished.data);
        return s ? json({ result: s, temporary_password: password }) : json({ error: 'invalid_response' }, 502);
      }
      case 'set_suspended': {
        const r = await call('identity_set_login_suspended', { p_person_id: op.person_id, p_suspended: op.suspended, p_reason: op.reason });
        if (r.error) return rpcFailure(r.error);
        const authId = (r.data as { auth_user_id?: string }).auth_user_id;
        if (!authId) return json({ error: 'identity_unavailable' }, 502);
        // Auth-level ban mirrors the authoritative PIKAS flag; retrying is safe (no second audit).
        const synced = await invitationProvider().auth.admin.updateUserById(authId, { ban_duration: op.suspended ? '876000h' : 'none' });
        if (synced.error) return json({ error: 'auth_sync_unavailable' }, 502);
        return read(op.person_id);
      }
    }
  } catch { return json({ error: 'identity_unavailable' }, 503); }
}
