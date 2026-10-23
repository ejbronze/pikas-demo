import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), createUser: vi.fn(), updateUserById: vi.fn() }));
vi.mock('../../../../lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock('../../../../lib/auth/cafeteria-access', () => ({ resolveCafeteriaAccess: mocks.access }));
vi.mock('../../../../lib/auth/activation', () => ({ invitationProvider: () => ({ auth: { admin: { createUser: mocks.createUser, updateUserById: mocks.updateUserById } } }) }));
vi.mock('../../../../lib/identity/temporary-password', () => ({ temporaryPassword: () => 'Temp-fictional-418xyz' }));
import { POST } from './route';

const caf = '4d200000-0000-4000-8000-000000000001', key = '4d200000-0000-4000-8000-000000000009', inv = '4d200000-0000-4000-8000-000000000002', mem = '4d200000-0000-4000-8000-000000000003', person = '4d200000-0000-4000-8000-000000000004', auth = '4d200000-0000-4000-8000-000000000005', reg = '4d200000-0000-4000-8000-000000000006';
const body = { cafeteriaId: caf, display_name: 'Ana Ficticia', role: 'pos_cashier', username: 'Ana.Ficticia', register_id: reg };
const request = (payload: unknown = body, origin = 'http://localhost', k = key) => new NextRequest('http://localhost/api/cafeteria/staff-access', { method: 'POST', headers: { origin, 'Content-Type': 'application/json', 'Idempotency-Key': k }, body: JSON.stringify(payload) });
const summary = (patch: Record<string, unknown> = {}) => ({ person_id: person, display_name: 'Ana Ficticia', person_status: 'active', username: 'ana.ficticia', email: 'ana.ficticia.4d200000@cajeros.pikas.invalid', email_confirmed: true, last_sign_in_at: null, must_change_password: false, login_suspended: false, temporary_issued_at: null, pending_email: null, version: 1, memberships: [{ scope: 'cafeteria', role: 'pos_cashier', status: 'active', name: 'Cafetería Santiago' }], audit: [], ...patch });
const calls = () => mocks.rpc.mock.calls.map(c => c[0]);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ status: 'authorized', context: { cafeterias: [{ cafeteria_id: caf, tenant_kind: 'customer' }] } });
  mocks.createUser.mockResolvedValue({ data: { user: { id: auth } }, error: null });
  mocks.updateUserById.mockImplementation(async (id: string) => ({ data: { user: { id } }, error: null }));
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'provisioning_prepare_with_username') return { data: { request_id: key, operation: 'staff_prepare', target_id: inv, username: 'ana.ficticia' }, error: null };
    if (name === 'cafeteria_admin_command') return { data: { request_id: args.p_request_id, operation: args.p_operation, target_id: args.p_operation === 'staff_complete' ? mem : reg }, error: null };
    if (name === 'identity_support_read_membership') return { data: summary(), error: null };
    if (name === 'identity_begin_temporary_access') return { data: { auth_user_id: auth }, error: null };
    if (name === 'identity_finish_temporary_access') return { data: summary({ must_change_password: true, temporary_issued_at: '2026-10-22T20:00:00Z' }), error: null };
    return { data: null, error: { code: 'XX000', message: 'unexpected ' + name } };
  });
});

