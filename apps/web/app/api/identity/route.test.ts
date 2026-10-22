import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, getUser, updateUserById, demo } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), updateUserById: vi.fn(), demo: vi.fn() }));
vi.mock('../../../lib/auth/demo-guard', () => ({ demoMutationBlock: demo }));
vi.mock('../../../lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc, auth: { getUser } })) }));
vi.mock('../../../lib/auth/activation', () => ({
  invitationProvider: () => ({ auth: { admin: { updateUserById } } }),
  sameOrigin: (r: Request) => r.headers.get('origin') === new URL(r.url).origin,
}));
import { POST } from './route';
import { temporaryPassword } from '../../../lib/identity/temporary-password';

const person = '6a000000-0000-4000-8000-000000000001', auth = '6a000000-0000-4000-8000-0000000000a1';
const summary = (over: Record<string, unknown> = {}) => ({ person_id: person, display_name: 'Cajera Ficticia', person_status: 'active', username: 'cajera.norte', email: 'cajera@example.invalid',
  email_confirmed: true, last_sign_in_at: null, must_change_password: false, login_suspended: false, temporary_issued_at: null, pending_email: null, version: 2,
  memberships: [{ scope: 'cafeteria', role: 'pos_cashier', status: 'active', name: 'Cafetería Norte' }], audit: [], support_scope: 'platform', ...over });
const post = (body: unknown, origin = 'https://pikas.test') => POST(new Request('https://pikas.test/api/identity', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
const calls = () => rpc.mock.calls.map(c => c[0]);

describe('Phase 6A identity support route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    demo.mockResolvedValue(null);
    getUser.mockResolvedValue({ data: { user: { id: 'operator' } } });
    updateUserById.mockImplementation(async (id: string, attrs: { email?: string }) => ({ data: { user: { id, email: attrs.email ?? 'cajera@example.invalid' } }, error: null }));
    rpc.mockImplementation(async (name: string) => {
      if (name === 'identity_begin_temporary_access' || name === 'identity_set_login_suspended') return { data: { auth_user_id: auth, changed: true }, error: null };
      if (name === 'identity_begin_email_change') return { data: { auth_user_id: auth, email: 'nuevo@example.invalid' }, error: null };
      if (name === 'identity_finish_temporary_access') return { data: summary({ must_change_password: true }), error: null };
      if (name === 'identity_support_lookup') return { data: { result: summary({ support_scope: undefined }) }, error: null };
      return { data: summary(), error: null };
    });
  });

  it('rejects cross-origin, unauthenticated and malformed requests before any RPC', async () => {
    expect((await post({ operation: 'read', person_id: person }, 'https://evil.test')).status).toBe(403);
    expect((await post({ operation: 'set_username', person_id: person, username: 'a..b', expected_version: 1 })).status).toBe(400);
    expect((await post({ operation: 'set_username', person_id: person, username: 'x@y.com', expected_version: 1 })).status).toBe(400);
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await post({ operation: 'read', person_id: person })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('username: normalized before the version-guarded RPC; conflicts map to safe messages', async () => {
    const r = await post({ operation: 'set_username', person_id: person, username: ' Cajera.Norte ', expected_version: 2 });
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('identity_set_username', { p_person_id: person, p_username: 'cajera.norte', p_expected_version: 2 });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'username_unavailable' } });
    const conflict = await post({ operation: 'set_username', person_id: person, username: 'otra', expected_version: 2 });
    expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: 'username_unavailable' });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'identity_support_required' } });
    expect((await post({ operation: 'set_username', person_id: person, username: 'otra', expected_version: 2 })).status).toBe(403);
  });

  it('temporary access: begin → Auth password on the SAME user → finish; the password is returned once, no-store, never logged', async () => {
    const log = vi.spyOn(console, 'log'), err = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn');
    const r = await post({ operation: 'temporary_access', person_id: person });
    const body = await r.json();
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(calls()).toEqual(['identity_begin_temporary_access', 'identity_finish_temporary_access']);
    expect(updateUserById).toHaveBeenCalledWith(auth, { password: body.temporary_password });
    expect(body.temporary_password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{14}$/);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(body.temporary_password);
    for (const spy of [log, err, warn]) expect(JSON.stringify(spy.mock.calls)).not.toContain(body.temporary_password);
    const again = await (await post({ operation: 'read', person_id: person })).json();
    expect(JSON.stringify(again)).not.toContain(body.temporary_password);
  });

  it('temporary access fails closed: no password is returned when the Auth update or the finish step fails', async () => {
    updateUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'down' } });
    const failed = await post({ operation: 'temporary_access', person_id: person });
    expect(failed.status).toBe(502); expect(await failed.json()).toEqual({ error: 'auth_update_failed' });
    expect(calls()).not.toContain('identity_finish_temporary_access');
    rpc.mockImplementation(async (name: string) => name === 'identity_begin_temporary_access' ? { data: { auth_user_id: auth }, error: null } : { data: null, error: { code: '40001', message: 'temporary_access_not_pending' } });
    const unfinished = await post({ operation: 'temporary_access', person_id: person });
    expect(unfinished.status).toBe(409); expect(JSON.stringify(await unfinished.json())).not.toContain('temporary_password');
  });

  it('email correction updates the SAME Auth user (confirmed) and then confirms in PIKAS', async () => {
    const r = await post({ operation: 'change_email', person_id: person, email: 'Nuevo@Example.Invalid', reason: 'Correo mal escrito' });
    expect(r.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(auth, { email: 'nuevo@example.invalid', email_confirm: true });
    expect(calls()).toEqual(['identity_begin_email_change', 'identity_finish_email_change', 'identity_support_read']);
    updateUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'A user with this email address has already been registered' } });
    const taken = await post({ operation: 'change_email', person_id: person, email: 'otro@example.invalid', reason: 'Prueba' });
    expect(await taken.json()).toEqual({ error: 'email_unavailable' });
    updateUserById.mockResolvedValueOnce({ data: { user: { id: 'another-user', email: 'x@example.invalid' } }, error: null });
    expect((await post({ operation: 'change_email', person_id: person, email: 'x@example.invalid', reason: 'Prueba' })).status).toBe(502);
  });

  it('suspension mirrors the PIKAS flag as an Auth ban and reactivation lifts it', async () => {
    await post({ operation: 'set_suspended', person_id: person, suspended: true, reason: 'Solicitud del cliente' });
    expect(updateUserById).toHaveBeenLastCalledWith(auth, { ban_duration: '876000h' });
    await post({ operation: 'set_suspended', person_id: person, suspended: false, reason: 'Acceso restablecido' });
    expect(updateUserById).toHaveBeenLastCalledWith(auth, { ban_duration: 'none' });
    updateUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'down' } });
    expect(await (await post({ operation: 'set_suspended', person_id: person, suspended: true, reason: 'Prueba' })).json()).toEqual({ error: 'auth_sync_unavailable' });
  });

  it('lookup is exact and returns null for no match; Platform scope is stated', async () => {
    const found = await (await post({ operation: 'lookup', identifier: 'cajera.norte' })).json();
    expect(found.result.support_scope).toBe('platform');
    rpc.mockResolvedValueOnce({ data: { result: null }, error: null });
    expect(await (await post({ operation: 'lookup', identifier: 'nadie' })).json()).toEqual({ result: null });
  });

  it('generated temporary passwords are random and long enough for the 10-character policy', () => {
    const set = new Set(Array.from({ length: 200 }, temporaryPassword));
    expect(set.size).toBe(200); for (const p of set) expect(p.length).toBeGreaterThanOrEqual(10);
  });
});

describe('UX 11: identity mutations during a current Demo', () => {
  beforeEach(() => { vi.clearAllMocks(); demo.mockResolvedValue({ error: 'demo_mode_active', status: 403 }); getUser.mockResolvedValue({ data: { user: { id: 'operator' } } }); });
  it.each([
    { operation: 'set_username', person_id: person, username: 'nuevo.usuario', expected_version: 2 },
    { operation: 'temporary_access', person_id: person },
    { operation: 'set_suspended', person_id: person, suspended: true, reason: 'Motivo ficticio de prueba' },
  ])('refuses %j before any identity RPC', async (body) => {
    const response = await post(body);
    expect(response.status).toBe(403); expect((await response.json()).error).toBe('demo_mode_active'); expect(rpc).not.toHaveBeenCalled(); expect(updateUserById).not.toHaveBeenCalled();
  });
  it('reads stay available (the Demo guard is a mutation guard)', async () => {
    rpc.mockResolvedValue({ data: summary(), error: null });
    expect((await post({ operation: 'read', person_id: person })).status).toBe(200); expect(demo).not.toHaveBeenCalled();
  });
});
