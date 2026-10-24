import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock('../../../../lib/supabase/server', () => ({ createSupabaseServerClient: mocks.create }));
vi.mock('../../../../lib/auth/cafeteria-access', () => ({ resolveCafeteriaAccess: mocks.access }));
import { POST } from './route';

// FIN 4 Cafetería cash collection boundary: same origin, server-derived scope, exact key, named refusals only.
const caf = 'f4000000-0000-4000-8000-0000000000c1', student = 'f4000000-0000-4000-8000-0000000000e1', key = 'f4000000-0000-4000-8000-0000000000a1';
const collect = { operation: 'collect', cafeteria_id: caf, student_id: student, student_name: 'Ana Ficticia', gross_minor: '200000', payer_name: 'Madre ficticia', request_key: key };
const posted = { request_key: key, reference: 'REC-00000001', state: 'posted', cafeteria_id: caf, student_id: student, student_name: 'Ana Ficticia', gross_minor: '200000', fee_minor: '6000',
  net_minor: '194000', fee_bps: 300, balance_after_minor: '244000', collected_at: '2026-10-24T12:00:00Z', collected_by: 'Admin Ficticia', payer_name: 'Madre ficticia', replayed: false };
const read = { operation: 'read', cafeteria_id: caf, before: null };
const readResult = { cafeteria_id: caf, enabled: true, fee_bps: 300, policy_version: 1, currency: 'DOP', collections: [], next_before: null };
function req(body: unknown = collect, origin = 'http://localhost', idem = key) {
  return new Request('http://localhost/api/cafeteria/cash-collection', { method: 'POST', headers: { origin, 'Content-Type': 'application/json', 'Idempotency-Key': idem }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.access.mockResolvedValue({ status: 'authorized', context: { cafeterias: [{ cafeteria_id: caf }] } });
  mocks.rpc.mockResolvedValue({ data: posted, error: null }); });

describe('cash collection boundary', () => {
  it('forwards exactly the cash received, the payer and the request key; never a fee, net or actor', async () => {
    const r = await POST(req()); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('cafeteria_wallet_collect_cash', { p_cafeteria_id: caf, p_student_id: student, p_gross_minor: '200000', p_payer_name: 'Madre ficticia', p_request_key: key });
    expect((await r.json()).result).toEqual(posted);
  });
  it('an empty payer is sent as null', async () => { await POST(req({ ...collect, payer_name: '' })); expect(mocks.rpc.mock.calls[0][1].p_payer_name).toBeNull(); });
  it.each([{ fee_minor: '6000' }, { net_minor: '194000' }, { actor_id: key }, { gross_minor: '0' }, { gross_minor: '20.00' }, { gross_minor: '-1' }, { request_key: 'abc' }])('rejects client authority or malformed money %j', async x => {
    expect((await POST(req({ ...collect, ...x }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires the Idempotency-Key to equal the request key', async () => { expect((await POST(req(collect, 'http://localhost', 'other'))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('denies cross-origin before authentication', async () => { expect((await POST(req(collect, 'https://other.invalid'))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled(); });
  it.each([['unauthenticated', 401], ['forbidden', 403], ['unavailable', 503]])('denies %s', async (status, code) => { mocks.access.mockResolvedValue({ status }); expect((await POST(req())).status).toBe(code); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('denies another Cafetería and any Demo POV', async () => {
    expect((await POST(req({ ...collect, cafeteria_id: 'f4000000-0000-4000-8000-0000000000c2' }))).status).toBe(403);
    mocks.access.mockResolvedValue({ status: 'authorized', context: { cafeterias: [{ cafeteria_id: caf }], pov: {} } });
    const r = await POST(req()); expect(r.status).toBe(403); expect((await r.json()).error).toBe('demo_mode_active'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['FINANCIAL_POLICY_NOT_ACTIVE', 'wallet_not_active', 'student_not_served_by_cafeteria', 'cash_collection_authority_required', 'IDEMPOTENCY_CONFLICT', 'active_enrollment_required_for_replenishment'])('passes the named refusal %s through as definite (422)', async message => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514', message } }); const r = await POST(req()); expect(r.status).toBe(422); expect((await r.json()).error).toBe(message);
  });
  it('anything unnamed is uncertain (502) and never leaks details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private-details' } }); const r = await POST(req()); expect(r.status).toBe(502); expect(JSON.stringify(await r.json())).not.toContain('private');
  });
  it.each([{ ...posted, gross_minor: '100000' }, { ...posted, request_key: 'f4000000-0000-4000-8000-0000000000a2' }, { ...posted, student_id: caf }, { ...posted, fee_minor: undefined }])('a result for anything else is uncertain', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null }); expect((await POST(req())).status).toBe(502);
  });
  it('reads the history with the server-derived scope', async () => {
    mocks.rpc.mockResolvedValue({ data: readResult, error: null });
    const r = await POST(req(read)); expect(r.status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith('cafeteria_cash_collections_read', { p_cafeteria_id: caf, p_before: null });
  });
  it('a history read is never retried as a posting and needs no key', async () => {
    mocks.rpc.mockResolvedValue({ data: readResult, error: null }); expect((await POST(req(read, 'http://localhost', ''))).status).toBe(200);
  });
});
