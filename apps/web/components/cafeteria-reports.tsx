'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { customRangeError, latestGate, maxReportDays, reportErrors, reportResultSchema, type ReportKind, type ReportPeriod, type SalesSummary, type TopProducts } from '../lib/cafeteria/reports';
import { moneyToneClass } from '../lib/money-semantics';
import { MoneyValue } from './money-value';

// Phase 5D Reportes: sales summary (5D.1) and top products (5D.2) for ONE selected period.
// Every number is authoritative server output; each section loads and fails independently.
const periods: [ReportPeriod, string][] = [['today', 'Hoy'], ['last_7_days', 'Últimos 7 días'], ['last_30_days', 'Últimos 30 días'], ['custom', 'Personalizado']];
const tenderLabel = { cash: 'Efectivo', student_wallet: 'PIKAS Cash', staff_credit: 'Crédito de personal' } as const;
// Business dates are plain calendar dates; never convert them through a browser timezone.
const day = (iso: string) => iso.split('-').reverse().join('/');
const transactions = (n: number) => `${n} ${n === 1 ? 'transacción' : 'transacciones'}`;
const failure = 'No se pudo cargar el reporte con tus permisos actuales.';
type Range = { from: string; to: string } | null;
type Section<T> = { loading: boolean; error: string; report: T | null };
type Results = { sales_summary: SalesSummary; top_products: TopProducts };

function Metric({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return <div className="card min-w-0 p-4"><dt className="text-sm font-bold text-slate-600">{label}</dt><dd className="mt-1 break-words text-2xl font-black">{children}</dd><p className="mt-1 text-xs text-slate-500">{help}</p></div>;
}

// Only the latest request of a section may update it, so a slow earlier period never replaces a newer one.
function useReport<K extends ReportKind>(cafeteriaId: string, kind: K) {
  const [state, setState] = useState<Section<Results[K]>>({ loading: false, error: '', report: null });
  const gate = useRef(latestGate());
  const load = useCallback(async (selected: ReportPeriod, custom: Range) => {
    const token = gate.current.next();
    setState({ loading: true, error: '', report: null });
    try {
      const response = await sessionFetch('/api/cafeteria/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cafeteria_id: cafeteriaId, kind, period: selected, from: custom?.from ?? null, to: custom?.to ?? null }) });
      const payload = await response.json();
      if (!response.ok) throw Error(reportErrors[payload.error] ?? failure);
      const parsed = reportResultSchema[kind].safeParse(payload.result);
      if (!parsed.success || parsed.data.cafeteria_id !== cafeteriaId || parsed.data.period !== selected) throw Error(failure);
      if (gate.current.isCurrent(token)) setState({ loading: false, error: '', report: parsed.data as Results[K] });
    } catch (e) { if (gate.current.isCurrent(token)) setState({ loading: false, error: e instanceof Error && e.message ? e.message : failure, report: null }); }
  }, [cafeteriaId, kind]);
  const clear = useCallback(() => { gate.current.next(); setState({ loading: false, error: '', report: null }); }, []);
  return [state, load, clear] as const;
}

export function CafeteriaReports({ cafeteriaId, sandbox }: { cafeteriaId: string; sandbox: boolean }) {
  const [period, setPeriod] = useState<ReportPeriod>('last_30_days');
  const [range, setRange] = useState<Range>(null);
  const [draft, setDraft] = useState({ from: '', to: '' });
  const [rangeError, setRangeError] = useState('');
  const [today, setToday] = useState<string | undefined>();
  const [summary, loadSummary, clearSummary] = useReport(cafeteriaId, 'sales_summary');
  const [products, loadProducts, clearProducts] = useReport(cafeteriaId, 'top_products');
  // Both sections always request the same selected period.
  const loadAll = useCallback((selected: ReportPeriod, custom: Range) => { void loadSummary(selected, custom); void loadProducts(selected, custom); }, [loadSummary, loadProducts]);
  useEffect(() => { if (sandbox) return; if (period !== 'custom') queueMicrotask(() => loadAll(period, null)); }, [sandbox, period, loadAll]);
  useEffect(() => { if (summary.report) queueMicrotask(() => setToday(summary.report?.today)); }, [summary.report]);
  const loading = summary.loading || products.loading;

  if (sandbox) return <section className="mt-5"><h1 className="text-3xl font-black">Reportes</h1><p className="card mt-5 p-5">Los reportes financieros no están disponibles en el entorno sandbox.</p></section>;
  return <section className="space-y-5">
    <header><h1 className="text-3xl font-black">Reportes</h1><p className="mt-1 text-sm text-slate-600">Resumen de ventas de esta cafetería. Para buscar una venta concreta usa Transacciones.</p></header>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Período del reporte">
      {periods.map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} className={`min-h-11 ${period === value ? 'btn' : 'btn-secondary'}`}
        onClick={() => { setPeriod(value); setRangeError(''); if (value === 'custom') { clearSummary(); clearProducts(); if (range) loadAll('custom', range); } }}>{label}</button>)}
    </div>
    {period === 'custom' && <form className="card flex flex-wrap items-end gap-3 p-4" noValidate onSubmit={event => {
      event.preventDefault(); const problem = customRangeError(draft.from, draft.to); setRangeError(problem ?? '');
      if (!problem) { setRange(draft); loadAll('custom', draft); } }}>
      <label className="block min-w-0 font-bold">Desde<input type="date" className="field mt-1" value={draft.from} max={today} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
      <label className="block min-w-0 font-bold">Hasta<input type="date" className="field mt-1" value={draft.to} max={today} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
      <button className="btn-secondary min-h-11" disabled={loading}>Ver reporte</button>
      <p className="w-full text-xs text-slate-500">Máximo {maxReportDays} días, ambos incluidos.</p>
      {rangeError && <p role="alert" className="w-full font-bold text-red-700">{rangeError}</p>}
    </form>}
    <ReportBody loading={summary.loading} error={summary.error} report={summary.report} onRetry={() => void loadSummary(period, period === 'custom' ? range : null)} />
    <TopProductsBody loading={products.loading} error={products.error} report={products.report} onRetry={() => void loadProducts(period, period === 'custom' ? range : null)} />
  </section>;
}

