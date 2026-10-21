'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { customRangeError, maxReportDays, reportErrors, type ReportPeriod } from '../lib/cafeteria/reports';
import { walletReportSchema, type WalletReport } from '../lib/school/wallet-report';
import { AppPageHeader } from './app-page-header';
import { DataList } from './data-list';
import { MetricCard } from './metric-card';
import { MoneyValue } from './money-value';
import { EmptyState, ErrorState } from './state-panels';

const periods: [ReportPeriod, string][] = [['today', 'Hoy'], ['last_7_days', 'Últimos 7 días'], ['last_30_days', 'Últimos 30 días'], ['custom', 'Personalizado']];
const neg = (minor: string) => minor === '0' ? '0' : `-${minor}`;
const times = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
type Range = { from: string; to: string } | null;

// Phase 5D.5 School PIKAS Cash report: wallet activity of this school's students only. Every number
// is returned by school_wallet_report; this component formats it and never adds amounts.
// `embedded` (UX 7): rendered inside School PIKAS Cash as a secondary report, without its own header or
// "Ahora" snapshot (the page above already shows the current wallet state).
export function SchoolWalletReport({ schoolId, embedded = false }: { schoolId: string; embedded?: boolean }) {
  const [period, setPeriod] = useState<ReportPeriod>('last_30_days'), [range, setRange] = useState<Range>(null), [draft, setDraft] = useState({ from: '', to: '' }), [rangeError, setRangeError] = useState('');
  const [report, setReport] = useState<WalletReport | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const latest = useRef(0);
  const load = useCallback(async (selected: ReportPeriod, custom: Range) => {
    const id = ++latest.current; setLoading(true); setError('');
    try {
      const response = await sessionFetch('/api/school/wallet-report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_id: schoolId, period: selected, from: custom?.from ?? null, to: custom?.to ?? null }) });
      const payload = await response.json().catch(() => ({}));
      if (id !== latest.current) return;
      if (!response.ok) { setReport(null); setError(reportErrors[payload.error] ?? (response.status === 403 ? 'Tu rol no puede consultar el reporte de PIKAS Cash de esta escuela.' : 'No se pudo cargar el reporte de PIKAS Cash.')); return; }
      const parsed = walletReportSchema.safeParse(payload.result);
      if (!parsed.success || parsed.data.school_id !== schoolId || parsed.data.period !== selected) throw Error();
      setReport(parsed.data);
    } catch { if (id === latest.current) { setReport(null); setError('No se pudo cargar el reporte de PIKAS Cash.'); } }
    finally { if (id === latest.current) setLoading(false); }
  }, [schoolId]);
  useEffect(() => { if (period === 'custom' && !range) return; queueMicrotask(() => void load(period, period === 'custom' ? range : null)); }, [period, range, revision, load]);
  const r = report, m = r?.movements, c = r?.current;
  const range_label = r ? (r.from === r.to ? r.from : `${r.from} – ${r.to}`) : '';
  return <section className="space-y-5">
    {!embedded && <AppPageHeader title="PIKAS Cash" description="Saldo y movimientos de PIKAS Cash de los estudiantes de esta escuela. No incluye ventas en efectivo ni otras formas de pago."
      action={<button className="btn-secondary" onClick={() => setRevision(v => v + 1)}>Actualizar</button>} />}
    {error && !r ? <ErrorState title={error} retry={<button className="btn-secondary" onClick={() => setRevision(v => v + 1)}>Reintentar</button>} /> : null}
    {c && !embedded && <section aria-labelledby="wallet-now" className="space-y-3">
      <h2 id="wallet-now" className="text-lg font-black">Ahora</h2>
      {c.wallet_count === 0 ? <EmptyState title="Aún no hay monederos PIKAS Cash en esta escuela." description="Se crean con la primera recarga de un estudiante." />
        : <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Saldo PIKAS Cash total" help={`En ${times(c.wallet_count, 'monedero', 'monederos')} de estudiantes, ahora. No depende del período.`}><MoneyValue minor={c.total_balance_minor} intent="balance" /></MetricCard>
          <MetricCard label="Monederos" help={c.frozen_wallet_count ? `${c.frozen_wallet_count} congelado${c.frozen_wallet_count === 1 ? '' : 's'}` : 'Ninguno congelado'}>{c.active_wallet_count} activos</MetricCard>
          {c.negative_wallet_count > 0 && <MetricCard label="Saldos negativos" help={`${times(c.negative_wallet_count, 'monedero', 'monederos')} por debajo de cero`}><MoneyValue minor={c.negative_balance_minor} intent="balance" /></MetricCard>}
        </dl>}
    </section>}
    <section aria-labelledby="wallet-period" className="space-y-3">
      <h2 id="wallet-period" className="text-lg font-black">Movimientos del período</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Período del reporte">{periods.map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} className={`min-h-11 ${period === value ? 'btn' : 'btn-secondary'}`}
        onClick={() => { setRangeError(''); setPeriod(value); }}>{label}</button>)}</div>
      {period === 'custom' && <form className="card flex flex-wrap items-end gap-3 p-4" noValidate onSubmit={event => { event.preventDefault(); const problem = customRangeError(draft.from, draft.to); setRangeError(problem ?? ''); if (!problem) setRange({ ...draft }); }}>
        <label className="block min-w-0 font-bold">Desde<input type="date" className="field mt-1" value={draft.from} max={r?.today} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
        <label className="block min-w-0 font-bold">Hasta<input type="date" className="field mt-1" value={draft.to} max={r?.today} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
        <button className="btn-secondary">Aplicar fechas</button><p className="basis-full text-sm text-slate-600">Hasta {maxReportDays} días, por fecha de operación de la escuela.</p>
        {rangeError && <p role="alert" className="basis-full text-sm font-bold text-red-800">{rangeError}</p>}</form>}
      {loading && <p role="status" className="text-sm">Cargando reporte…</p>}
      {error && r ? <ErrorState title={error} /> : null}
      {r && m && !loading && <>
        <p className="text-sm text-slate-600" role="status">{range_label} · fechas de operación de la escuela ({r.business_timezone})</p>
        {m.entry_count === 0 ? <EmptyState title="Sin movimientos de PIKAS Cash en este período." description="No hubo recargas, compras, reembolsos ni correcciones en estas fechas." />
          : <>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard label="Recargas" help={times(m.replenishments.count, 'recarga', 'recargas')}><MoneyValue minor={m.replenishments.amount_minor} intent="movement" /></MetricCard>
              <MetricCard label="Compras con PIKAS Cash" help={times(m.purchases.count, 'compra', 'compras')}><MoneyValue minor={neg(m.purchases.amount_minor)} intent="movement" /></MetricCard>
              <MetricCard label="Reembolsos a PIKAS Cash" help={times(m.refunds.count, 'reembolso de compra', 'reembolsos de compras')}><MoneyValue minor={m.refunds.amount_minor} intent="movement" /></MetricCard>
            </dl>
            <details className="card p-4" open={m.reversals.count + m.adjustment_credits.count + m.adjustment_debits.count + m.historical_adjustments.count > 0}>
              <summary className="flex min-h-11 cursor-pointer items-center font-bold">Correcciones y movimiento neto</summary>
              <dl className="mt-3 divide-y rounded-xl border text-sm">
                {([
                  ['Reversiones de recarga', <MoneyValue key="rv" minor={neg(m.reversals.amount_minor)} intent="movement" />, `${times(m.reversals.count, 'reversión', 'reversiones')}. Corrigen recargas; no son reembolsos de compras.`],
                  ['Recargas netas', <MoneyValue key="nr" minor={m.net_replenished_minor} intent="movement" />, 'Recargas − Reversiones de recarga.'],
                  ['Ajustes administrativos (aumentos)', <MoneyValue key="ac" minor={m.adjustment_credits.amount_minor} intent="movement" />, times(m.adjustment_credits.count, 'ajuste', 'ajustes')],
                  ['Ajustes administrativos (disminuciones)', <MoneyValue key="ad" minor={neg(m.adjustment_debits.amount_minor)} intent="movement" />, times(m.adjustment_debits.count, 'ajuste', 'ajustes')],
                  ...(m.historical_adjustments.count > 0 ? [['Ajustes históricos', <MoneyValue key="ah" minor={m.historical_adjustments.net_minor} intent="movement" />, `${times(m.historical_adjustments.count, 'ajuste', 'ajustes')} anteriores a los ajustes administrativos.`] as const] : []),
                  ['Movimiento neto del período', <MoneyValue key="nm" minor={m.net_movement_minor} intent="movement" className="font-black" />, `Suma de todos los movimientos de ${times(m.wallets_with_movement, 'monedero', 'monederos')}.`],
                ] as const).map(([label, value, help]) => <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"><dt><span className="font-bold">{label}</span><span className="block text-slate-600">{help}</span></dt><dd className="font-bold">{value}</dd></div>)}
              </dl>
            </details>
          </>}
        <section aria-labelledby="wallet-cafeterias" className="space-y-2">
          <h3 id="wallet-cafeterias" className="font-black">¿Dónde se usó PIKAS Cash?</h3>
          <p className="text-sm text-slate-600">Solo compras pagadas con PIKAS Cash por estudiantes de esta escuela. No son las ventas totales de cada cafetería.</p>
          {!r.cafeterias.length ? <EmptyState title="No hubo compras con PIKAS Cash en este período." />
            : <DataList label="PIKAS Cash por cafetería" rows={r.cafeterias} rowKey={x => x.cafeteria_id} columns={[
              { header: 'Cafetería', primary: true, cell: x => x.name },
              { header: 'Compras con PIKAS Cash', align: 'end', cell: x => <><MoneyValue minor={neg(x.spent_minor)} intent="movement" className="font-bold" /><span className="block text-xs font-normal text-slate-600">{times(x.purchase_count, 'compra', 'compras')}</span></> },
              { header: 'Reembolsos a PIKAS Cash', align: 'end', cell: x => x.refund_count ? <><MoneyValue minor={x.refunded_minor} intent="movement" /><span className="block text-xs text-slate-600">{times(x.refund_count, 'reembolso', 'reembolsos')}</span></> : 'Ninguno' },
            ]} />}
        </section>
      </>}
    </section>
  </section>;
}
