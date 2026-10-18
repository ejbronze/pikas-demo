'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { sessionFetch } from '../lib/auth/session-fetch';
import { customRangeError, latestGate, maxReportDays, reportErrors, reportResultSchema, type ReportKind, type ClosedSession, type OpenSession, type Reconciliation, type ReportPeriod, type SalesSummary, type TopProducts } from '../lib/cafeteria/reports';
import { moneyToneClass } from '../lib/money-semantics';
import { MoneyValue } from './money-value';

// Phase 5D Reportes: sales summary (5D.1), top products (5D.2) and register reconciliation (5D.3) for
// ONE selected period.
// Every number is authoritative server output; each section loads and fails independently.
const periods: [ReportPeriod, string][] = [['today', 'Hoy'], ['last_7_days', 'Últimos 7 días'], ['last_30_days', 'Últimos 30 días'], ['custom', 'Personalizado']];
const tenderLabel = { cash: 'Efectivo', student_wallet: 'PIKAS Cash', staff_credit: 'Crédito de personal' } as const;
// Business dates are plain calendar dates; never convert them through a browser timezone.
const day = (iso: string) => iso.split('-').reverse().join('/');
const transactions = (n: number) => `${n} ${n === 1 ? 'transacción' : 'transacciones'}`;
const failure = 'No se pudo cargar el reporte con tus permisos actuales.';
type Range = { from: string; to: string } | null;
type Section<T> = { loading: boolean; error: string; report: T | null };
type Results = { sales_summary: SalesSummary; top_products: TopProducts; reconciliation: Reconciliation };

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

// reconciliation: the server-derived cafeteria:pos:sessions:read grant (the RPC enforces it again).
export function CafeteriaReports({ cafeteriaId, sandbox, reconciliation = false }: { cafeteriaId: string; sandbox: boolean; reconciliation?: boolean }) {
  const [period, setPeriod] = useState<ReportPeriod>('last_30_days');
  const [range, setRange] = useState<Range>(null);
  const [draft, setDraft] = useState({ from: '', to: '' });
  const [rangeError, setRangeError] = useState('');
  const [today, setToday] = useState<string | undefined>();
  const [summary, loadSummary, clearSummary] = useReport(cafeteriaId, 'sales_summary');
  const [products, loadProducts, clearProducts] = useReport(cafeteriaId, 'top_products');
  const [cash, loadCash, clearCash] = useReport(cafeteriaId, 'reconciliation');
  // Every section always requests the same selected period.
  const loadAll = useCallback((selected: ReportPeriod, custom: Range) => {
    void loadSummary(selected, custom); void loadProducts(selected, custom); if (reconciliation) void loadCash(selected, custom);
  }, [loadSummary, loadProducts, loadCash, reconciliation]);
  useEffect(() => { if (sandbox) return; if (period !== 'custom') queueMicrotask(() => loadAll(period, null)); }, [sandbox, period, loadAll]);
  useEffect(() => { if (summary.report) queueMicrotask(() => setToday(summary.report?.today)); }, [summary.report]);
  const loading = summary.loading || products.loading || cash.loading;

  if (sandbox) return <section className="mt-5"><h1 className="text-3xl font-black">Reportes</h1><p className="card mt-5 p-5">Los reportes financieros no están disponibles en el entorno sandbox.</p></section>;
  return <section className="space-y-5">
    <header><h1 className="text-3xl font-black">Reportes</h1><p className="mt-1 text-sm text-slate-600">{reconciliation ? 'Ventas, productos y conciliación de caja' : 'Resumen de ventas'} de esta cafetería. Para buscar una venta concreta usa Transacciones.</p></header>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Período del reporte">
      {periods.map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} className={`min-h-11 ${period === value ? 'btn' : 'btn-secondary'}`}
        onClick={() => { setPeriod(value); setRangeError(''); if (value === 'custom') { clearSummary(); clearProducts(); clearCash(); if (range) loadAll('custom', range); } }}>{label}</button>)}
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
    {reconciliation && <ReconciliationBody cafeteriaId={cafeteriaId} loading={cash.loading} error={cash.error} report={cash.report} onRetry={() => void loadCash(period, period === 'custom' ? range : null)} />}
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
      <p className="text-xs text-slate-500">Incluye ventas de cajas abiertas. Las recargas y ajustes de PIKAS Cash no son ventas. El efectivo físico se concilia por sesión de caja.</p>
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

