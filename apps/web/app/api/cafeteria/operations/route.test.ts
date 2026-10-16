import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock('../../../../lib/supabase/server', () => ({ createSupabaseServerClient: mocks.create }));
vi.mock('../../../../lib/auth/cafeteria-access', () => ({ resolveCafeteriaAccess: mocks.access }));
import { POST } from './route';
const id = '5a000000-0000-4000-8000-000000000001';
const body = { operation: 'read', cafeteria_id: id, kind: 'transactions', offset: 0, target_id: null };
const close = { operation: 'close', cafeteria_id: id, session_id: id, version: 1, counted_minor: '10000', expected_minor: '10000', reason: 'administrative_recovery', note: 'Conteo', request_key: id };
function request(payload: unknown = body, origin = 'http://localhost', key = id) { return new Request('http://localhost/api/cafeteria/operations', { method: 'POST', headers: { origin, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) }); }
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.access.mockResolvedValue({ status: 'authorized', context: { cafeterias: [{ cafeteria_id: id }] } }); mocks.rpc.mockResolvedValue({ data: { cafeteria_id: id, tenant_kind: 'customer', data: [] }, error: null }); });
describe('financial history server boundary', () => {
    it('derives actor and scope at RPC, sends bounded page targets', async () => { const response = await POST(request()); expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(mocks.rpc).toHaveBeenCalledWith('cafeteria_operations_read', { p_cafeteria_id: id, p_kind: 'transactions', p_offset: 0, p_target_id: null }); });
    it.each([['unauthenticated', 401], ['forbidden', 403], ['unavailable', 503]])('rejects %s', async (status, code) => { mocks.access.mockResolvedValue({ status }); expect((await POST(request())).status).toBe(code); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it('denies foreign cafeteria', async () => { expect((await POST(request({ ...body, cafeteria_id: '5a000000-0000-4000-8000-000000000002' }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it('rejects cross origin before authorization', async () => { expect((await POST(request(body, 'https://other.invalid'))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled(); });
    it.each([{ actor_id: id }, { account_id: id }, { offset: -1 }])('rejects untrusted or invalid input %j', async (change) => { expect((await POST(request({ ...body, ...change }))).status).toBe(400); });
    it('requires same durable close key', async () => { expect((await POST(request(close, 'http://localhost', 'different'))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it('invalid financial success remains unconfirmed', async () => { mocks.rpc.mockResolvedValue({ data: {}, error: null }); expect((await POST(request(close))).status).toBe(502); });
    it('classifies fresh stale calculation as definitive rejection', async () => { mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'stale_expected_cash' } }); const response = await POST(request(close)); expect(response.status).toBe(409); expect((await response.json()).definite).toBe(true); });
    it('does not claim unknown failure is definitive or disclose details', async () => { mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private-database-details' } }); const response = await POST(request(close)); const result = await response.json(); expect(result.definite).toBe(false); expect(JSON.stringify(result)).not.toContain('private-database-details'); });
});
