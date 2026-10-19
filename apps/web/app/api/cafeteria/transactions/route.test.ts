import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock('../../../../lib/supabase/server', () => ({ createSupabaseServerClient: mocks.create }));
vi.mock('../../../../lib/auth/cafeteria-access', () => ({ resolveCafeteriaAccess: mocks.access }));
import { POST } from './route';
const id = 'd4100000-0000-4000-8000-000000000001', other = 'd4100000-0000-4000-8000-000000000002', purchase = 'd4100000-0000-4000-8000-000000000003';
const list = { operation: 'list', cafeteria_id: id, period: 'last_7_days', from: null, to: null, tender: null, refund_status: null, receipt: null, offset: 0 };
const row = { id: purchase, receipt_number: '42', purchased_at: '2026-10-18T15:00:00Z', business_date: '2026-10-18', register_id: other, session_id: other, register_name: 'Caja', operator_id: other,
  operator_name: 'Cajera', customer_name: 'No Usuario', customer_type: null, tender: 'cash', currency: 'DOP', total_minor: '15000', refunded_minor: '5000', remaining_minor: '10000', refund_status: 'partial' };
const result = (over: Record<string, unknown> = {}) => ({ cafeteria_id: id, tenant_kind: 'customer', business_timezone: 'America/Santo_Domingo', today: '2026-10-19', period: 'last_7_days', from: '2026-10-13', to: '2026-10-19',
  tender: null, refund_status: null, receipt: null, offset: 0, page_size: 25, total_count: 1, has_more: false, data: [row], ...over });
const detail = { cafeteria_id: id, tenant_kind: 'customer', data: { ...row, cash_received_minor: '20000', change_minor: '5000', receipt: null,
  items: [{ name: 'Batida', quantity: 3, unit_price_minor: '5000', line_total_minor: '15000', refunded_quantity: 1, refunded_minor: '5000' }], refunds: [], unallocated_refund_minor: '0' } };
const request = (payload: unknown = list, origin = 'http://localhost') => new Request('http://localhost/api/cafeteria/transactions', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.access.mockResolvedValue({ status: 'authorized', context: { cafeterias: [{ cafeteria_id: id }] } }); mocks.rpc.mockResolvedValue({ data: result(), error: null }); });
describe('5D.4 transactions server boundary', () => {
  it('passes the filters to the authoritative read and returns its refund state', async () => {
    const response = await POST(request({ ...list, tender: 'cash', refund_status: 'partial', offset: 25 }).clone());
    expect(response.status).toBe(502); // echo mismatch (tender/status/offset) is rejected
    mocks.rpc.mockResolvedValue({ data: result({ tender: 'cash', refund_status: 'partial', offset: 25 }), error: null });
    const ok = await POST(request({ ...list, tender: 'cash', refund_status: 'partial', offset: 25 })); expect(ok.status).toBe(200); expect(ok.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenLastCalledWith('cafeteria_transactions_read', { p_cafeteria_id: id, p_period: 'last_7_days', p_from: null, p_to: null, p_tender: 'cash', p_refund_status: 'partial', p_receipt: null, p_offset: 25 });
    expect((await ok.json()).result.data[0].refund_status).toBe('partial');
  });
  it('exact receipt search goes alone; custom range is bounded before the database', async () => {
    mocks.rpc.mockResolvedValue({ data: result({ period: null, from: null, to: null, receipt: '42' }), error: null });
    expect((await POST(request({ ...list, period: null, receipt: '42' }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith('cafeteria_transactions_read', expect.objectContaining({ p_period: null, p_receipt: '42' }));
    mocks.rpc.mockClear();
    for (const bad of [{ receipt: '42' }, { period: null, receipt: '42', tender: 'cash' }, { period: 'custom', from: '2026-01-01', to: '2026-10-19' }, { period: 'custom', from: null, to: null },
      { period: 'today', from: '2026-10-19', to: '2026-10-19' }, { tender: 'card' }, { refund_status: 'refunded' }, { receipt: '0', period: null }, { receipt: 'abc', period: null }, { offset: -1 }, { operator_id: other }])
      expect((await POST(request({ ...list, ...bad }))).status, JSON.stringify(bad)).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('detail reads one purchase through the authoritative detail read', async () => {
    mocks.rpc.mockResolvedValue({ data: detail, error: null });
    const response = await POST(request({ operation: 'detail', cafeteria_id: id, purchase_id: purchase })); expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('cafeteria_transaction_detail', { p_cafeteria_id: id, p_purchase_id: purchase });
    expect((await response.json()).result.data.items[0].refunded_quantity).toBe(1);
    mocks.rpc.mockResolvedValue({ data: { ...detail, data: { ...detail.data, id: other } }, error: null });
    expect((await POST(request({ operation: 'detail', cafeteria_id: id, purchase_id: purchase }))).status).toBe(502);
  });
  it.each([['unauthenticated', 401], ['forbidden', 403], ['unavailable', 503]])('rejects %s', async (status, code) => { mocks.access.mockResolvedValue({ status }); expect((await POST(request())).status).toBe(code); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('denies a cafeteria outside the actor context and cross-origin requests', async () => {
    expect((await POST(request({ ...list, cafeteria_id: other }))).status).toBe(403);
    expect((await POST(request(list, 'https://other.invalid'))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('maps authority denial and contract rejections without database details; malformed results are refused', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'financial_admin_authority_required' } }); expect((await POST(request())).status).toBe(403);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'report_range_too_long' } }); const r = await POST(request()); expect(r.status).toBe(422); expect((await r.json()).error).toBe('report_range_too_long');
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private-database-details' } }); const u = await POST(request()); expect(u.status).toBe(502); expect(JSON.stringify(await u.json())).not.toContain('private');
    mocks.rpc.mockResolvedValue({ data: result({ data: [{ ...row, refund_status: 'refunded' }] }), error: null }); expect((await POST(request())).status).toBe(502);
    mocks.rpc.mockResolvedValue({ data: result({ cafeteria_id: other }), error: null }); expect((await POST(request())).status).toBe(502);
  });
});