// 5D.3 Conciliación de caja. Closed sessions show the immutable Phase 5A close capture as returned;
// nothing is recalculated here. Open registers are current state: no count, difference or status.
const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// School-local wall time from the server ("YYYY-MM-DDTHH:MM"); never converted by the browser.
const wallTime = (local: string) => {
  const [date, time] = local.split('T'); const [, m, d] = date.split('-').map(Number); const [h, min] = time.split(':').map(Number);
  return `${d} ${months[m - 1]}, ${h % 12 || 12}:${String(min).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};
const outflow = (minor: string) => (minor === '0' ? '0' : `-${minor}`);
const sessions = (n: number) => `${n} ${n === 1 ? 'sesión' : 'sesiones'}`;

export function Discrepancy({ session: s }: { session: ClosedSession }) {
  if (s.status === 'uncaptured') return <span className="font-bold text-slate-600">Sin captura al cierre</span>;
  if (s.status === 'balanced') return <span className="font-bold">Cuadrada</span>;
  return <span className="font-bold">{s.status === 'shortage' ? 'Faltante' : 'Sobrante'} <MoneyValue minor={s.difference_minor!} intent="movement" /></span>;
}

function CashBreakdown({ s, live }: { s: Pick<OpenSession, 'opening_minor' | 'cash_sales_minor' | 'cash_settlements_minor' | 'cash_refunds_minor' | 'expected_minor'>; live: boolean }) {
  const row = (label: string, value: React.ReactNode) => <div key={label} className="flex flex-wrap justify-between gap-x-3"><dt className="text-slate-600">{label}</dt><dd className="font-bold">{value}</dd></div>;
  return <>{[
    row('Fondo inicial', <MoneyValue minor={s.opening_minor} intent="amount" />),
    row('Ventas en efectivo', <MoneyValue minor={s.cash_sales_minor} intent="amount" />),
    row('Cobros de cuentas de personal', <MoneyValue minor={s.cash_settlements_minor} intent="amount" />),
    row('Reembolsos en efectivo', <MoneyValue minor={outflow(s.cash_refunds_minor)} intent="movement" />),
    row(live ? 'Efectivo esperado ahora' : 'Efectivo esperado', <MoneyValue minor={s.expected_minor} intent="balance" />),
  ]}</>;
}

function ClosedRow({ s }: { s: ClosedSession }) {
  return <li className="min-w-0 space-y-1 py-3">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="break-words font-bold">{s.register_name}</span><Discrepancy session={s} /></div>
    <p className="text-sm text-slate-600">Cerrada {wallTime(s.closed_local)} · {s.operator_name}</p>
    <p className="flex flex-wrap gap-x-3 text-sm">{s.expected_minor !== null && <span>Esperado <MoneyValue minor={s.expected_minor} intent="balance" className="font-bold" /></span>}
      <span>Contado <MoneyValue minor={s.counted_minor} intent="amount" className="font-bold" /></span></p>
    <details className="text-sm"><summary className="flex min-h-11 cursor-pointer items-center font-bold text-teal-800">Ver desglose</summary>
      <dl className="space-y-1 pb-2">
        {s.captured ? <CashBreakdown s={s as Parameters<typeof CashBreakdown>[0]['s']} live={false} /> : <p className="text-slate-600">Cierre anterior a la captura de conciliación: no hay esperado ni diferencia guardados al cierre.</p>}
        <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-slate-600">Efectivo contado</dt><dd className="font-bold"><MoneyValue minor={s.counted_minor} intent="amount" /></dd></div>
        {s.difference_minor !== null && <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-slate-600">Diferencia (contado − esperado)</dt><dd><Discrepancy session={s} /></dd></div>}
        <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-slate-600">Apertura</dt><dd>{wallTime(s.opened_local)}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-slate-600">Cierre</dt><dd className="break-words">{wallTime(s.closed_local)} · {s.close_type === 'exceptional' ? 'Excepcional' : 'Normal'} · {s.closed_by_name}</dd></div>
      </dl><p className="break-all text-xs text-slate-500">Sesión {s.session_id}</p></details>
  </li>;
}

function OpenRow({ s }: { s: OpenSession }) {
  return <li className="min-w-0 space-y-1 py-3">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="break-words font-bold">{s.register_name}</span><span className="rounded-full bg-amber-100 px-2 text-sm font-bold text-amber-900">Abierta · sin conciliar</span></div>
    <p className="text-sm text-slate-600">Abierta desde {wallTime(s.opened_local)} · {s.operator_name}</p>
    <p className="text-sm">Efectivo esperado ahora <MoneyValue minor={s.expected_minor} intent="balance" className="font-bold" /></p>
    <details className="text-sm"><summary className="flex min-h-11 cursor-pointer items-center font-bold text-teal-800">Ver desglose</summary>
      <dl className="space-y-1 pb-2"><CashBreakdown s={s} live /></dl><p className="break-all text-xs text-slate-500">Sesión {s.session_id}</p></details>
  </li>;
}

export function ReconciliationBody({ cafeteriaId, loading, error, report, onRetry }: { cafeteriaId: string; loading: boolean; error: string; report: Reconciliation | null; onRetry: () => void }) {
  const d = report?.data;
  const none = d && d.summary.closed_count === 0 && d.open_sessions.length === 0;
  return <>
    <section className="card space-y-3 p-4" aria-labelledby="report-reconciliation">
      <div><h2 id="report-reconciliation" className="text-xl font-black">Conciliación de caja</h2>
        <p className="text-xs text-slate-500">Sesiones cerradas en el período, por fecha de cierre. Valores guardados al cerrar cada caja; diferencia = contado − esperado. Solo efectivo físico: PIKAS Cash, crédito de personal y recargas no entran.</p></div>
      {loading && <p role="status">Cargando conciliación…</p>}
      {error && <div role="alert" className="space-y-3"><p className="font-bold">{error}</p><button type="button" className="btn-secondary min-h-11" onClick={onRetry}>Reintentar</button></div>}
      {report && d && <>
        <p className="text-sm font-bold text-slate-700">{report.from === report.to ? `Cerradas el ${day(report.from)}` : `Cerradas del ${day(report.from)} al ${day(report.to)}`} · {report.business_timezone}</p>
        {none ? <p role="status">Sin actividad de caja: no se cerraron sesiones en este período y no hay cajas abiertas ahora.</p> : <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Sesiones cerradas" help="En el período.">{d.summary.closed_count}</Metric>
            <Metric label="Cuadradas" help="Contado igual al esperado.">{d.summary.balanced_count}</Metric>
            <Metric label="Con faltante" help="Contado menor que el esperado.">{d.summary.shortage_count}</Metric>
            <Metric label="Con sobrante" help="Contado mayor que el esperado.">{d.summary.overage_count}</Metric>
          </dl>
          {d.summary.uncaptured_count > 0 && <p className="text-xs text-slate-600">{sessions(d.summary.uncaptured_count)} sin captura al cierre (anteriores a la conciliación guardada): sin esperado ni diferencia.</p>}
          {d.summary.closed_count === 0 ? <p role="status">No se cerraron sesiones de caja en este período.</p> : <ul className="divide-y" aria-label="Sesiones cerradas">{d.closed_sessions.map(s => <ClosedRow key={s.session_id} s={s} />)}</ul>}
          {d.summary.closed_count > d.closed_sessions.length && <p className="text-xs text-slate-500">Mostrando las {d.closed_sessions.length} más recientes de {sessions(d.summary.closed_count)}.</p>}
          <p className="text-xs text-slate-500">Un reembolso en efectivo resta de la sesión que lo pagó, que puede no ser la de la venta original; por eso puede no coincidir con los Reembolsos del resumen de ventas.</p>
        </>}
        <p className="text-sm"><Link className="font-bold text-teal-800 underline" href={`/admin/cafeteria/cajas?cafeteria=${cafeteriaId}`}>Ver sesiones y cierres en Cajas</Link></p>
      </>}
    </section>
    {report && d && !none && <section className="card space-y-3 p-4" aria-labelledby="report-open-registers">
      <div><h2 id="report-open-registers" className="text-xl font-black">Cajas abiertas ahora</h2>
        <p className="text-xs text-slate-500">Estado actual, no depende del período. Una caja abierta no está conciliada: no tiene efectivo contado ni diferencia hasta su cierre.</p></div>
      {d.open_sessions.length === 0 ? <p role="status">No hay cajas abiertas ahora.</p> : <ul className="divide-y" aria-label="Cajas abiertas">{d.open_sessions.map(s => <OpenRow key={s.session_id} s={s} />)}</ul>}
    </section>}
  </>;
}
