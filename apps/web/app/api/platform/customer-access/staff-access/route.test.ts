import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), identity: vi.fn(), demo: vi.fn(), createUser: vi.fn(), updateUserById: vi.fn() }));
vi.mock('../../../../../lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock('../../../../../lib/auth/pikas-context', () => ({ resolvePikasIdentity: mocks.identity }));
vi.mock('../../../../../lib/auth/demo-guard', () => ({ demoMutationBlock: mocks.demo }));
vi.mock('../../../../../lib/auth/activation', () => ({ invitationProvider: () => ({ auth: { admin: { createUser: mocks.createUser, updateUserById: mocks.updateUserById } } }) }));
vi.mock('../../../../../lib/identity/temporary-password', () => ({ temporaryPassword: () => 'Temp-fictional-418xyz' }));
import { POST } from './route';

// UX 15: Platform one-step Personal POS — the Cafetería's workflow (UX 12B) bound to the Platform's
// existing commands. Fictional identifiers only.
const acc = '5e100000-0000-4000-8000-00000000000a', caf = '5e100000-0000-4000-8000-000000000001', key = '5e100000-0000-4000-8000-000000000009', inv = '5e100000-0000-4000-8000-000000000002', mem = '5e100000-0000-4000-8000-000000000003', person = '5e100000-0000-4000-8000-000000000004', auth = '5e100000-0000-4000-8000-000000000005', reg = '5e100000-0000-4000-8000-000000000006';
const body = { accountId: acc, cafeteriaId: caf, display_name: 'Ana Ficticia', username: 'Ana.Ficticia', register_id: reg };
const request = (payload: unknown = body, origin = 'http://localhost', k = key) => new NextRequest('http://localhost/api/platform/customer-access/staff-access', { method: 'POST', headers: { origin, 'Content-Type': 'application/json', 'Idempotency-Key': k }, body: JSON.stringify(payload) });
const summary = (patch: Record<string, unknown> = {}) => ({ person_id: person, display_name: 'Ana Ficticia', person_status: 'active', username: 'ana.ficticia', email: 'ana.ficticia.5e100000@cajeros.pikas.invalid', email_confirmed: true, last_sign_in_at: null, must_change_password: false, login_suspended: false, temporary_issued_at: null, pending_email: null, version: 1, memberships: [], audit: [], ...patch });
const calls = () => mocks.rpc.mock.calls.map(c => c[0]);
const operator = (caps: string[]) => ({ status: 'ready', platform: { capabilities: caps } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue(operator(['platform:customer:access:provision', 'platform:identity:support', 'platform:customer:operations:manage']));
  mocks.demo.mockResolvedValue(null);
  mocks.createUser.mockResolvedValue({ data: { user: { id: auth } }, error: null });
  mocks.updateUserById.mockImplementation(async (id: string) => ({ data: { user: { id } }, error: null }));
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'platform_customer_staff_command') return { data: { request_id: args.p_request_id, operation: args.p_operation, target_id: args.p_operation === 'staff_prepare' ? inv : mem, username: 'ana.ficticia' }, error: null };
    if (name === 'platform_support_cafeteria_command') return { data: { request_id: args.p_request_id, operation: args.p_operation, target_id: reg }, error: null };
    if (name === 'identity_support_read_membership') return { data: summary(), error: null };
    if (name === 'identity_begin_temporary_access') return { data: { auth_user_id: auth }, error: null };
    if (name === 'identity_finish_temporary_access') return { data: summary({ must_change_password: true, temporary_issued_at: '2026-10-23T12:00:00Z' }), error: null };
    return { data: null, error: { code: 'XX000', message: 'unexpected ' + name } };
  });
});

