'use client';
import { classifyStatus, type FailureKind } from '../lib/ux/state-classes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { postRead, type ReadSource } from '../lib/cafeteria/read-source';
import { customRangeError, maxReportDays, type ReportPeriod } from '../lib/cafeteria/reports';
import { authorizationLabel, detailResultSchema, refundReasonLabel, refundStatusLabel, tenderLabel, transactionsErrors, transactionsResultSchema,
  type RefundStatus, type TransactionDetail, type TransactionRow, type TransactionsRequest, type TransactionsResult, type TransactionTender } from '../lib/cafeteria/transactions';
import { AppPageHeader } from './app-page-header';
import { DataList } from './data-list';
import { MoneyValue } from './money-value';
import { EmptyState, ErrorState } from './state-panels';
import { TaskActions, TaskSummary, TaskWindow } from './task-window';

const periods: [ReportPeriod, string][] = [['today', 'Hoy'], ['last_7_days', 'Últimos 7 días'], ['last_30_days', 'Últimos 30 días'], ['custom', 'Personalizado']];
const statusTone: Record<RefundStatus, string> = { none: 'bg-slate-100 text-slate-700', partial: 'bg-amber-100 text-amber-900', full: 'bg-red-100 text-red-800' };
const when = (s: string) => new Date(s).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'medium', timeStyle: 'short' });
type Filters = { period: ReportPeriod; from: string; to: string; tender: TransactionTender | ''; status: RefundStatus | '' };
const initial: Filters = { period: 'last_7_days', from: '', to: '', tender: '', status: '' };

export function RefundChip({ status }: { status: RefundStatus }) {
  return <span className={`chip whitespace-nowrap ${statusTone[status]}`}>{refundStatusLabel[status]}</span>;
}

