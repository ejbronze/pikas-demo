// Fictional Phase 5D.1 sales-summary response for focused tests.
const id = '5d100000-0000-4000-8000-000000000001';
export const summary = (data: Partial<Record<string, unknown>> = {}) => ({
  cafeteria_id: id, tenant_kind: 'customer', kind: 'sales_summary', period: 'last_30_days', from: '2026-09-18', to: '2026-10-17', today: '2026-10-17',
  business_timezone: 'America/Santo_Domingo', currency_code: 'DOP',
  data: { gross_sales_minor: '20000', refunds_minor: '10000', net_sales_minor: '10000', transaction_count: 3, refund_count: 2, average_ticket_minor: '6667',
    refunds_by_tender: { cash: '5000', student_wallet: '5000' },
    tenders: [{ tender: 'cash', transaction_count: 1, gross_sales_minor: '10000' }, { tender: 'student_wallet', transaction_count: 1, gross_sales_minor: '5000' }, { tender: 'staff_credit', transaction_count: 1, gross_sales_minor: '5000' }], ...data },
});
