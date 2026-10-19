import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock('../../../../lib/supabase/server', () => ({ createSupabaseServerClient: mocks.create }));
vi.mock('../../../../lib/auth/school-access', () => ({ resolveSchoolAccess: mocks.access }));
import { POST } from './route';
const id = '5d500000-0000-4000-8000-000000000001', other = '5d500000-0000-4000-8000-000000000002', caf = '5d500000-0000-4000-8000-000000000003';
const body = { school_id: id, period: 'last_30_days', from: null, to: null };
const tally = (amount_minor: string, count: number) => ({ amount_minor, count });
export const walletReport = (over: Record<string, unknown> = {}) => ({ school_id: id, tenant_kind: 'customer', business_timezone: 'America/Santo_Domingo', currency_code: 'DOP',
  period: 'last_30_days', from: '2026-09-20', to: '2026-10-19', today: '2026-10-19', as_of: '2026-10-19T15:00:00Z',
  current: { total_balance_minor: '15400', wallet_count: 3, active_wallet_count: 3, frozen_wallet_count: 0, negative_wallet_count: 0, negative_balance_minor: '0' },
  movements: { replenishments: tally('22500', 3), reversals: tally('2500', 1), net_replenished_minor: '20000', purchases: tally('8500', 1), refunds: tally('5000', 1),
    adjustment_credits: tally('0', 0), adjustment_debits: tally('1100', 2), historical_adjustments: { net_minor: '0', count: 0 }, net_movement_minor: '15400', entry_count: 8, wallets_with_movement: 1 },
  cafeterias: [{ cafeteria_id: caf, name: 'Cafetería Ficticia', spent_minor: '8500', purchase_count: 1, refunded_minor: '5000', refund_count: 1 }], ...over });
const request = (payload: unknown = body, origin = 'http://localhost') => new Request('http://localhost/api/school/wallet-report', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.access.mockResolvedValue({ status: 'authorized', context: { schools: [{ school_id: id }] } }); mocks.rpc.mockResolvedValue({ data: walletReport(), error: null }); });
describe('5D.5 school PIKAS Cash report boundary', () => {
  it('reads the authoritative report and passes only school and period', async () => {
    const response = await POST(request()); expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('school_wallet_report', { p_school_id: id, p_period: 'last_30_days', p_from: null, p_to: null });
    expect((await response.json()).result.cafeterias[0].spent_minor).toBe('8500');
  });
  it.each([['unauthenticated', 401], ['forbidden', 403], ['unavailable', 503]])('rejects %s', async (status, code) => { mocks.access.mockResolvedValue({ status }); expect((await POST(request())).status).toBe(code); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('denies another school, the sandbox POV and cross-origin requests before the database', async () => {
    expect((await POST(request({ ...body, school_id: other }))).status).toBe(403);
    mocks.access.mockResolvedValue({ status: 'authorized', context: { pov: { pov_code: 'school_admin' }, schools: [{ school_id: id }] } }); expect((await POST(request())).status).toBe(403);
    expect((await POST(request(body, 'https://other.invalid'))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ period: 'custom', from: '2026-01-01', to: '2026-10-19' }, { period: 'custom', from: null, to: null }, { period: 'today', from: '2026-10-19', to: '2026-10-19' }, { period: 'yesterday' }, { cafeteria_id: caf }, { total_balance_minor: '1' }])('rejects invalid or untrusted input %j', async change => {
    expect((await POST(request({ ...body, ...change }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('maps authority denial and range errors without database detail; refuses malformed or sales-bearing results', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'school_authority_required' } }); expect((await POST(request())).status).toBe(403);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'report_range_too_long' } }); const r = await POST(request()); expect(r.status).toBe(422); expect((await r.json()).error).toBe('report_range_too_long');
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private-database-details' } }); const u = await POST(request()); expect(u.status).toBe(502); expect(JSON.stringify(await u.json())).not.toContain('private');
    mocks.rpc.mockResolvedValue({ data: walletReport({ gross_sales_minor: '30000' }), error: null }); expect((await POST(request())).status).toBe(502);
    mocks.rpc.mockResolvedValue({ data: walletReport({ cafeterias: [{ cafeteria_id: caf, name: 'X', spent_minor: '1', purchase_count: 1, refunded_minor: '0', refund_count: 0, cash_sales_minor: '9' }] }), error: null }); expect((await POST(request())).status).toBe(502);
    mocks.rpc.mockResolvedValue({ data: walletReport({ school_id: other }), error: null }); expect((await POST(request())).status).toBe(502);
  });
});