// Presentation of one authoritative result; failure never renders financial zeros.
export function ReportBody({ loading, error, report, onRetry }: { loading: boolean; error: string; report: SalesSummary | null; onRetry: () => void }) {
  const d = report?.data;
  const empty = d && d.transaction_count === 0 && d.refund_count === 0;
  return <>
    {loading && <p role="status">Cargando reporte…</p>}
    {error && <div role="alert" className="card space-y-3 p-4"><p className="font-bold">{error}</p><button type="button" className="btn-secondary min-h-11" onClick={onRetry}>Reintentar</button></div>}
    {report && d && <>
      <p className="text-sm font-bold text-slate-700">{report.from === report.to ? day(report.from) : `Del ${day(report.from)} al ${day(report.to)}`} · Fechas de operación ({report.business_timezone})</p>
      {empty && <p role="status" className="card p-4">Sin ventas ni reembolsos en este período.</p>}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Ventas brutas" help="Compras confirmadas del período, antes de reembolsos."><MoneyValue minor={d.gross_sales_minor} intent="amount" /></Metric>
        <Metric label="Reembolsos" help={d.refund_count ? `${d.refund_count} ${d.refund_count === 1 ? 'reembolso registrado' : 'reembolsos registrados'} en el período, por la fecha del reembolso.` : 'Sin reembolsos en el período.'}>
          <MoneyValue minor={d.refunds_minor === '0' ? '0' : `-${d.refunds_minor}`} intent="movement" /></Metric>
        <Metric label="Ventas netas" help="Ventas brutas − Reembolsos. Puede ser negativa si se reembolsan ventas de otro período."><MoneyValue minor={d.net_sales_minor} intent="balance" /></Metric>
        <Metric label="Transacciones" help="Compras confirmadas; una compra reembolsada sigue contando.">{d.transaction_count}</Metric>
        <Metric label="Ticket promedio" help="Ventas brutas ÷ Transacciones.">{d.average_ticket_minor === null ? <span className="text-slate-500">Sin transacciones</span> : <MoneyValue minor={d.average_ticket_minor} intent="amount" />}</Metric>
      </dl>
      {d.refund_count > 0 && <p className="text-sm text-slate-600">Reembolsos por método: Efectivo <MoneyValue minor={d.refunds_by_tender.cash === '0' ? '0' : `-${d.refunds_by_tender.cash}`} intent="movement" /> · PIKAS Cash <MoneyValue minor={d.refunds_by_tender.student_wallet === '0' ? '0' : `-${d.refunds_by_tender.student_wallet}`} intent="movement" /></p>}
      <section className="card p-4" aria-labelledby="report-tenders"><h2 id="report-tenders" className="text-xl font-black">Método de pago</h2><p className="text-xs text-slate-500">Ventas brutas por método de pago de la compra.</p>
        <ul className="mt-3 divide-y">{d.tenders.filter(t => t.tender !== 'staff_credit' || t.transaction_count > 0).map(t => <li key={t.tender} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <span className="font-bold">{tenderLabel[t.tender]}</span>
          {t.transaction_count === 0 ? <span className="text-slate-500">Sin ventas en este período</span> : <span className="flex flex-wrap gap-3"><span>{transactions(t.transaction_count)}</span><MoneyValue minor={t.gross_sales_minor} intent="amount" className="font-bold" /></span>}</li>)}</ul></section>
      <p className="text-xs text-slate-500">Incluye ventas de cajas abiertas. Las recargas y ajustes de PIKAS Cash no son ventas. El efectivo de caja se concilia en Cajas.</p>
    </>}
  </>;
}

