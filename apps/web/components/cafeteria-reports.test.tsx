import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => '/admin/cafeteria/reportes', redirect: vi.fn() }));
vi.mock('./product-image-picker', () => ({ ProductImagePicker: () => null }));
(globalThis as { React?: typeof React }).React = React;
import { CafeteriaReports, ReconciliationBody, ReportBody, TopProductsBody } from './cafeteria-reports';
import { ConnectedCafeteriaPages } from './connected-cafeteria-pages';
import { ConnectedCafeteriaProvider } from './connected-cafeteria-provider';
import { cafeteriaRead } from '../lib/cafeteria/test-fixtures';
import { reconciliationSchema, salesSummarySchema, topProductsSchema } from '../lib/cafeteria/reports';
import { closedSession, openSession, reconciliation, summary, topProducts } from '../lib/cafeteria/report-fixtures';
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
  it('top products share the single period selector (no second picker or filters)', () => {
    const html = renderToStaticMarkup(<CafeteriaReports cafeteriaId="5d100000-0000-4000-8000-000000000001" sandbox={false} />);
    expect(html.match(/Período del reporte/g)).toHaveLength(1);
    expect(html).toContain('Productos principales');
    expect(html).not.toContain('type="date"');
  });
});
const top = (products?: Parameters<typeof topProducts>[0], extra?: Record<string, number>) =>
  renderToStaticMarkup(<TopProductsBody loading={false} error="" report={topProductsSchema.parse(topProducts(products, extra))} onRetry={() => {}} />);
describe('Productos principales', () => {
  it('renders the server ranking in order with gross, refunded and net units', () => {
    const html = top();
    expect(html.indexOf('Agua ficticia')).toBeLessThan(html.indexOf('Sándwich ficticio'));
    expect(html).toContain('18 netas'); expect(html).toContain('20 vendidas · 2 reembolsadas');
    expect(html).toContain('12 netas'); expect(html).toContain('12 vendidas · 0 reembolsadas');
    expect(html).not.toContain('RD$');
  });
  it('refund-only product shows signed negative units with text, not color alone', () => {
    const html = top([{ name: 'Agua ficticia', gross: 0, refunded: 2 }]);
    expect(html).toContain('class="font-black text-red-700">−2 netas'); expect(html).toContain('0 vendidas · 2 reembolsadas');
    expect(html).toContain('no inventario');
  });
  it('shows at most the ten rows returned and how many products had activity', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ name: `Producto ${i + 1}`, gross: 20 - i, refunded: 0 }));
    const html = top(ten, { product_count: 14 });
    expect(html.match(/<li /g)).toHaveLength(10); expect(html).toContain('Mostrando 10 de 14 productos con actividad');
  });
  it('empty period is explicit and distinct from failure', () => {
    const empty = top([]);
    expect(empty).toContain('Sin ventas ni reembolsos de productos en este período'); expect(empty).not.toContain('<li');
    const failed = renderToStaticMarkup(<TopProductsBody loading={false} error="No se pudo cargar el reporte con tus permisos actuales." report={null} onRetry={() => {}} />);
    expect(failed).toContain('role="alert"'); expect(failed).toContain('Reintentar'); expect(failed).not.toContain('Sin ventas');
    const loading = renderToStaticMarkup(<TopProductsBody loading error="" report={null} onRetry={() => {}} />);
    expect(loading).toContain('Cargando productos'); expect(loading).not.toContain('<li');
  });
  it('explains refunds without item detail instead of inventing units', () => {
    expect(top(undefined, { refunds_without_item_detail: 1 })).toContain('1 reembolso del período no tiene detalle por producto');
    expect(top()).not.toContain('detalle por producto');
  });
});

const caf = '5d100000-0000-4000-8000-000000000001';
const rec = (...args: Parameters<typeof reconciliation>) =>
  renderToStaticMarkup(<ReconciliationBody cafeteriaId={caf} loading={false} error="" report={reconciliationSchema.parse(reconciliation(...args))} onRetry={() => {}} />);
