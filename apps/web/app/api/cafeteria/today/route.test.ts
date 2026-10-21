import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock('../../../../lib/supabase/server', () => ({ createSupabaseServerClient: mocks.create }));
vi.mock('../../../../lib/auth/cafeteria-access', () => ({ resolveCafeteriaAccess: mocks.access }));
import { POST } from './route';
import { todayId as id, todayRead } from '../../../../lib/cafeteria/today-fixtures';
const request = (payload: unknown = { cafeteria_id: id }, origin = 'http://localhost') => new Request('http://localhost/api/cafeteria/today', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.access.mockResolvedValue({ status: 'authorized', context: { cafeterias: [{ cafeteria_id: id }] } }); mocks.rpc.mockResolvedValue({ data: todayRead({ today: { 9: [5000, 1] } }), error: null }); });
describe('Cafetería Hoy server boundary', () => {
  it('calls only the database read with the cafeteria id; no client dates, times or totals', async () => {
    const response = await POST(request()); expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('cafeteria_today_read', { p_cafeteria_id: id });
    expect((await response.json()).result.data.today_gross_minor).toBe('5000');
  });
  it.each([['unauthenticated', 401], ['forbidden', 403], ['unavailable', 503]])('rejects %s', async (status, code) => { mocks.access.mockResolvedValue({ status }); expect((await POST(request())).status).toBe(code); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('denies a cafeteria outside the actor context', async () => { expect((await POST(request({ cafeteria_id: '4d300000-0000-4000-8000-000000000002' }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('rejects cross origin and untrusted extra input', async () => {
    expect((await POST(request({ cafeteria_id: id }, 'https://other.invalid'))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled();
    for (const extra of [{ today: '2026-10-20' }, { as_of: '12:40' }, { account_id: id }]) expect((await POST(request({ cafeteria_id: id, ...extra }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('maps database denial and failure without details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'financial_admin_authority_required' } }); expect((await POST(request())).status).toBe(403);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private-database-details' } }); const r = await POST(request()); expect(r.status).toBe(502); expect(JSON.stringify(await r.json())).not.toContain('private');
  });
  it('treats malformed or mismatched results as unavailable, never as zeros', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...todayRead(), data: {} }, error: null }); expect((await POST(request())).status).toBe(502);
    mocks.rpc.mockResolvedValue({ data: { ...todayRead(), cafeteria_id: '4d300000-0000-4000-8000-000000000002' }, error: null }); expect((await POST(request())).status).toBe(502);
  });
});