// 5D.2 Productos principales: period activity, not inventory. Units are counts, not money.
const units = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('es-DO')}`;
export function TopProductsBody({ loading, error, report, onRetry }: { loading: boolean; error: string; report: TopProducts | null; onRetry: () => void }) {
  const d = report?.data;
  return <section className="card space-y-3 p-4" aria-labelledby="report-top-products">
    <div><h2 id="report-top-products" className="text-xl font-black">Productos principales</h2>
      <p className="text-xs text-slate-500">Unidades netas del período = vendidas − reembolsadas. Los reembolsos cuentan en la fecha en que ocurren. Es actividad del período, no inventario.</p></div>
    {loading && <p role="status">Cargando productos…</p>}
    {error && <div role="alert" className="space-y-3"><p className="font-bold">{error}</p><button type="button" className="btn-secondary min-h-11" onClick={onRetry}>Reintentar</button></div>}
    {d && (d.products.length === 0 ? <p role="status">Sin ventas ni reembolsos de productos en este período.</p> : <ol className="divide-y" aria-label="Productos por unidades netas">
      {d.products.map(p => <li key={p.product_id} className="flex min-w-0 items-start gap-3 py-3">
        <span className="w-6 shrink-0 text-right font-black text-slate-500">{p.rank}.</span>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="break-words font-bold">{p.product_name}</span>
          <span className={`font-black ${moneyToneClass[p.net_units < 0 ? 'negative' : 'neutral']}`}>{units(p.net_units)} {p.net_units === 1 || p.net_units === -1 ? 'neta' : 'netas'}</span></div>
          <p className="text-sm text-slate-600">{units(p.gross_units)} {p.gross_units === 1 ? 'vendida' : 'vendidas'} · {units(p.refunded_units)} {p.refunded_units === 1 ? 'reembolsada' : 'reembolsadas'}</p></div></li>)}
    </ol>)}
    {d && d.product_count > d.products.length && <p className="text-xs text-slate-500">Mostrando {d.products.length} de {d.product_count} productos con actividad.</p>}
    {d && d.refunds_without_item_detail > 0 && <p className="text-xs text-slate-600">{d.refunds_without_item_detail === 1 ? '1 reembolso' : `${d.refunds_without_item_detail} reembolsos`} del período no tiene detalle por producto (registro anterior a los reembolsos por artículo). Su monto sí está en Reembolsos, pero no en las unidades reembolsadas.</p>}
  </section>;
}
