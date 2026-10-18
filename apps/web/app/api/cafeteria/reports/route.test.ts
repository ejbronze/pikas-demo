import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock('../../../../lib/supabase/server', () => ({ createSupabaseServerClient: mocks.create }));
vi.mock('../../../../lib/auth/cafeteria-access', () => ({ resolveCafeteriaAccess: mocks.access }));
import { POST } from './route';
import { summary } from '../../../../lib/cafeteria/report-fixtures';
const id = '5d100000-0000-4000-8000-000000000001';
const body = { cafeteria_id: id, period: 'last_30_days', from: null, to: null };
const request = (payload: unknown = body, origin = 'http://localhost') => new Request('http://localhost/api/cafeteria/reports', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.access.mockResolvedValue({ status: 'authorized', context: { cafeterias: [{ cafeteria_id: id }] } }); mocks.rpc.mockResolvedValue({ data: summary(), error: null }); });
describe('sales report server boundary', () => {
  it('reads the authoritative summary without client totals or actor', async () => {
    const response = await POST(request()); expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('cafeteria_report_read', { p_cafeteria_id: id, p_kind: 'sales_summary', p_period: 'last_30_days', p_from: null, p_to: null });
    expect((await response.json()).result.data.net_sales_minor).toBe('10000');
  });
  it.each([['unauthenticated', 401], ['forbidden', 403], ['unavailable', 503]])('rejects %s', async (status, code) => { mocks.access.mockResolvedValue({ status }); expect((await POST(request())).status).toBe(code); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('denies a cafeteria outside the actor context', async () => { expect((await POST(request({ ...body, cafeteria_id: '5d100000-0000-4000-8000-000000000002' }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('rejects cross origin before authorization', async () => { expect((await POST(request(body, 'https://other.invalid'))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled(); });
  it.each([{ period: 'custom', from: '2026-07-17', to: '2026-10-17' }, { period: 'custom', from: '2026-10-18', to: '2026-10-17' }, { gross_sales_minor: '1' }, { kind: 'products' }])('rejects invalid or untrusted input %j', async change => {
    expect((await POST(request({ ...body, ...change }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('maps database authority denial and range rejection without details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'financial_admin_authority_required' } }); expect((await POST(request())).status).toBe(403);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'report_range_too_long' } }); const r = await POST(request()); expect(r.status).toBe(422); expect((await r.json()).error).toBe('report_range_too_long');
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private-database-details' } }); const u = await POST(request()); expect(u.status).toBe(502); expect(JSON.stringify(await u.json())).not.toContain('private');
  });
  it('treats malformed or mismatched results as unavailable, never as zeros', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...summary(), data: {} }, error: null }); expect((await POST(request())).status).toBe(502);
    mocks.rpc.mockResolvedValue({ data: summary(), error: null }); expect((await POST(request({ ...body, period: 'today' }))).status).toBe(502);
  });
});
