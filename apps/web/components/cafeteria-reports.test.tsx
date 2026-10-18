import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => '/admin/cafeteria/reportes', redirect: vi.fn() }));
vi.mock('./product-image-picker', () => ({ ProductImagePicker: () => null }));
(globalThis as { React?: typeof React }).React = React;
import { CafeteriaReports, ReportBody } from './cafeteria-reports';
import { ConnectedCafeteriaPages } from './connected-cafeteria-pages';
import { ConnectedCafeteriaProvider } from './connected-cafeteria-provider';
import { cafeteriaRead } from '../lib/cafeteria/test-fixtures';
import { salesSummarySchema } from '../lib/cafeteria/reports';
import { summary } from '../lib/cafeteria/report-fixtures';
const body = (data: Record<string, unknown> = {}) => renderToStaticMarkup(<ReportBody loading={false} error="" report={salesSummarySchema.parse(summary(data))} onRetry={() => {}} />);
const zeroTenders = [{ tender: 'cash', transaction_count: 0, gross_sales_minor: '0' }, { tender: 'student_wallet', transaction_count: 0, gross_sales_minor: '0' }, { tender: 'staff_credit', transaction_count: 0, gross_sales_minor: '0' }];
describe('Reportes sales summary', () => {
  it('defaults to Últimos 30 días with all approved periods', () => {
    const html = renderToStaticMarkup(<CafeteriaReports cafeteriaId="5d100000-0000-4000-8000-000000000001" sandbox={false} />);
    for (const label of ['Hoy', 'Últimos 7 días', 'Últimos 30 días', 'Personalizado']) expect(html).toContain(`>${label}</button>`);
    expect(html).toContain('aria-pressed="true" class="min-h-11 btn">Últimos 30 días');
    expect(html).not.toContain('Ventas brutas');
  });
  it('labels every total explicitly and applies the shared money semantics', () => {
    const html = body();
    for (const label of ['Ventas brutas', 'Reembolsos', 'Ventas netas', 'Transacciones', 'Ticket promedio', 'Método de pago']) expect(html).toContain(label);
    expect(html).not.toMatch(/>Ventas</);
    expect(html).toContain('data-money-intent="amount" data-money-tone="neutral">RD$ 200.00');
    expect(html).toContain('data-money-intent="movement" data-money-tone="negative" class="text-red-700">−RD$ 100.00');
    expect(html).toContain('data-money-intent="balance" data-money-tone="neutral">RD$ 100.00');
    expect(html).toContain('Del 18/09/2026 al 17/10/2026');
  });
  it('shows the tender breakdown including staff credit when it has sales', () => {
    const html = body();
    expect(html).toContain('Efectivo'); expect(html).toContain('PIKAS Cash'); expect(html).toContain('Crédito de personal');
    expect(html).toContain('1 transacción');
  });
  it('refund-only period renders negative net sales legibly and no average ticket', () => {
    const html = body({ gross_sales_minor: '0', refunds_minor: '5000', net_sales_minor: '-5000', transaction_count: 0, refund_count: 1, average_ticket_minor: null,
      refunds_by_tender: { cash: '5000', student_wallet: '0' }, tenders: zeroTenders });
    expect(html).toContain('data-money-intent="balance" data-money-tone="negative" class="text-red-700">−RD$ 50.00');
    expect(html).toContain('Sin transacciones');
    expect(html).not.toContain('Crédito de personal');
    expect(html).toContain('Sin ventas en este período');
  });
  it('no-activity period explains itself instead of showing unexplained zeros', () => {
    const html = body({ gross_sales_minor: '0', refunds_minor: '0', net_sales_minor: '0', transaction_count: 0, refund_count: 0, average_ticket_minor: null,
      refunds_by_tender: { cash: '0', student_wallet: '0' }, tenders: zeroTenders });
    expect(html).toContain('Sin ventas ni reembolsos en este período');
    expect(html).toContain('Sin reembolsos en el período');
    expect(html).not.toContain('Reembolsos por método');
  });
  it('loading and error states never show financial values', () => {
    const loading = renderToStaticMarkup(<ReportBody loading error="" report={null} onRetry={() => {}} />);
    expect(loading).toContain('Cargando reporte'); expect(loading).not.toContain('RD$');
    const failed = renderToStaticMarkup(<ReportBody loading={false} error="No se pudo cargar el reporte con tus permisos actuales." report={null} onRetry={() => {}} />);
    expect(failed).toContain('role="alert"'); expect(failed).toContain('Reintentar'); expect(failed).not.toContain('RD$'); expect(failed).not.toContain('Sin ventas');
  });
  it('sandbox tenant gets an explanation and no report request', () => {
    expect(renderToStaticMarkup(<CafeteriaReports cafeteriaId="5d100000-0000-4000-8000-000000000001" sandbox />)).toContain('no están disponibles en el entorno sandbox');
  });
  it('the page mounts reports only with server-derived purchase-read authority', () => {
    for (const [caps, visible] of [[['cafeteria:pos:purchases:read'], true], [['cafeteria:catalog:manage'], false]] as const) {
      const read = cafeteriaRead(); read.scope.capabilities = [...caps];
      const html = renderToStaticMarkup(<ConnectedCafeteriaProvider data={read}><ConnectedCafeteriaPages section="reports" data={read} /></ConnectedCafeteriaProvider>);
      expect(html.includes('Período del reporte')).toBe(visible);
      expect(html.includes('Tu rol no tiene acceso a reportes')).toBe(!visible);
    }
  });
});
