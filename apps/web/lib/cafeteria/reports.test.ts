import { describe, expect, it } from 'vitest';
import { customRangeError, latestGate, reportDays, reportRequestSchema, salesSummarySchema, topProductsSchema } from './reports';
import { summary, topProducts } from './report-fixtures';
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
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, kind: 'sales_summary', period: 'last_30_days', from: null, to: null }).success).toBe(true);
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, kind: 'sales_summary', period: 'today', from: '2026-10-01', to: null }).success).toBe(false);
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, kind: 'sales_summary', period: 'custom', from: '2026-07-17', to: '2026-10-17' }).success).toBe(false);
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, kind: 'sales_summary', period: 'yesterday', from: null, to: null }).success).toBe(false);
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, kind: 'sales_summary', period: 'today', from: null, to: null, actor_id: id }).success).toBe(false);
  });
  it('accepts negative net sales and a missing average, but only integer minor-unit strings', () => {
    expect(salesSummarySchema.safeParse(summary({ gross_sales_minor: '0', net_sales_minor: '-5000', transaction_count: 0, average_ticket_minor: null })).success).toBe(true);
    expect(salesSummarySchema.safeParse(summary({ gross_sales_minor: '200.5' })).success).toBe(false);
    expect(salesSummarySchema.safeParse(summary({ refunds_minor: '-5000' })).success).toBe(false);
    expect(salesSummarySchema.safeParse(summary({ gross_sales_minor: 20000 })).success).toBe(false);
    expect(salesSummarySchema.safeParse(summary({ tenders: [] })).success).toBe(false);
  });
  it('requires an approved report kind', () => {
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, kind: 'top_products', period: 'today', from: null, to: null }).success).toBe(true);
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, period: 'today', from: null, to: null }).success).toBe(false);
    expect(reportRequestSchema.safeParse({ cafeteria_id: id, kind: 'reconciliation', period: 'today', from: null, to: null }).success).toBe(false);
  });
  it('top products: at most 10 ranked rows, negative net allowed, net must equal gross − refunded', () => {
    expect(topProductsSchema.safeParse(topProducts([{ name: 'Agua', gross: 0, refunded: 2 }])).success).toBe(true);
    expect(topProductsSchema.safeParse(topProducts(Array.from({ length: 11 }, (_, i) => ({ name: `P${i}`, gross: 20 - i, refunded: 0 })))).success).toBe(false);
    const bad = topProducts(); bad.data.products[0].net_units = 20;
    expect(topProductsSchema.safeParse(bad).success).toBe(false);
    const unranked = topProducts(); unranked.data.products[0].rank = 2;
    expect(topProductsSchema.safeParse(unranked).success).toBe(false);
    expect(topProductsSchema.safeParse(topProducts(undefined, { product_count: 1 })).success).toBe(false);
  });
  it('latest-request gate rejects stale responses', () => {
    const gate = latestGate(); const first = gate.next(); const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false); expect(gate.isCurrent(second)).toBe(true);
  });
});
