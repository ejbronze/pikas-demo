import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readSchoolWalletAccess } from './access';
const id = '5bf00000-0000-4000-8000-000000000001';
const client = (data: unknown, error: unknown = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) });
describe('server-derived school wallet access', () => {
  it('uses the authoritative RPC result', async () => {
    const c = client({ school_id: id, read: true, replenish: true });
    expect(await readSchoolWalletAccess(c, id)).toEqual({ school_id: id, read: true, replenish: true });
    expect(c.rpc).toHaveBeenCalledWith('school_wallet_access', { p_school_id: id });
  });
  it.each([
    ['error', client(null, { code: '42501' })],
    ['malformed', client({ read: true })],
    ['other school', client({ school_id: '5bf00000-0000-4000-8000-000000000002', read: true, replenish: true })],
    ['transport failure', { rpc: vi.fn().mockRejectedValue(Error('down')) }],
  ])('treats %s as no access', async (_, c) => {
    expect(await readSchoolWalletAccess(c, id)).toEqual({ school_id: id, read: false, replenish: false });
  });
  it('never reports replenish without read', async () => {
    expect((await readSchoolWalletAccess(client({ school_id: id, read: false, replenish: true }), id)).replenish).toBe(false);
  });
});