// Phase 5D.4 Transacciones. Every filter, the count, the page and each refund state come from
// cafeteria_transactions_read; the browser never filters a page or computes refund state.
export function CafeteriaTransactions({ cafeteriaId, sandbox, source }: { cafeteriaId: string; sandbox: boolean; source?: ReadSource }) {
  const endpoint = source?.endpoint, accountId = source?.accountId;
  const [filters, setFilters] = useState<Filters>(initial), [draft, setDraft] = useState({ from: '', to: '' }), [rangeError, setRangeError] = useState('');
  const [receipt, setReceipt] = useState(''), [receiptQuery, setReceiptQuery] = useState<string | null>(null), [receiptError, setReceiptError] = useState('');
  const [offset, setOffset] = useState(0), [result, setResult] = useState<TransactionsResult | null>(null), [error, setError] = useState<{ message: string; kind: FailureKind } | null>(null), [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TransactionRow | null>(null), [revision, setRevision] = useState(0);
  const latest = useRef(0);
  const request = useCallback((): TransactionsRequest | null => receiptQuery !== null
    ? { operation: 'list', cafeteria_id: cafeteriaId, period: null, from: null, to: null, tender: null, refund_status: null, receipt: receiptQuery, offset }
    : filters.period === 'custom' && customRangeError(filters.from, filters.to) ? null
      : { operation: 'list', cafeteria_id: cafeteriaId, period: filters.period, from: filters.period === 'custom' ? filters.from : null, to: filters.period === 'custom' ? filters.to : null,
        tender: filters.tender || null, refund_status: filters.status || null, receipt: null, offset }, [cafeteriaId, filters, receiptQuery, offset]);
  useEffect(() => {
    if (sandbox) return;
    const body = request(); if (!body) return;
    const id = ++latest.current;
    queueMicrotask(() => { if (id === latest.current) { setLoading(true); setError(null); } });
    void (async () => {
      try {
        const response = await postRead('/api/cafeteria/transactions', body, endpoint && accountId ? { endpoint, accountId } : undefined);
        const payload = await response.json().catch(() => ({}));
        if (id !== latest.current) return;
        if (!response.ok) { setResult(null); const kind = classifyStatus(response.status, payload, { cafeteria_authority_required: 'permission' });
          setError({ kind, message: transactionsErrors[payload.error] ?? (kind === 'permission' ? 'Tu rol no puede consultar las transacciones de esta cafetería.' : 'No se pudieron cargar las transacciones.') }); return; }
        const parsed = transactionsResultSchema.safeParse(payload.result);
        if (!parsed.success || parsed.data.cafeteria_id !== cafeteriaId) throw Error();
        setResult(parsed.data);
      } catch { if (id === latest.current) { setResult(null); setError({ kind: 'temporary', message: 'No se pudieron cargar las transacciones.' }); } }
      finally { if (id === latest.current) setLoading(false); }
    })();
  }, [request, revision, sandbox, cafeteriaId, endpoint, accountId]);
  const set = (change: Partial<Filters>) => { setFilters(f => ({ ...f, ...change })); setOffset(0); };
  const filtered = receiptQuery !== null || filters.tender !== '' || filters.status !== '' || filters.period !== initial.period;
  const clear = () => { setFilters(initial); setReceipt(''); setReceiptQuery(null); setReceiptError(''); setRangeError(''); setOffset(0); };
  const page = result ? Math.floor(result.offset / result.page_size) + 1 : 1;
  const range = result?.from && result.to ? (result.from === result.to ? result.from : `${result.from} – ${result.to}`) : '';
  return <section className="space-y-4">
    <AppPageHeader title="Transacciones" description="Ventas de esta cafetería con su estado de reembolso. Horas de Santo Domingo."
      action={<button className="btn-secondary" disabled={sandbox} onClick={() => setRevision(r => r + 1)}>Actualizar</button>} />
    {sandbox ? <p className="card p-4" role="status">El POV sandbox administrativo no concede acceso a operaciones financieras. Esta frontera de autoridad se conserva.</p> : <>
    <div role="search" aria-label="Filtros de transacciones" className="card space-y-4 p-4">
      <form className="flex flex-wrap items-end gap-3" noValidate onSubmit={event => {
        event.preventDefault(); const value = receipt.trim();
        if (!/^[1-9][0-9]{0,17}$/.test(value)) { setReceiptError('Escribe un número de recibo válido (solo dígitos).'); return; }
        setReceiptError(''); setReceiptQuery(value); setOffset(0); }}>
        <label className="block min-w-0 flex-1 basis-56 font-bold">Buscar recibo<input className="field mt-1 w-full" inputMode="numeric" placeholder="Número de recibo, por ejemplo 1042" value={receipt} onChange={e => setReceipt(e.target.value.replace(/^#/, ''))} /></label>
        <button className="btn-secondary">Buscar recibo</button>
      </form>
      {receiptError && <p role="alert" className="text-sm font-bold text-red-800">{receiptError}</p>}
      {receiptQuery !== null ? <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3"><p className="flex-1 basis-56 text-sm">Mostrando el recibo <strong>#{receiptQuery}</strong> en todo el historial. Los demás filtros no se aplican.</p><button type="button" className="btn-secondary" onClick={() => { setReceiptQuery(null); setReceipt(''); setOffset(0); }}>Volver a los filtros</button></div> : <>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Período">{periods.map(([value, label]) => <button key={value} type="button" aria-pressed={filters.period === value} className={`min-h-11 ${filters.period === value ? 'btn' : 'btn-secondary'}`}
          onClick={() => { setRangeError(''); set({ period: value, ...(value === 'custom' ? { from: draft.from, to: draft.to } : {}) }); }}>{label}</button>)}</div>
        {filters.period === 'custom' && <form className="flex flex-wrap items-end gap-3" noValidate onSubmit={event => { event.preventDefault(); const problem = customRangeError(draft.from, draft.to); setRangeError(problem ?? ''); if (!problem) set({ from: draft.from, to: draft.to }); }}>
          <label className="block min-w-0 font-bold">Desde<input type="date" className="field mt-1" value={draft.from} max={result?.today} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
          <label className="block min-w-0 font-bold">Hasta<input type="date" className="field mt-1" value={draft.to} max={result?.today} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
          <button className="btn-secondary">Aplicar fechas</button><p className="basis-full text-sm text-slate-600">Hasta {maxReportDays} días, por fecha de operación de la escuela.</p>
          {rangeError && <p role="alert" className="basis-full text-sm font-bold text-red-800">{rangeError}</p>}</form>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block font-bold">Método de pago<select className="field mt-1 w-full" value={filters.tender} onChange={e => set({ tender: e.target.value as Filters['tender'] })}><option value="">Todos los métodos</option>{(Object.entries(tenderLabel) as [TransactionTender, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="block font-bold">Reembolso<select className="field mt-1 w-full" value={filters.status} onChange={e => set({ status: e.target.value as Filters['status'] })}><option value="">Todos los estados</option>{(Object.entries(refundStatusLabel) as [RefundStatus, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div></>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <p role="status">{loading ? 'Cargando transacciones…' : result ? `${result.total_count} ${result.total_count === 1 ? 'transacción' : 'transacciones'}${range ? ` · ${range}` : ''}` : ''}</p>
      {filtered && <button type="button" className="min-h-11 font-bold text-teal-800 underline" onClick={clear}>Limpiar filtros</button>}
    </div>
    {error ? <ErrorState kind={error.kind} title={error.message} description={error.kind === 'permission' ? 'Lo otorga el administrador de la cafetería; pídeselo si lo necesitas.' : error.kind === 'validation' ? 'Ajusta los filtros y vuelve a buscar.' : undefined} retry={error.kind === 'temporary' ? <button className="btn-secondary" onClick={() => setRevision(r => r + 1)}>Reintentar</button> : undefined} />
      : result && !result.data.length && !loading ? (filtered
        ? <EmptyState title={receiptQuery !== null ? `No encontramos el recibo #${receiptQuery} en esta cafetería.` : 'No encontramos transacciones con estos filtros.'} action={<button className="btn-secondary" onClick={clear}>Limpiar filtros</button>} />
        : <EmptyState title="No hay transacciones en este período." description="Prueba con un período más amplio." />)
      : result && <DataList label="Transacciones" rows={result.data} rowKey={r => r.id} columns={[
        { header: 'Recibo', primary: true, cell: r => <><span>Recibo #{r.receipt_number}</span><span className="block text-sm font-normal text-slate-600">{when(r.purchased_at)}</span></> },
        { header: 'Cliente', cell: r => r.customer_name },
        { header: 'Método', cell: r => tenderLabel[r.tender] },
        { header: 'Total', align: 'end', cell: r => <MoneyValue minor={r.total_minor} intent="amount" className="font-bold" /> },
        { header: 'Reembolso', cell: r => <span className="inline-flex flex-wrap items-center gap-2"><RefundChip status={r.refund_status} />{r.refund_status !== 'none' && <span className="text-sm">Reembolsado <MoneyValue minor={r.refunded_minor} intent="amount" /></span>}</span> },
        { header: 'Caja', cell: r => `${r.register_name} · ${r.operator_name}` },
      ]} actions={r => <button className="btn-secondary" aria-label={`Ver detalle del recibo ${r.receipt_number}`} onClick={() => setSelected(r)}>Ver detalle</button>} />}
    {result && (result.offset > 0 || result.has_more) && <nav aria-label="Páginas de transacciones" className="flex flex-wrap items-center gap-3">
      <button className="btn-secondary" disabled={loading || result.offset === 0} onClick={() => setOffset(Math.max(0, result.offset - result.page_size))}>Anterior</button>
      <span className="text-sm text-slate-600">Página {page} de {Math.max(1, Math.ceil(result.total_count / result.page_size))}</span>
      <button className="btn-secondary" disabled={loading || !result.has_more} onClick={() => setOffset(result.offset + result.page_size)}>Siguiente</button></nav>}
    {selected && <TransactionDetailTask cafeteriaId={cafeteriaId} source={source} row={selected} onClose={() => setSelected(null)} onRefresh={() => setRevision(r => r + 1)} />}
    </>}
  </section>;
}

// Read-only detail from cafeteria_transaction_detail. Refunds are registered only in the POS
// (Phase 5C); this view states how to reach that workflow and never performs one.
function TransactionDetailTask({ cafeteriaId, source, row, onClose, onRefresh }: { cafeteriaId: string; source?: ReadSource; row: TransactionRow; onClose: () => void; onRefresh: () => void }) {
  const endpoint = source?.endpoint, accountId = source?.accountId;
  const [detail, setDetail] = useState<TransactionDetail | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0), [copied, setCopied] = useState('');
  useEffect(() => {
    let live = true;
    queueMicrotask(() => { if (live) { setDetail(null); setError(''); } });
    void (async () => {
      try {
        const response = await postRead('/api/cafeteria/transactions', { operation: 'detail', cafeteria_id: cafeteriaId, purchase_id: row.id }, endpoint && accountId ? { endpoint, accountId } : undefined);
        const parsed = detailResultSchema.safeParse((await response.json()).result);
        if (!response.ok || !parsed.success || parsed.data.data.id !== row.id) throw Error();
        if (live) setDetail(parsed.data.data);
      } catch { if (live) setError('No se pudo cargar el detalle de la transacción.'); }
    })();
    return () => { live = false; };
  }, [cafeteriaId, row.id, revision, endpoint, accountId]);
  const d = detail;
  const refundable = d && d.refund_status !== 'full' && d.tender !== 'staff_credit';
  return <TaskWindow title={`Recibo #${row.receipt_number}`} context={`${when(row.purchased_at)} · ${row.customer_name}`} onClose={onClose}
    footer={<TaskActions><button type="button" className="btn-secondary" onClick={() => { setRevision(r => r + 1); onRefresh(); }}>Actualizar</button><button type="button" className="btn" data-autofocus onClick={onClose}>Cerrar</button></TaskActions>}>
    {error && <ErrorState title={error} retry={<button className="btn-secondary" onClick={() => setRevision(r => r + 1)}>Reintentar</button>} />}
    {!d && !error && <p role="status">Cargando detalle…</p>}
    {d && <>
      <div className="flex flex-wrap items-center gap-3"><RefundChip status={d.refund_status} /><span className="text-sm">Total <MoneyValue minor={d.total_minor} intent="amount" className="font-bold" /></span>
        {d.refund_status !== 'none' && <span className="text-sm">Reembolsado <MoneyValue minor={d.refunded_minor} intent="amount" className="font-bold" /> · Restante <MoneyValue minor={d.remaining_minor} intent="amount" className="font-bold" /></span>}</div>
      <TaskSummary rows={[['Fecha de operación', d.business_date], ['Cliente', d.customer_name], ['Método de pago', tenderLabel[d.tender]], ['Caja', d.register_name], ['Registrada por', d.operator_name],
        ...(d.cash_received_minor !== null ? [['Efectivo recibido', <MoneyValue key="r" minor={d.cash_received_minor} intent="amount" />] as [string, React.ReactNode], ['Cambio', <MoneyValue key="c" minor={d.change_minor ?? '0'} intent="amount" />] as [string, React.ReactNode]] : [])]} />
      <section className="space-y-2"><h3 className="font-black">Artículos</h3>
        <ul className="divide-y rounded-xl border">{d.items.map((i, n) => <li key={n} className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
          <span className="min-w-0"><strong>{i.quantity} × {i.name}</strong><span className="block text-slate-600"><MoneyValue minor={i.unit_price_minor} intent="amount" /> c/u{i.refunded_quantity > 0 ? ` · ${i.refunded_quantity} de ${i.quantity} reembolsado${i.refunded_quantity === 1 ? '' : 's'}` : ''}</span></span>
          <span className="text-right"><MoneyValue minor={i.line_total_minor} intent="amount" className="font-bold" />{i.refunded_quantity > 0 && <span className="block text-slate-600">−<MoneyValue minor={i.refunded_minor} intent="amount" /></span>}</span></li>)}</ul>
        {d.unallocated_refund_minor !== '0' && <p className="rounded-xl bg-amber-50 p-3 text-sm"><MoneyValue minor={d.unallocated_refund_minor} intent="amount" className="font-bold" /> se reembolsó por monto, sin detalle por artículo. No se asigna a ningún artículo.</p>}
      </section>
      <section className="space-y-2"><h3 className="font-black">Reembolsos</h3>
        {!d.refunds.length ? <p className="text-sm text-slate-600">Esta venta no tiene reembolsos.</p>
          : <ol className="space-y-2">{d.refunds.map(r => <li key={r.ordinal} className="rounded-xl border p-3 text-sm">
            <p className="flex flex-wrap justify-between gap-2"><strong>{when(r.occurred_at)}</strong><MoneyValue minor={`-${r.amount_minor}`} intent="movement" className="font-bold" /></p>
            <p>{tenderLabel[r.tender]} · {refundReasonLabel[r.reason] ?? r.reason}{r.notes ? ` · ${r.notes}` : ''}</p>
            <p className="text-slate-600">{r.actor_name} · {authorizationLabel[r.authorization_mode] ?? r.authorization_mode}{r.approver_name ? ` · Aprobó ${r.approver_name}` : ''}{r.register_name ? ` · ${r.register_name}` : ''}</p>
            {r.itemized ? <p>{r.items.map(i => `${i.quantity} × ${i.name}`).join(', ')}</p> : <p className="text-amber-900">Reembolso por monto, sin detalle por artículo.</p>}
            <p className="text-slate-600">Restante después: <MoneyValue minor={r.remaining_after_minor} intent="amount" /></p></li>)}</ol>}
      </section>
      <section className="space-y-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm"><h3 className="font-black">¿Necesitas reembolsar?</h3>
        {d.refund_status === 'full' ? <p>Esta venta ya se reembolsó por completo.</p>
          : d.tender === 'staff_credit' ? <p>Las ventas con crédito de personal no admiten reembolso en el POS.</p>
          : <><p>Los reembolsos se registran en el POS: <strong>Reembolsos → recibo #{d.receipt_number}</strong>, por un cajero o supervisor con una caja abierta. Las aprobaciones siguen las reglas de reembolso de la cafetería.</p>
            <button type="button" className="btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(d.receipt_number); setCopied('Número de recibo copiado.'); } catch { setCopied(`Anota el número de recibo: ${d.receipt_number}`); } }}>Copiar número de recibo</button>
            {copied && <p role="status">{copied}</p>}</>}
        {refundable && <p className="text-slate-600">Después del reembolso, usa Actualizar para ver el estado registrado.</p>}
      </section>
    </>}
  </TaskWindow>;
}
