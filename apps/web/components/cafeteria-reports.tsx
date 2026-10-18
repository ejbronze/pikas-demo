'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { customRangeError, maxReportDays, reportErrors, salesSummarySchema, type ReportPeriod, type SalesSummary } from '../lib/cafeteria/reports';
import { MoneyValue } from './money-value';

// Phase 5D.1 Reportes: sales summary only. Every number is authoritative server output.
const periods: [ReportPeriod, string][] = [['today', 'Hoy'], ['last_7_days', 'Últimos 7 días'], ['last_30_days', 'Últimos 30 días'], ['custom', 'Personalizado']];
const tenderLabel = { cash: 'Efectivo', student_wallet: 'PIKAS Cash', staff_credit: 'Crédito de personal' } as const;
// Business dates are plain calendar dates; never convert them through a browser timezone.
const day = (iso: string) => iso.split('-').reverse().join('/');
const transactions = (n: number) => `${n} ${n === 1 ? 'transacción' : 'transacciones'}`;

function Metric({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return <div className="card min-w-0 p-4"><dt className="text-sm font-bold text-slate-600">{label}</dt><dd className="mt-1 break-words text-2xl font-black">{children}</dd><p className="mt-1 text-xs text-slate-500">{help}</p></div>;
}

export function CafeteriaReports({ cafeteriaId, sandbox }: { cafeteriaId: string; sandbox: boolean }) {
  const [period, setPeriod] = useState<ReportPeriod>('last_30_days');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [draft, setDraft] = useState({ from: '', to: '' });
  const [rangeError, setRangeError] = useState('');
  const [report, setReport] = useState<SalesSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [today, setToday] = useState<string | undefined>();
  // Only the latest request may render, so a slow earlier period never replaces a newer one.
  const sequence = useRef(0);
  const load = useCallback(async (selected: ReportPeriod, custom: { from: string; to: string } | null) => {
    const current = ++sequence.current;
    setLoading(true); setError(''); setReport(null);
    try {
      const response = await sessionFetch('/api/cafeteria/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cafeteria_id: cafeteriaId, period: selected, from: custom?.from ?? null, to: custom?.to ?? null }) });
      const payload = await response.json();
      if (!response.ok) throw Error(reportErrors[payload.error] ?? 'No se pudo cargar el reporte con tus permisos actuales.');
      const parsed = salesSummarySchema.safeParse(payload.result);
      if (!parsed.success || parsed.data.cafeteria_id !== cafeteriaId || parsed.data.period !== selected) throw Error('No se pudo cargar el reporte con tus permisos actuales.');
      if (current === sequence.current) { setReport(parsed.data); setToday(parsed.data.today); }
    } catch (e) { if (current === sequence.current) setError(e instanceof Error && e.message ? e.message : 'No se pudo cargar el reporte con tus permisos actuales.'); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [cafeteriaId]);
  useEffect(() => { if (sandbox) return; if (period !== 'custom') queueMicrotask(() => void load(period, null)); }, [sandbox, period, load]);

  if (sandbox) return <section className="mt-5"><h1 className="text-3xl font-black">Reportes</h1><p className="card mt-5 p-5">Los reportes financieros no están disponibles en el entorno sandbox.</p></section>;
  return <section className="space-y-5">
    <header><h1 className="text-3xl font-black">Reportes</h1><p className="mt-1 text-sm text-slate-600">Resumen de ventas de esta cafetería. Para buscar una venta concreta usa Transacciones.</p></header>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Período del reporte">
      {periods.map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} className={`min-h-11 ${period === value ? 'btn' : 'btn-secondary'}`}
        onClick={() => { setPeriod(value); setRangeError(''); if (value === 'custom') { setReport(null); setError(''); if (range) void load('custom', range); } }}>{label}</button>)}
    </div>
    {period === 'custom' && <form className="card flex flex-wrap items-end gap-3 p-4" noValidate onSubmit={event => {
      event.preventDefault(); const problem = customRangeError(draft.from, draft.to); setRangeError(problem ?? '');
      if (!problem) { setRange(draft); void load('custom', draft); } }}>
      <label className="block min-w-0 font-bold">Desde<input type="date" className="field mt-1" value={draft.from} max={today} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
      <label className="block min-w-0 font-bold">Hasta<input type="date" className="field mt-1" value={draft.to} max={today} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
      <button className="btn-secondary min-h-11" disabled={loading}>Ver reporte</button>
      <p className="w-full text-xs text-slate-500">Máximo {maxReportDays} días, ambos incluidos.</p>
      {rangeError && <p role="alert" className="w-full font-bold text-red-700">{rangeError}</p>}
    </form>}
    <ReportBody loading={loading} error={error} report={report} onRetry={() => void load(period, period === 'custom' ? range : null)} />
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
