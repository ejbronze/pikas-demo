import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({ default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({ default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} /> }));
(globalThis as { React?: typeof React }).React = React;
import { CafeteriaTodayView, type TodayInputs } from './cafeteria-today';
import { cafeteriaRead, id } from '../lib/cafeteria/test-fixtures';
import { todayRead } from '../lib/cafeteria/today-fixtures';
import { closedSession, openSession, reconciliation, summary, topProducts } from '../lib/cafeteria/report-fixtures';
import { reportResultSchema } from '../lib/cafeteria/reports';
import type { CafeteriaRead } from '../lib/cafeteria/contracts';

const ready = <T,>(value: T) => ({ status: 'ready', value }) as const;
const caps = ['cafeteria:pos:purchases:read', 'cafeteria:pos:sessions:read'];
function data(patch: Partial<CafeteriaRead> = {}): CafeteriaRead {
  const d = cafeteriaRead();
  return { ...d, scope: { ...d.scope, capabilities: caps }, products: [{ id, name: 'Empanada ficticia', description: null, unit: null, category_id: null, price_minor: 5000, active: true, available: true, ingredients: null, allergens: null, version: 1 }] as unknown as CafeteriaRead['products'],
    staff: [{ id, status: 'active' }] as unknown as CafeteriaRead['staff'], registers: [{ id: '5d300000-0000-4000-8000-000000000905', code: 'CAJA-01', name: 'Caja 5', status: 'active', version: 1, has_history: true, open: true }],
    assignments: [{ id, membership_id: id, register_id: '5d300000-0000-4000-8000-000000000905', status: 'active', version: 1 }], ...patch };
}
const zeroSummary = summary({ gross_sales_minor: '0', refunds_minor: '0', net_sales_minor: '0', transaction_count: 0, refund_count: 0, average_ticket_minor: null,
  refunds_by_tender: { cash: '0', student_wallet: '0' }, tenders: ['cash', 'student_wallet', 'staff_credit'].map(tender => ({ tender, transaction_count: 0, gross_sales_minor: '0' })) });
const sales = (s = summary({ transaction_count: 6, average_ticket_minor: '3333' })) => ready(reportResultSchema.sales_summary.parse({ ...s, period: 'today' }));
const products = (rows = [{ name: 'Empanada ficticia', gross: 12, refunded: 0 }, { name: 'Jugo ficticio', gross: 6, refunded: 1 }]) => ready(reportResultSchema.top_products.parse({ ...topProducts(rows), period: 'today' }));
const recon = (closed: unknown[] = [], open: unknown[] = [{ ...openSession(5), opened_local: '2026-10-20T07:42' }]) => ready(reportResultSchema.reconciliation.parse({ ...reconciliation(closed, open, { closed_count: closed.length, balanced_count: closed.length, shortage_count: 0, overage_count: 0, uncaptured_count: 0 }), period: 'last_7_days' }));
const normal = todayRead({ today: { 8: [8000, 2], 12: [12000, 4] }, baseline: { 8: [9000, 3], 12: [9000, 3], 15: [4000, 1] }, cutoff: [18000, 6],
  lastSale: { purchased_at: '2026-10-20T16:37:00+00:00', purchased_local: '2026-10-20T12:37', business_date: '2026-10-20', register_name: 'Caja 5' }, firstSale: '2026-09-01' });
const inputs = (patch: Partial<TodayInputs> = {}): TodayInputs => ({ today: ready(normal), summary: sales(), products: products(), recon: recon(), ...patch });
const render = (i: TodayInputs, d = data(), business = true) => renderToStaticMarkup(<CafeteriaTodayView data={d} business={business} inputs={i} />);