// The <li> of one register (closed or open) within a rendered section.
const item = (html: string, register: string) => html.split('<li ').find(part => part.includes(`>${register}</span>`)) ?? '';
describe('Conciliación de caja', () => {
  it('shares the single period selector and appears only with session-read authority', () => {
    const html = renderToStaticMarkup(<CafeteriaReports cafeteriaId={caf} sandbox={false} reconciliation />);
    expect(html.match(/Período del reporte/g)).toHaveLength(1); expect(html.match(/type="date"/g)).toBeNull();
    expect(html).toContain('Conciliación de caja');
    expect(renderToStaticMarkup(<CafeteriaReports cafeteriaId={caf} sandbox={false} />)).not.toContain('Conciliación de caja');
    for (const [caps, visible] of [[['cafeteria:pos:purchases:read', 'cafeteria:pos:sessions:read'], true], [['cafeteria:pos:purchases:read'], false]] as const) {
      const read = cafeteriaRead(); read.scope.capabilities = [...caps];
      const page = renderToStaticMarkup(<ConnectedCafeteriaProvider data={read}><ConnectedCafeteriaPages section="reports" data={read} /></ConnectedCafeteriaProvider>);
      expect(page.includes('Conciliación de caja')).toBe(visible);
    }
  });
  it('period summary shows session counts only, never a net difference', () => {
    const html = rec();
    for (const [label, n] of [['Sesiones cerradas', 3], ['Cuadradas', 1], ['Con faltante', 1], ['Con sobrante', 1]] as const)
      expect(html).toMatch(new RegExp(`${label}</dt><dd[^>]*>${n}</dd>`));
    expect(html).not.toMatch(/Diferencia total|diferencia neta/i);
    expect(html).toContain('Cerradas del 18/09/2026 al 17/10/2026 · America/Santo_Domingo');
  });
  it('closed sessions show expected, counted and a labelled, signed discrepancy', () => {
    const html = rec();
    const short = item(html, 'Caja 1'), even = item(html, 'Caja 2'), over = item(html, 'Caja 3');
    expect(short).toContain('Faltante <span data-money-intent="movement" data-money-tone="negative" class="text-red-700">−RD$ 25.00');
    expect(short).toContain('Esperado <span data-money-intent="balance" data-money-tone="neutral" class="font-bold">RD$ 3,000.00');
    expect(short).toContain('Contado <span data-money-intent="amount" data-money-tone="neutral" class="font-bold">RD$ 2,975.00');
    expect(short).toContain('Cerrada 17 oct, 5:03 p. m.');
    expect(even).toContain('>Cuadrada</span>'); expect(even).not.toMatch(/Faltante|Sobrante/); expect(even).toContain('Cerrada 17 oct, 4:55 p. m.');
    expect(over).toContain('Sobrante <span data-money-intent="movement" data-money-tone="positive" class="text-emerald-700">+RD$ 25.00');
  });
  it('the frozen 5A breakdown sits behind progressive disclosure with refunds as an outflow', () => {
    const short = item(rec(), 'Caja 1');
    expect(short).toContain('<details'); expect(short).toContain('Ver desglose');
    for (const label of ['Fondo inicial', 'Ventas en efectivo', 'Cobros de cuentas de personal', 'Reembolsos en efectivo', 'Efectivo esperado', 'Efectivo contado', 'Diferencia (contado − esperado)']) expect(short).toContain(label);
    expect(short).toContain('data-money-intent="movement" data-money-tone="negative" class="text-red-700">−RD$ 100.00');
  });
  it('open registers are separate, current and never reconciled', () => {
    const html = rec();
    expect(html.indexOf('Conciliación de caja')).toBeLessThan(html.indexOf('Cajas abiertas ahora'));
    const open = item(html, 'Caja 4');
    expect(open).toContain('Abierta · sin conciliar'); expect(open).toContain('Abierta desde 17 oct, 8:02 a. m.');
    expect(open).toContain('Efectivo esperado ahora');
    expect(open).not.toMatch(/Cuadrada|Faltante|Sobrante|Contado|contado|Diferencia/);
    expect(html).toContain('no depende del período');
  });
  it('a close without capture is labelled and never shows a derived expected or difference', () => {
    const pre = closedSession(5, '0', '120000', '0', 'uncaptured', { captured: false, opening_minor: null, cash_sales_minor: null, cash_settlements_minor: null, cash_refunds_minor: null, expected_minor: null, difference_minor: null });
    const html = rec([pre], [], { closed_count: 1, balanced_count: 0, shortage_count: 0, overage_count: 0, uncaptured_count: 1 });
    const row = item(html, 'Caja 5');
    expect(row).toContain('Sin captura al cierre'); expect(row).not.toContain('Esperado'); expect(row).not.toContain('Cuadrada');
    expect(html).toContain('1 sesión sin captura al cierre');
  });
  it('empty states are explicit, separate and not failures', () => {
    const noClosed = rec([], [openSession(4)], { closed_count: 0, balanced_count: 0, shortage_count: 0, overage_count: 0 });
    expect(noClosed).toContain('No se cerraron sesiones de caja en este período'); expect(noClosed).toContain('Cajas abiertas ahora'); expect(noClosed).not.toContain('role="alert"');
    const noOpen = rec(undefined, []);
    expect(noOpen).toContain('No hay cajas abiertas ahora'); expect(noOpen).not.toContain('No se cerraron');
    const none = rec([], [], { closed_count: 0, balanced_count: 0, shortage_count: 0, overage_count: 0 });
    expect(none).toContain('Sin actividad de caja'); expect(none).not.toContain('Cajas abiertas ahora'); expect(none).not.toContain('Sesiones cerradas</dt>');
  });
  it('loading and failure never render counts or money, and offer a retry', () => {
    const failed = renderToStaticMarkup(<ReconciliationBody cafeteriaId={caf} loading={false} error="No se pudo cargar el reporte con tus permisos actuales." report={null} onRetry={() => {}} />);
    expect(failed).toContain('role="alert"'); expect(failed).toContain('Reintentar');
    expect(failed).not.toMatch(/RD\$|Sesiones cerradas<|Sin actividad|Cajas abiertas ahora/);
    const loading = renderToStaticMarkup(<ReconciliationBody cafeteriaId={caf} loading error="" report={null} onRetry={() => {}} />);
    expect(loading).toContain('Cargando conciliación'); expect(loading).not.toContain('RD$');
  });
  it('a long period lists the most recent closes and says so', () => {
    const many = Array.from({ length: 50 }, (_, i) => closedSession(10 + i, '1000', '1000', '0', 'balanced'));
    expect(rec(many, [], { closed_count: 60, balanced_count: 60, shortage_count: 0, overage_count: 0 })).toContain('Mostrando las 50 más recientes de 60 sesiones');
  });
  it('mobile: compact two-column counts, wrapping rows and touch-sized disclosure', () => {
    const html = rec();
    expect(html).toContain('grid grid-cols-2 gap-3 lg:grid-cols-4');
    expect(html.match(/flex min-h-11 cursor-pointer/g)?.length).toBe(4);
    expect(item(html, 'Caja 1')).toContain('flex flex-wrap items-baseline justify-between');
  });
});
