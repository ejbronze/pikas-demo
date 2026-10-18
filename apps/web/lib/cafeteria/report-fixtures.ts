// Fictional Phase 5D.1 sales-summary response for focused tests.
const id = '5d100000-0000-4000-8000-000000000001';
export const summary = (data: Partial<Record<string, unknown>> = {}) => ({
  cafeteria_id: id, tenant_kind: 'customer', kind: 'sales_summary', period: 'last_30_days', from: '2026-09-18', to: '2026-10-17', today: '2026-10-17',
  business_timezone: 'America/Santo_Domingo', currency_code: 'DOP',
  data: { gross_sales_minor: '20000', refunds_minor: '10000', net_sales_minor: '10000', transaction_count: 3, refund_count: 2, average_ticket_minor: '6667',
    refunds_by_tender: { cash: '5000', student_wallet: '5000' },
    tenders: [{ tender: 'cash', transaction_count: 1, gross_sales_minor: '10000' }, { tender: 'student_wallet', transaction_count: 1, gross_sales_minor: '5000' }, { tender: 'staff_credit', transaction_count: 1, gross_sales_minor: '5000' }], ...data },
});

// Fictional Phase 5D.2 top-products response; rows arrive ranked by the database.
export const topProducts = (products: { name: string; gross: number; refunded: number }[] = [{ name: 'Agua ficticia', gross: 20, refunded: 2 }, { name: 'Sándwich ficticio', gross: 12, refunded: 0 }], extra: Record<string, number> = {}) => ({
  ...summary(), kind: 'top_products',
  data: { products: products.map((p, i) => ({ rank: i + 1, product_id: `5d200000-0000-4000-8000-${String(101 + i).padStart(12, '0')}`, product_name: p.name,
    gross_units: p.gross, refunded_units: p.refunded, net_units: p.gross - p.refunded })), product_count: products.length, refunds_without_item_detail: 0, ...extra },
});

// Fictional Phase 5D.3 reconciliation response: values as the database returns them (the frozen
// Phase 5A close capture for closed sessions; the live summary for open ones).
const sid = (n: number) => `5d300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const closedSession = (n: number, expected: string, counted: string, difference: string, status: string, extra: Record<string, unknown> = {}) => ({
  session_id: sid(n), register_id: sid(900 + n), register_name: `Caja ${n}`, register_code: `C${n}`, operator_name: 'Cajero ficticio', closed_by_name: 'Cajero ficticio',
  close_type: 'normal', opened_at: '2026-10-17T12:02:00+00:00', closed_at: '2026-10-17T21:03:00+00:00', opened_local: '2026-10-17T08:02', closed_local: '2026-10-17T17:03',
  closed_business_date: '2026-10-17', captured: true, status, opening_minor: '100000', cash_sales_minor: '210000', cash_settlements_minor: '0', cash_refunds_minor: '10000',
  expected_minor: expected, counted_minor: counted, difference_minor: difference, ...extra,
});
export const openSession = (n: number) => ({
  session_id: sid(n), register_id: sid(900 + n), register_name: `Caja ${n}`, register_code: `C${n}`, operator_name: 'Cajera ficticia',
  opened_at: '2026-10-17T12:02:00+00:00', opened_local: '2026-10-17T08:02', opening_minor: '50000', cash_sales_minor: '25000', cash_settlements_minor: '0',
  cash_refunds_minor: '0', expected_minor: '75000',
});
export const reconciliation = (closed: unknown[] = [
  closedSession(1, '300000', '297500', '-2500', 'shortage'), closedSession(2, '250000', '250000', '0', 'balanced', { closed_local: '2026-10-17T16:55' }),
  closedSession(3, '300000', '302500', '2500', 'overage'),
], open: unknown[] = [openSession(4)], counts: Record<string, number> = {}) => ({
  ...summary(), kind: 'reconciliation',
  data: { summary: { closed_count: 3, balanced_count: 1, shortage_count: 1, overage_count: 1, uncaptured_count: 0, ...counts }, closed_sessions: closed, open_sessions: open },
});