describe('UX 12B one-step staff access', () => {
  it('new person without email: internal address, reserved username, confirmed Auth identity, membership, one-time credential, caja', async () => {
    const response = await POST(request()); const payload = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'provisioning_prepare_with_username', { p_flow: 'cafeteria_staff', p_request_id: key, p_school_id: null, p_cafeteria_id: caf, p_payload: { email: 'ana.ficticia.4d200000@cajeros.pikas.invalid', role: 'pos_cashier' }, p_username: 'ana.ficticia' });
    expect(mocks.createUser).toHaveBeenCalledWith({ email: 'ana.ficticia.4d200000@cajeros.pikas.invalid', password: 'Temp-fictional-418xyz', email_confirm: true });
    const complete = mocks.rpc.mock.calls[1]; expect(complete[0]).toBe('cafeteria_admin_command'); expect(complete[1]).toMatchObject({ p_cafeteria_id: caf, p_operation: 'staff_complete', p_payload: { invitation_id: inv, display_name: 'Ana Ficticia' } });
    expect(complete[1].p_request_id).not.toBe(key); expect(complete[1].p_request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(calls()).toEqual(['provisioning_prepare_with_username', 'cafeteria_admin_command', 'identity_support_read_membership', 'identity_begin_temporary_access', 'identity_finish_temporary_access', 'cafeteria_admin_command']);
    expect(mocks.updateUserById).toHaveBeenCalledWith(auth, { password: 'Temp-fictional-418xyz' });
    const assign = mocks.rpc.mock.calls[5][1]; expect(assign).toMatchObject({ p_operation: 'assignment_save', p_payload: { membership_id: mem, register_id: reg, status: 'active', version: null } }); expect(assign.p_request_id).not.toBe(complete[1].p_request_id);
    expect(payload).toEqual({ result: { membership_id: mem, person_id: person, display_name: 'Ana Ficticia', username: 'ana.ficticia', role: 'pos_cashier', email_kind: 'internal', existing_identity: false, must_change_password: true, register: { register_id: reg, assigned: true } }, temporary_password: 'Temp-fictional-418xyz' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('derived step keys are stable for the same request key (an exact retry replays each step) and differ per key', async () => {
    await POST(request()); const first = mocks.rpc.mock.calls[1][1].p_request_id; vi.clearAllMocks();
    await POST(request()); expect(mocks.rpc.mock.calls[1][1].p_request_id).toBe(first); vi.clearAllMocks();
    await POST(request(body, 'http://localhost', '4d200000-0000-4000-8000-000000000099')); expect(mocks.rpc.mock.calls[1][1].p_request_id).not.toBe(first);
  });
  it('a real email is used as given (lowercased) and reported as real; no caja when none chosen', async () => {
    const response = await POST(request({ ...body, email: 'Ana@Example.invalid', register_id: null })); expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'provisioning_prepare_with_username', expect.objectContaining({ p_payload: { email: 'ana@example.invalid', role: 'pos_cashier' } }));
    expect(calls()).not.toContain('assignment_save'); const payload = await response.json(); expect(payload.result.register).toBeNull(); expect(payload.result.email_kind).toBe('internal'); // summary email decides; fixture is internal
  });
  it('an existing identity that already signed in keeps its password: linked, no temporary credential, no Auth password change', async () => {
    mocks.createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } });
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'provisioning_prepare_with_username') return { data: { request_id: key, operation: 'staff_prepare', target_id: inv }, error: null };
      if (name === 'cafeteria_admin_command') return { data: { request_id: args.p_request_id, operation: args.p_operation, target_id: mem }, error: null };
      if (name === 'identity_support_read_membership') return { data: summary({ email: 'ana@example.invalid', last_sign_in_at: '2026-10-01T10:00:00Z' }), error: null };
      return { data: null, error: { code: 'XX000', message: 'unexpected ' + name } };
    });
    const response = await POST(request({ ...body, email: 'ana@example.invalid', register_id: null })); const payload = await response.json();
    expect(response.status).toBe(200); expect(payload.temporary_password).toBeUndefined(); expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(calls()).toEqual(['provisioning_prepare_with_username', 'cafeteria_admin_command', 'identity_support_read_membership']);
    expect(payload.result).toMatchObject({ existing_identity: true, email_kind: 'real', must_change_password: false });
  });
  it('a previous attempt of the same request (identity exists, never signed in, change pending) gets a fresh one-time credential', async () => {
    mocks.createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'already registered' } });
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'provisioning_prepare_with_username') return { data: { request_id: key, operation: 'staff_prepare', target_id: inv }, error: null };
      if (name === 'cafeteria_admin_command') return { data: { request_id: args.p_request_id, operation: args.p_operation, target_id: mem }, error: null };
      if (name === 'identity_support_read_membership') return { data: summary({ must_change_password: true, temporary_issued_at: '2026-10-22T19:00:00Z' }), error: null };
      if (name === 'identity_begin_temporary_access') return { data: { auth_user_id: auth }, error: null };
      if (name === 'identity_finish_temporary_access') return { data: summary({ must_change_password: true, temporary_issued_at: '2026-10-22T20:00:00Z' }), error: null };
      return { data: null, error: { code: 'XX000', message: 'unexpected ' + name } };
    });
    const payload = await (await POST(request({ ...body, register_id: null }))).json();
    expect(payload.temporary_password).toBe('Temp-fictional-418xyz'); expect(mocks.updateUserById).toHaveBeenCalledWith(auth, { password: 'Temp-fictional-418xyz' }); expect(payload.result.existing_identity).toBe(false);
  });
  it('a refused caja never undoes the access: reported as not assigned', async () => {
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'provisioning_prepare_with_username') return { data: { request_id: key, operation: 'staff_prepare', target_id: inv }, error: null };
      if (name === 'cafeteria_admin_command' && args.p_operation === 'assignment_save') return { data: null, error: { code: '23514', message: 'active_pos_membership_and_register_required' } };
      if (name === 'cafeteria_admin_command') return { data: { request_id: args.p_request_id, operation: args.p_operation, target_id: mem }, error: null };
      if (name === 'identity_support_read_membership') return { data: summary(), error: null };
      if (name === 'identity_begin_temporary_access') return { data: { auth_user_id: auth }, error: null };
      if (name === 'identity_finish_temporary_access') return { data: summary({ must_change_password: true, temporary_issued_at: '2026-10-22T20:00:00Z' }), error: null };
      return { data: null, error: { code: 'XX000', message: 'unexpected ' + name } };
    });
    const response = await POST(request()); expect(response.status).toBe(200); expect((await response.json()).result.register).toEqual({ register_id: reg, assigned: false });
  });
  it.each([['unauthenticated', 401], ['forbidden', 403], ['unavailable', 503]])('rejects %s server authority before any step', async (status, code) => {
    mocks.access.mockResolvedValue({ status }); expect((await POST(request())).status).toBe(code); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.createUser).not.toHaveBeenCalled();
  });
  it('another cafetería, a sandbox cafetería and a Demo persona are refused with nothing created', async () => {
    expect((await POST(request({ ...body, cafeteriaId: '4d200000-0000-4000-8000-000000000077' }))).status).toBe(403);
    mocks.access.mockResolvedValue({ status: 'authorized', context: { cafeterias: [{ cafeteria_id: caf, tenant_kind: 'sandbox' }] } });
    expect(await (await POST(request())).json()).toEqual({ error: 'sandbox_unsupported' });
    mocks.access.mockResolvedValue({ status: 'authorized', pov: { pov_code: 'cafeteria_admin' }, context: { pov: { pov_code: 'cafeteria_admin' }, cafeterias: [{ cafeteria_id: caf, tenant_kind: 'customer' }] } });
    expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.createUser).not.toHaveBeenCalled();
  });
  it('Demo Lab: the sandbox cafetería-admin POV runs the same one-step flow inside its sandbox', async () => {
    mocks.access.mockResolvedValue({ status: 'authorized', context: { pov: { pov_code: 'cafeteria_admin' }, cafeterias: [{ cafeteria_id: caf, tenant_kind: 'sandbox' }] } });
    expect((await POST(request())).status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith('provisioning_prepare_with_username', expect.objectContaining({ p_flow: 'cafeteria_staff', p_cafeteria_id: caf }));
  });
  it.each(['role_code', 'person_id', 'auth_id', 'account_id', 'must_change_password'])('rejects browser-supplied %s', async field => {
    expect((await POST(request({ ...body, [field]: auth }))).status).toBe(400); expect(mocks.access).not.toHaveBeenCalled();
  });
  it('rejects cross origin, a missing request key and an invalid username', async () => {
    expect((await POST(request(body, 'https://other.invalid'))).status).toBe(403);
    expect((await POST(request(body, 'http://localhost', ''))).status).toBe(400);
    expect((await POST(request({ ...body, username: 'x@y' }))).status).toBe(400);
  });
  it('username collisions and identity boundaries are definite, explained rejections; raw errors never leak', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'username_unavailable' } });
    expect(await (await POST(request())).json()).toEqual({ error: 'username_unavailable' }); expect(mocks.createUser).not.toHaveBeenCalled();
    mocks.rpc.mockImplementation(async (name: string) => name === 'provisioning_prepare_with_username' ? { data: { request_id: key, operation: 'staff_prepare', target_id: inv }, error: null } : { data: null, error: { code: '42501', message: 'tenant_identity_required' } });
    const outside = await POST(request()); expect(outside.status).toBe(422); expect(await outside.json()).toEqual({ error: 'identity_outside_customer' });
    mocks.rpc.mockImplementation(async (name: string) => name === 'provisioning_prepare_with_username' ? { data: { request_id: key, operation: 'staff_prepare', target_id: inv }, error: null } : { data: null, error: { code: 'XX000', message: 'secret-internals' } });
    const opaque = await POST(request()); expect(opaque.status).toBe(502); expect(await opaque.text()).not.toContain('secret-internals');
  });
  it('an Auth failure after the identity is issued is reported, not hidden; the password never appears in an error', async () => {
    mocks.updateUserById.mockResolvedValue({ data: { user: null }, error: { message: 'down' } });
    const response = await POST(request()); expect(response.status).toBe(502); const text = await response.text(); expect(text).toContain('auth_update_failed'); expect(text).not.toContain('Temp-fictional');
  });
});
