import { describe, it, expect } from 'vitest';
import { historyRequestSchema, money } from './operations';
const close = { operation: 'close', cafeteria_id: '5a000000-0000-4000-8000-000000000001', session_id: '5a000000-0000-4000-8000-000000000002', version: 1, counted_minor: '9007199254740993', expected_minor: '-1000', reason: 'other', note: 'Conteo supervisado', request_key: '5a000000-0000-4000-8000-000000000003' };
describe('financial operations contracts', () => {
    it('preserves bigint precision and signed reconciliation', () => { expect(historyRequestSchema.parse(close)).toEqual(close); expect(money('-1050')).toBe('−RD$ 10.50'); expect(money('9007199254740993')).toContain('.93'); });
    it('accepts existing deterministic entity GUIDs while keeping request keys strict', () => { expect(historyRequestSchema.safeParse({ ...close, cafeteria_id: '00000000-0000-0000-0000-000000000111' }).success).toBe(true); expect(historyRequestSchema.safeParse({ ...close, request_key: '00000000-0000-0000-0000-000000000111' }).success).toBe(false); });
    it('requires explicit reason note, version, and an immutable request identity', () => { for (const change of [{ note: '' }, { version: 0 }, { request_key: 'new' }, { counted_minor: '10.50' }, { counted_minor: '-1' }, { expected_minor: '1.25' }, { actor: 'forged' }])
        expect(historyRequestSchema.safeParse({ ...close, ...change }).success).toBe(false); });
});
