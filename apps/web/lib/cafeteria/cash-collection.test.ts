import { describe, expect, it } from 'vitest';
import { cashMessage, cashPreview, feePercent, loadJournal, prepareJournal, sendCollection, type CashCommand } from './cash-collection';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), size: () => m.size }; };
const command: CashCommand = { operation: 'collect', cafeteria_id: 'f4000000-0000-4000-8000-0000000000c1', student_id: 'f4000000-0000-4000-8000-0000000000e1', student_name: 'Ana Ficticia',
  gross_minor: '200000', payer_name: '', request_key: 'f4000000-0000-4000-8000-0000000000a1' };

describe('FIN 4 cash preview (same arithmetic as pikas_private.replenishment_fee_minor)', () => {
  it.each([['200000', '6000', '194000'], ['33333', '1000', '32333'], ['50', '2', '48'], ['49', '1', '48'], ['51', '2', '49'], ['1', '0', '1'], ['9007199254740991', '270215977642230', '8736983277098761']])(
    'gross %s → fee %s, net %s (half-up, integer centavos)', (gross, fee, net) => { expect(cashPreview(gross, 300)).toEqual({ gross, fee, net }); });
  it('gross always equals fee + net', () => { for (let g = 1n; g < 2000n; g += 7n) { const p = cashPreview(g.toString(), 300); expect(BigInt(p.fee) + BigInt(p.net)).toBe(g); } });
  it('shows the policy rate', () => { expect(feePercent(300)).toBe('3 %'); expect(feePercent(250)).toBe('2.5 %'); /* es-DO uses a decimal point */ });
});

describe('journal: one in-flight request, never a second key', () => {
  it('prepare stores the command once and returns the stored one afterwards', () => {
    const s = memory(); expect(prepareJournal(s, 'k', command)).toEqual(command);
    expect(prepareJournal(s, 'k', { ...command, gross_minor: '1', request_key: 'f4000000-0000-4000-8000-0000000000a9' })).toEqual(command);
    expect(loadJournal(s, 'k')).toEqual(command); expect(s.size()).toBe(1);
  });
  it('a tampered journal is ignored', () => { const s = memory(); s.setItem('k', JSON.stringify({ command: { ...command, gross_minor: '-5' } })); expect(loadJournal(s, 'k')).toBeNull(); });
});

describe('sendCollection outcomes', () => {
  const result = { request_key: command.request_key, reference: 'REC-00000001', state: 'posted', cafeteria_id: command.cafeteria_id, student_id: command.student_id, student_name: 'Ana Ficticia',
    gross_minor: '200000', fee_minor: '6000', net_minor: '194000', fee_bps: 300, balance_after_minor: '194000', collected_at: 't', collected_by: 'A', payer_name: null, replayed: false };
  const transport = (status: number, body: unknown, check?: (init?: RequestInit) => void) => (async (_url: RequestInfo | URL, init?: RequestInit) => { check?.(init); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;
  it('sends the key as Idempotency-Key and accepts only the matching result', async () => {
    expect(await sendCollection(command, transport(200, { result }, init => expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(command.request_key)))).toEqual({ outcome: 'success', result });
    expect((await sendCollection(command, transport(200, { result: { ...result, gross_minor: '1' } }))).outcome).toBe('uncertain');
  });
  it('named refusals are definite; server or network failures are uncertain', async () => {
    expect(await sendCollection(command, transport(422, { error: 'wallet_not_active' }))).toEqual({ outcome: 'rejected', code: 'wallet_not_active' });
    expect((await sendCollection(command, transport(502, { error: 'cash_uncertain' }))).outcome).toBe('uncertain');
    expect((await sendCollection(command, (async () => { throw new TypeError('network'); }) as typeof fetch)).outcome).toBe('uncertain');
  });
  it('every refusal has truthful Spanish copy and unknown codes say no money moved', () => {
    expect(cashMessage('FINANCIAL_POLICY_NOT_ACTIVE')).toContain('no están habilitadas');
    expect(cashMessage('wallet_not_active')).toContain('congelado');
    expect(cashMessage('cash_collection_authority_required')).toContain('administración de la cafetería');
    expect(cashMessage('whatever')).toContain('No se movió dinero');
  });
});
