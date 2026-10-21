import { describe, expect, it } from 'vitest';
import { attentionItems, chartWindow, comparison, longDate, peakHour, tenderShares, todaySchema, weekdayName } from './today';
import { todayRead } from './today-fixtures';
import { closedSession, openSession, reconciliation, summary } from './report-fixtures';
import { reportResultSchema } from './reports';
import { money } from './operations';

const recon = (closed: unknown[], open: unknown[] = []) => reportResultSchema.reconciliation.parse(reconciliation(closed, open, { closed_count: closed.length, balanced_count: closed.filter(c => (c as { status: string }).status === 'balanced').length,
  shortage_count: closed.filter(c => (c as { status: string }).status === 'shortage').length, overage_count: closed.filter(c => (c as { status: string }).status === 'overage').length,
  uncaptured_count: closed.filter(c => (c as { status: string }).status === 'uncaptured').length }));
const uncaptured = (n: number, date: string) => closedSession(n, '0', '150000', '0', 'uncaptured', { captured: false, opening_minor: null, cash_sales_minor: null, cash_settlements_minor: null, cash_refunds_minor: null, expected_minor: null, difference_minor: null, closed_business_date: date, closed_local: `${date}T17:00` });

describe('Cafetería Hoy contract', () => {
  it('accepts the fictional read and rejects a partial hour list', () => {
    expect(todaySchema.safeParse(todayRead()).success).toBe(true);
    const bad = todayRead(); bad.data.hours = bad.data.hours.slice(1); expect(todaySchema.safeParse(bad).success).toBe(false);
    const extra = { ...todayRead(), data: { ...todayRead().data, net_minor: '1' } }; expect(todaySchema.safeParse(extra).success).toBe(false);
  });
  it('names business dates without the browser timezone', () => {
    expect(weekdayName('2026-10-20')).toBe('martes'); expect(weekdayName('2026-10-13T23:59')).toBe('martes');
    expect(longDate('2026-10-20')).toBe('Martes, 20 de octubre');
  });
});

describe('same-weekday comparison', () => {
  it('omits the comparison when last week had no sales', () => {
    expect(comparison(todayRead({ today: { 9: [50000, 8] } }))).toEqual({ kind: 'none' });
  });
  it('shows only the baseline amount when either side has too few sales for a percentage', () => {
    expect(comparison(todayRead({ today: { 9: [5000, 1] }, baseline: { 9: [40000, 7] }, cutoff: [40000, 7] }))).toEqual({ kind: 'reference', weekday: 'martes', baselineMinor: '40000' });
    expect(comparison(todayRead({ today: { 9: [50000, 8] }, baseline: { 9: [5000, 1], 15: [90000, 9] }, cutoff: [5000, 1] })).kind).toBe('reference');
    expect(comparison(todayRead({ baseline: { 9: [40000, 7] }, cutoff: [40000, 7] })).kind).toBe('reference');
  });
  it('compares same-time totals, never a partial day against a full day', () => {
    const c = comparison(todayRead({ today: { 9: [56000, 6] }, baseline: { 9: [50000, 5], 15: [500000, 40] }, cutoff: [50000, 5] }));
    expect(c).toEqual({ kind: 'delta', weekday: 'martes', baselineMinor: '50000', percent: 12 });
    expect(comparison(todayRead({ today: { 9: [40000, 6] }, baseline: { 9: [50000, 5] }, cutoff: [50000, 5] }))).toMatchObject({ percent: -20 });
    expect(comparison(todayRead({ today: { 9: [50000, 6] }, baseline: { 9: [50000, 5] }, cutoff: [50000, 5] }))).toMatchObject({ percent: 0 });
  });
});

describe('chart window and peak', () => {
  it('shows the school morning up to now even with zero sales', () => {
    expect(chartWindow(todayRead()).map(h => h.hour)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(peakHour(todayRead())).toBeNull();
  });
  it('keeps a single early hour inside a readable day', () => {
    expect(chartWindow(todayRead({ today: { 7: [5000, 1] }, asOf: '2026-10-20T07:20' })).map(h => h.hour)).toEqual([7, 8, 9, 10, 11, 12]);
  });
  it('extends to the earliest and latest activity of either day', () => {
    const w = chartWindow(todayRead({ today: { 6: [5000, 1] }, baseline: { 15: [9000, 2] } })).map(h => h.hour);
    expect(w[0]).toBe(6); expect(w.at(-1)).toBe(15);
  });
  it('peak is today\'s highest gross hour', () => {
    expect(peakHour(todayRead({ today: { 9: [5000, 1], 12: [61200, 9], 13: [61199, 12] } }))?.hour).toBe(12);
  });
});

describe('tender shares', () => {
  it('uses the 5D.1 tender gross and never divides by zero', () => {
    const s = reportResultSchema.sales_summary.parse(summary());
    expect(tenderShares(s).map(x => [x.tender, x.percent])).toEqual([['student_wallet', 25], ['cash', 50], ['staff_credit', 25]]);
    const zero = reportResultSchema.sales_summary.parse(summary({ gross_sales_minor: '0', refunds_minor: '0', net_sales_minor: '0', transaction_count: 0, refund_count: 0, average_ticket_minor: null,
      refunds_by_tender: { cash: '0', student_wallet: '0' }, tenders: ['cash', 'student_wallet', 'staff_credit'].map(tender => ({ tender, transaction_count: 0, gross_sales_minor: '0' })) }));
    expect(tenderShares(zero).every(x => x.percent === 0)).toBe(true);
  });
});

describe('Requiere atención', () => {
  it('lists closes that did not balance and sessions left open from earlier days only', () => {
    const items = attentionItems('2026-10-20', recon([
      closedSession(1, '300000', '285000', '-15000', 'shortage', { closed_business_date: '2026-10-19' }),
      closedSession(2, '250000', '250000', '0', 'balanced'),
      closedSession(3, '300000', '302500', '2500', 'overage', { closed_business_date: '2026-10-20' }),
      uncaptured(4, '2026-10-19'),
    ], [{ ...openSession(5), opened_local: '2026-10-19T07:42' }, { ...openSession(6), opened_local: '2026-10-20T07:10' }]), m => money(m));
    expect(items.map(i => i.text)).toEqual([
      'Caja 5 abierta desde el lunes 19/10 (Cajera ficticia)',
      'Cierre del lunes con faltante de RD$ 150.00 (Caja 1)',
      'Cierre de hoy con sobrante de RD$ 25.00 (Caja 3)',
      'Cierre del lunes sin efectivo contado (Caja 4)',
    ]);
    expect(items.map(i => i.action)).toEqual(['cajas', 'reportes', 'reportes', 'reportes']);
  });
  it('is empty when everything balanced, and when session history is not readable', () => {
    expect(attentionItems('2026-10-20', recon([closedSession(2, '250000', '250000', '0', 'balanced')], [{ ...openSession(6), opened_local: '2026-10-20T07:10' }]), m => money(m))).toEqual([]);
    expect(attentionItems('2026-10-20', null, m => money(m))).toEqual([]);
  });
  it('never mentions inventory', () => {
    const items = attentionItems('2026-10-20', recon([uncaptured(4, '2026-10-19')]), m => money(m));
    expect(JSON.stringify(items)).not.toMatch(/agotad|inventario|stock/i);
  });
});
