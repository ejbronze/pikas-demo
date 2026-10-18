import { describe, expect, it } from 'vitest';
import { customRangeError, reportDays, reportRequestSchema, salesSummarySchema } from './reports';
import { summary } from './report-fixtures';
const id = '5d100000-0000-4000-8000-000000000001';
describe('sales report contract', () => {
  it('counts both ends of a custom range and enforces the 92-day maximum', () => {
    expect(reportDays('2026-10-17', '2026-10-17')).toBe(1);
    expect(customRangeError('2026-07-18', '2026-10-17')).toBeNull();
    expect(customRangeError('2026-07-17', '2026-10-17')).toMatch(/92 días/);
    expect(customRangeError('2026-10-18', '2026-10-17')).toMatch(/anterior/);
    expect(customRangeError('', '2026-10-17')).toMatch(/Selecciona/);
  });
  it('accepts presets without dates and custom ranges only with valid dates', () => {
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, period: 'last_30_days', from: null, to: null }).success).toBe(true);
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, period: 'today', from: '2026-10-01', to: null }).success).toBe(false);
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, period: 'custom', from: '2026-07-17', to: '2026-10-17' }).success).toBe(false);
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, period: 'yesterday', from: null, to: null }).success).toBe(false);
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, period: 'today', from: null, to: null, actor_id: id }).success).toBe(false);
  });
  it('accepts negative net sales and a missing average, but only integer minor-unit strings', () => {
    expect(salesSummarySchema.safeParse(summary({ gross_sales_minor: '0', net_sales_minor: '-5000', transaction_count: 0, average_ticket_minor: null })).success).toBe(true);
    expect(salesSummarySchema.safeParse(summary({ gross_sales_minor: '200.5' })).success).toBe(false);
    expect(salesSummarySchema.safeParse(summary({ refunds_minor: '-5000' })).success).toBe(false);
    expect(salesSummarySchema.safeParse(summary({ gross_sales_minor: 20000 })).success).toBe(false);
    expect(salesSummarySchema.safeParse(summary({ tenders: [] })).success).toBe(false);
  });
});