describe('Cafetería Hoy', () => {
  it('normal day: hero gross in RD$, same-time comparison, KPIs, chart, products, cajas and tender mix', () => {
    const html = render(inputs());
    expect(html).toContain('Ventas de hoy'); expect(html).toContain('RD$ 200.00');
    expect(html).toContain('11% vs. martes pasado a esta hora'); expect(html).toContain('<span class="sr-only">Sube</span>');
    expect(html).toContain('Ticket promedio'); expect(html).toContain('RD$ 33.33'); expect(html).toContain('25.0%'); expect(html).not.toMatch(/\d %/);
    expect(html).toContain('Hora con más ventas: <b class="text-slate-900">12:00</b>');
    expect(html).toContain('Empanada ficticia'); expect(html).toContain('12 uds.');
    expect(html).toContain('Última venta 12:37 · Caja 5'); expect(html).toContain('1 caja abierta');
    expect(html).toContain('Cajera ficticia · desde 07:42'); expect(html).toMatch(/data-state="open"[^>]*>Abierta</);
    expect(html).toContain('PIKAS Cash'); expect(html).toContain('Efectivo'); expect(html).toContain('Crédito de personal');
    expect(html).toContain('2 reembolsos hoy'); expect(html).toContain('Netas <span class="num">RD$ 100.00');
    expect(html).toContain('<div class="sr-only"><table>');
    expect(html).not.toMatch(/agotad|inventario|stock/i);
  });
  it('zero sales: invites the first sale, no fake comparison, no average ticket', () => {
    const html = render(inputs({ today: ready(todayRead()), summary: ready(reportResultSchema.sales_summary.parse({ ...zeroSummary, period: 'today' })), products: products([]) }));
    expect(html).toContain('Aún no hay ventas hoy. La primera venta aparecerá aquí.'); expect(html).toContain('RD$ 0.00');
    expect(html).not.toContain('% vs.'); expect(html).not.toContain('martes pasado a esta hora');
    expect(html).toContain('con la primera venta'); expect(html).toContain('Los productos más vendidos aparecerán con las primeras ventas.');
    expect(html).toContain('Los medios de pago aparecerán con la primera venta.'); expect(html).toContain('pikas-logo-mark');
  });
  it('one sale with history: shows last week as a plain amount, never a percentage', () => {
    const html = render(inputs({ today: ready(todayRead({ today: { 9: [5000, 1] }, baseline: { 9: [40000, 7] }, cutoff: [40000, 7] })), summary: sales(summary({ gross_sales_minor: '5000', transaction_count: 1 })) }));
    expect(html).toContain('El martes pasado a esta hora: <span class="num">RD$ 400.00</span>'); expect(html).not.toContain('% vs.'); expect(html).toContain('hoy-ref-line');
  });
  it('no baseline: omits the comparison and explains the chart reference', () => {
    const html = render(inputs({ today: ready(todayRead({ today: { 9: [56000, 6] } })) }));
    expect(html).not.toContain('a esta hora'); expect(html).not.toContain('hoy-ref-line'); expect(html).toContain('La comparación aparecerá cuando haya ventas del martes pasado.');
  });
  it('first sale ever today: restrained milestone, not persisted', () => {
    expect(render(inputs({ today: ready(todayRead({ today: { 9: [5000, 1] }, firstSale: '2026-10-20' })) }))).toContain('¡Primera venta con PIKAS!');
    expect(render(inputs())).not.toContain('¡Primera venta con PIKAS!');
  });
  it('no attention items: calm healthy state instead of an empty warning box', () => {
    const html = render(inputs()); expect(html).toContain('Todo en orden'); expect(html).not.toContain('hoy-attention');
  });
  it('attention: real reconciliation and stale-session signals with deep links', () => {
    const html = render(inputs({ recon: recon([closedSession(1, '300000', '285000', '-15000', 'shortage', { closed_business_date: '2026-10-19' })], [{ ...openSession(5), opened_local: '2026-10-19T07:42' }]) }));
    expect(html).toContain('Requiere atención'); expect(html).toContain('Cierre del lunes con faltante de RD$ 150.00 (Caja 1)');
    expect(html).toContain('Caja 5 abierta desde el lunes 19/10'); expect(html).toContain(`href="/admin/cafeteria/reportes/cajas?cafeteria=${id}&amp;period=last_7_days"`);
    expect(html).toContain(`href="/admin/cafeteria/cajas?cafeteria=${id}"`); expect(html).toContain('Abierta · revisar');
  });
  it('UX 9: today figures open the matching report for the same period and read', () => {
    const html = render(inputs());
    expect(html.match(new RegExp(`href="/admin/cafeteria/reportes/ventas\\?cafeteria=${id}&amp;period=today"`, 'g'))?.length).toBe(3); // gross, sales, average ticket
    expect(html).toContain(`href="/admin/cafeteria/reportes/pagos?cafeteria=${id}&amp;period=today"`);
    expect(html).toContain(`href="/admin/cafeteria/reportes/productos?cafeteria=${id}&amp;period=today"`);
    expect(html).not.toMatch(/href="\/admin\/cafeteria\/reportes\?/); // nothing lands on the bare landing
  });
  it('no open caja: says so and points to Cajas', () => {
    const html = render(inputs({ recon: recon([], []) }), data({ registers: [{ id, code: 'CAJA-01', name: 'Caja principal', status: 'active', version: 1, has_history: true, open: false }] }));
    expect(html).toContain('Ninguna caja abierta'); expect(html).toContain('Ninguna caja abierta ahora. Las cajas se abren desde el POS.'); expect(html).toMatch(/data-state="closed"[^>]*>Cerrada</);
  });
  it('loading and failures never render as zeros', () => {
    const loading = render({ today: { status: 'loading' }, summary: { status: 'loading' }, products: { status: 'loading' }, recon: { status: 'loading' } });
    expect(loading).toContain('Cargando ventas…'); expect(loading).not.toContain('RD$ 0.00');
    const failed = render({ today: { status: 'error' }, summary: { status: 'error' }, products: { status: 'error' }, recon: { status: 'error' } });
    expect(failed).toContain('No pudimos cargar las ventas de hoy'); expect(failed).not.toContain('RD$ 0.00'); expect(failed).not.toContain('Todo en orden');
  });
  it('without session history authority: no attention claims, no cajas detail', () => {
    const html = render(inputs({ recon: null })); expect(html).toContain('requieren acceso al historial de cajas'); expect(html).not.toContain('Todo en orden'); expect(html).not.toContain('Cajera ficticia');
  });
  it('sandbox or no purchase authority: operational view only, no sales', () => {
    const d = data(); const sandbox = { ...d, scope: { ...d.scope, tenant_kind: 'sandbox' as const } };
    const html = render(inputs(), sandbox, false);
    expect(html).toContain('no están disponibles en el entorno sandbox'); expect(html).not.toContain('Ventas de hoy'); expect(html).not.toContain('RD$'); expect(html).toContain('Cajas ahora');
    expect(render(inputs(), data(), false)).toContain('Tu rol no tiene acceso a las ventas');
  });
  it('refresh is a compact secondary control; long operator names are shown in full', () => {
    const long = 'Synthetic multi-cafeteria person with an unusually long fictional name';
    const html = renderToStaticMarkup(<CafeteriaTodayView data={data()} business inputs={inputs({ recon: recon([], [{ ...openSession(5), operator_name: long, opened_local: '2026-10-19T07:42' }]) })} onRefresh={() => {}} />);
    expect(html).toMatch(/<button type="button" class="hoy-refresh">.*Actualizar<\/button>/); expect(html).not.toContain('class="btn-secondary">Actualizar');
    expect(html.split(long).length - 1).toBe(2); expect(html).not.toContain('…');
  });
  it('UX 12A: the management map names the inherited context and what the admin manages; readiness is collapsed once operating', () => {
    const html = render(inputs());
    expect(html).toContain('Estás administrando'); expect(html).toContain('<h2 id="map-title" class="font-display break-words text-2xl font-black text-[var(--primary)]">Real cafeteria</h2>');
    expect(html).toContain('Sede: Real campus · Colegio: Real school'); expect(html).toContain('no tienes que crearlos');
    expect(html).toContain('data-launch="operating">En operación'); expect(html).toContain('Puesta en marcha'); expect(html).toMatch(/<details class="mt-2"><summary[^>]*>Ver los pasos/);
    expect(html).not.toContain('Completa la configuración para vender'); expect(html).not.toContain('Confirmar cafetería');
    expect(html).toContain('<p class="text-sm text-slate-600">Martes, 20 de octubre</p>');
  });
  it('UX 12A: an unconfigured cafetería gets the readiness guide on top with one contextual next step; ready needs no sale', () => {
    const setup = render(inputs(), data({ products: [], registers: [], assignments: [] }));
    expect(setup.indexOf('Puesta en marcha')).toBeLessThan(setup.indexOf('Estado en vivo')); expect(setup).toContain('Siguiente paso: Crear caja.');
    expect(setup).toContain('>Crear caja para Real cafeteria<'); expect(setup).toContain('data-launch="configuring">En configuración'); expect(setup).toContain('No hay cajas activas.');
    expect(setup).toContain('Contexto establecido por PIKAS'); expect(setup).toContain('Sede Real campus'); expect(setup).not.toMatch(/<details[^>]*open/);
    const ready = render(inputs({ summary: sales(zeroSummary) }), data({ registers: [{ id: '5d300000-0000-4000-8000-000000000905', code: 'CAJA-01', name: 'Caja 5', status: 'active', version: 1, has_history: false, open: false }] }));
    expect(ready).toContain('data-launch="ready">Lista para operar'); expect(ready).toContain('no hace falta una venta'); expect(ready).toContain('3 de 4');
  });
});
