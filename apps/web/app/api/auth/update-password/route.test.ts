import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { updateUser, rpc, resolvePikasIdentity, pilotHome } = vi.hoisted(() => ({ updateUser: vi.fn(), rpc: vi.fn(), resolvePikasIdentity: vi.fn(), pilotHome: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn(async () => ({ auth: { updateUser }, rpc })) }));
vi.mock('@/lib/auth/pikas-context', () => ({ resolvePikasIdentity, pilotHome }));
import { POST } from './route';
const submit = (password: string) => { const f = new FormData(); f.set('password', password); return POST(new NextRequest('https://pikas.test/api/auth/update-password', { method: 'POST', body: f })); };

describe('Phase 6A forced password change', () => {
  beforeEach(() => { vi.clearAllMocks(); updateUser.mockResolvedValue({ error: null }); rpc.mockResolvedValue({ data: { must_change_password: false }, error: null }); resolvePikasIdentity.mockResolvedValue({ status: 'ready' }); pilotHome.mockReturnValue('/pos'); });
  it('sets the password on the signed-in user, completes the change and returns the home', async () => {
    const r = await submit('una-clave-nueva');
    expect(updateUser).toHaveBeenCalledWith({ password: 'una-clave-nueva' });
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['pikas_session_start', 'identity_complete_password_change']);
    expect(await r.json()).toEqual({ ok: true, next: '/pos' });
  });
  it('keeping the temporary password is refused', async () => {
    rpc.mockImplementation(async (name: string) => name === 'pikas_session_start' ? { data: {}, error: null } : { data: null, error: { code: '22023', message: 'password_change_required' } });
    const r = await submit('una-clave-nueva'); expect(r.status).toBe(409); expect(await r.json()).toEqual({ error: 'password_change_required' });
  });
  it('recovery: an unavailable completion never reports the saved password as failed', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'application_session_expired' } });
    expect(await (await submit('una-clave-nueva')).json()).toEqual({ ok: true, next: null });
  });
  it('short passwords never reach Auth', async () => { expect((await submit('corta')).status).toBe(400); expect(updateUser).not.toHaveBeenCalled(); });
});
