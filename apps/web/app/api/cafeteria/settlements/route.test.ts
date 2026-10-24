import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock('../../../../lib/supabase/server', () => ({ createSupabaseServerClient: mocks.create }));
vi.mock('../../../../lib/auth/cafeteria-access', () => ({ resolveCafeteriaAccess: mocks.access }));
import { POST } from './route';

// The Cafetería's settlements: read only, own Cafetería only, never in a Demo POV.
const caf = '5e000000-0000-4000-8000-000000000111';
const period = { week_start: '2026-10-26', week_end: '2026-11-01', due_on: '2026-11-03', cafeteria_owes_minor: '0', clearing_owes_minor: '0', line_count: 0 };
const settlement = { reference: 'LIQ-00000001', status: 'due', week_start: '2026-10-19', week_end: '2026-10-25', due_on: '2026-10-27', cafeteria_owes_minor: '1000000', clearing_owes_minor: '750000',
  net_direction: 'cafeteria_to_clearing', net_amount_minor: '250000', line_count: 2, late_line_count: 0, finalized_at: '2026-10-26T12:00:00Z', settled_at: null };
const readResult = { cafeteria_id: caf, enabled: true, current: period, pending: [], settlements: [settlement] };
const detailResult = { ...settlement, cafeteria: 'Cafetería Ficticia', lines: [], events: [] };
const req = (body: unknown, origin = 'http://localhost') => new Request('http://localhost/api/cafeteria/settlements', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.access.mockResolvedValue({ status: 'authorized', context: { cafeterias: [{ cafeteria_id: caf }] } });
  mocks.rpc.mockResolvedValue({ data: readResult, error: null }); });

describe('Cafetería settlements boundary', () => {
  it('reads its own settlements', async () => {
    const r = await POST(req({ operation: 'read', cafeteria_id: caf })); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('cafeteria_settlements_read', { p_cafeteria_id: caf }); expect((await r.json()).result.settlements[0].reference).toBe('LIQ-00000001');
  });
  it('reads one settlement and checks it is the one asked for', async () => {
    mocks.rpc.mockResolvedValue({ data: detailResult, error: null });
    expect((await POST(req({ operation: 'detail', cafeteria_id: caf, reference: 'LIQ-00000001' }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('cafeteria_settlement_detail', { p_cafeteria_id: caf, p_reference: 'LIQ-00000001' });
    expect((await POST(req({ operation: 'detail', cafeteria_id: caf, reference: 'LIQ-00000002' }))).status).toBe(502);
  });
  it.each([{ operation: 'finalize', cafeteria_id: caf }, { operation: 'payment', cafeteria_id: caf, reference: 'LIQ-00000001' }, { operation: 'detail', cafeteria_id: caf, reference: 'REC-00000001' },
    { operation: 'read', cafeteria_id: 'x' }, { operation: 'read', cafeteria_id: caf, status: 'settled' }])('offers no other operation and refuses %j before the database', async body => {
    expect((await POST(req(body))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('refuses another Cafetería, a Demo POV, cross-origin and signed-out requests', async () => {
    expect((await POST(req({ operation: 'read', cafeteria_id: '5e000000-0000-4000-8000-000000000112' }))).status).toBe(403);
    mocks.access.mockResolvedValue({ status: 'authorized', context: { cafeterias: [{ cafeteria_id: caf }], pov: { operator_person_id: caf } } });
    expect(await (await POST(req({ operation: 'read', cafeteria_id: caf }))).json()).toEqual({ error: 'demo_mode_active' });
    expect((await POST(req({ operation: 'read', cafeteria_id: caf }, 'https://untrusted.invalid'))).status).toBe(403);
    mocks.access.mockResolvedValue({ status: 'unauthenticated' }); expect((await POST(req({ operation: 'read', cafeteria_id: caf }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('maps database refusals without passing raw errors', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'finance_authority_required' } }); expect((await POST(req({ operation: 'read', cafeteria_id: caf }))).status).toBe(403);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23503', message: 'SETTLEMENT_NOT_FOUND' } }); expect((await POST(req({ operation: 'detail', cafeteria_id: caf, reference: 'LIQ-00000009' }))).status).toBe(404);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'relation "settlements" does not exist' } });
    const r = await POST(req({ operation: 'read', cafeteria_id: caf })); expect(r.status).toBe(502); expect(JSON.stringify(await r.json())).not.toContain('relation');
  });
});