describe('Platform one-step Personal POS access', () => {
  it('runs the same steps as the Cafetería flow through the Platform commands: prepare, Auth identity, complete, credential, caja', async () => {
    const response = await POST(request()); const payload = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'platform_customer_staff_command', { p_account_id: acc, p_cafeteria_id: caf, p_request_id: key, p_operation: 'staff_prepare', p_payload: { email: 'ana.ficticia.5e100000@cajeros.pikas.invalid', role: 'pos_cashier' }, p_username: 'ana.ficticia', p_display_name: 'Ana Ficticia' });
    expect(mocks.createUser).toHaveBeenCalledWith({ email: 'ana.ficticia.5e100000@cajeros.pikas.invalid', password: 'Temp-fictional-418xyz', email_confirm: true });
    const complete = mocks.rpc.mock.calls[1]; expect(complete[0]).toBe('platform_customer_staff_command'); expect(complete[1]).toMatchObject({ p_account_id: acc, p_cafeteria_id: caf, p_operation: 'staff_complete', p_payload: { invitation_id: inv, display_name: 'Ana Ficticia' } }); expect(complete[1].p_request_id).not.toBe(key);
    expect(calls()).toEqual(['platform_customer_staff_command', 'platform_customer_staff_command', 'identity_support_read_membership', 'identity_begin_temporary_access', 'identity_finish_temporary_access', 'platform_support_cafeteria_command']);
    const assign = mocks.rpc.mock.calls[5][1]; expect(assign).toMatchObject({ p_account_id: acc, p_cafeteria_id: caf, p_operation: 'assignment_save', p_payload: { membership_id: mem, register_id: reg, status: 'active', version: null } });
    expect(payload).toEqual({ result: { membership_id: mem, person_id: person, display_name: 'Ana Ficticia', username: 'ana.ficticia', role: 'pos_cashier', email_kind: 'internal', existing_identity: false, must_change_password: true, register: { register_id: reg, assigned: true } }, temporary_password: 'Temp-fictional-418xyz' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('a real email is used as given; no caja when none chosen; the role is always Personal de caja', async () => {
    const response = await POST(request({ ...body, email: 'Ana@Example.invalid', register_id: null, role: 'pos_supervisor' }));
    expect(response.status).toBe(400); // strict schema: the Platform never takes a role
    const ok = await POST(request({ ...body, email: 'Ana@Example.invalid', register_id: null })); const payload = await ok.json();
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_payload: { email: 'ana@example.invalid', role: 'pos_cashier' } });
    expect(calls()).not.toContain('platform_support_cafeteria_command'); expect(payload.result.register).toBeNull();
  });
  it('requires the provisioning capability and refuses inside a Demo, with nothing created', async () => {
    mocks.identity.mockResolvedValue(operator(['platform:customer:operations:manage', 'platform:identity:support']));
    expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.createUser).not.toHaveBeenCalled();
    mocks.identity.mockResolvedValue(operator(['platform:customer:access:provision']));
    mocks.demo.mockResolvedValue({ error: 'demo_mode_active', status: 403 });
    const demo = await POST(request()); expect(demo.status).toBe(403); expect(await demo.json()).toEqual({ error: 'demo_mode_active' }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('a missing identity-support authority after the access exists is a named 403, never a hidden success; a refused caja never undoes the access', async () => {
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === 'identity_begin_temporary_access' ? { data: null, error: { code: '42501', message: 'identity_support_required' } }
      : name === 'platform_customer_staff_command' ? { data: { request_id: args.p_request_id, operation: args.p_operation, target_id: args.p_operation === 'staff_prepare' ? inv : mem }, error: null }
      : name === 'identity_support_read_membership' ? { data: summary(), error: null } : { data: null, error: { code: 'XX000' } });
    const response = await POST(request()); expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'identity_support_required' });
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === 'platform_support_cafeteria_command' ? { data: null, error: { code: '23514', message: 'active_register_required' } }
      : name === 'platform_customer_staff_command' ? { data: { request_id: args.p_request_id, operation: args.p_operation, target_id: args.p_operation === 'staff_prepare' ? inv : mem }, error: null }
      : name === 'identity_support_read_membership' ? { data: summary(), error: null } : name === 'identity_begin_temporary_access' ? { data: { auth_user_id: auth }, error: null }
      : name === 'identity_finish_temporary_access' ? { data: summary({ must_change_password: true }), error: null } : { data: null, error: { code: 'XX000' } });
    const refused = await POST(request()); const payload = await refused.json();
    expect(refused.status).toBe(200); expect(payload.result.register).toEqual({ register_id: reg, assigned: false }); expect(payload.temporary_password).toBe('Temp-fictional-418xyz');
  });
  it('rejects cross origin, a missing request key and an invalid username; raw errors never leak', async () => {
    expect((await POST(request(body, 'http://evil.invalid'))).status).toBe(403);
    expect((await POST(request(body, 'http://localhost', 'nope'))).status).toBe(400);
    expect((await POST(request({ ...body, username: 'a' }))).status).toBe(400);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'username_unavailable' } });
    const taken = await POST(request()); expect(taken.status).toBe(422); expect(await taken.json()).toEqual({ error: 'username_unavailable' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'internal detail' } });
    const unknown = await POST(request()); expect(unknown.status).toBe(502); expect(JSON.stringify(await unknown.json())).not.toContain('internal detail');
  });
});
