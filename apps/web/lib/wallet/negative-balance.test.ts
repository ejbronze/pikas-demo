import { describe, it, expect } from 'vitest';
import { historySchema, cafeteriaReadSchema } from './contracts';
import { formatMinor, purchaseContextSchema } from '../pos/contracts';
const id = '5c200000-0000-4000-8000-000000000001';
describe('negative PIKAS Cash balances (5C.2)', () => {
  it('formats negative minor units without mangling cents', () => {
    expect(formatMinor('-7550', 'DOP')).toBe('−RD$ 75.50'); expect(formatMinor('7550', 'DOP')).toBe('RD$ 75.50');
  });
  it('accepts a negative wallet in history and cafeteria lookup but rejects non-integers', () => {
    const base = { school_id: id, student_id: id, student_name: 'Sol', movements: [], next_before: null };
    expect(historySchema.safeParse({ ...base, wallet: { id, status: 'active', currency: 'DOP', balance_minor: '-7500', version: '3' } }).success).toBe(true);
    expect(historySchema.safeParse({ ...base, wallet: { id, status: 'active', currency: 'DOP', balance_minor: '-75.5', version: '3' } }).success).toBe(false);
    expect(cafeteriaReadSchema.safeParse({ cafeteria_id: id, students: [{ student_id: id, display_name: 'Sol', wallet_status: 'active', balance_minor: '-100' }] }).success).toBe(true);
  });
  it('lets the POS load a student whose wallet is negative so checkout can refuse PIKAS Cash', () => {
    const ctx = { customer_id: id, customer_type: 'student', currency_code: 'DOP', business_date: '2026-10-19', business_timezone: 'America/Santo_Domingo', as_of: 't',
      wallet: { status: 'active', balance_minor: '-7500' }, daily_limit: { enabled: false, limit_minor: null }, per_transaction_limit: { enabled: false, limit_minor: null },
      spent_today_minor: '0', available_today_minor: '-7500', restrictions: [] };
    expect(purchaseContextSchema.safeParse(ctx).success).toBe(true);
  });
});
