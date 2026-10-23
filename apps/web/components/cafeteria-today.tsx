'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { postRead } from '../lib/cafeteria/read-source';
import { money } from '../lib/cafeteria/operations';
import { latestGate, reportResultSchema, type Reconciliation, type SalesSummary, type TopProducts } from '../lib/cafeteria/reports';
import { attentionItems, chartWindow, clock, comparison, hourLabel, longDate, peakHour, tenderShares, todaySchema, weekdayName, type TodayRead } from '../lib/cafeteria/today';
import type { CafeteriaRead } from '../lib/cafeteria/contracts';
import { TraceLink } from './report-frame';
import { ManagementMap, ReadinessGuide, StudentServiceNote } from './cafeteria-management-map';
import { cafeteriaReadiness } from '../lib/cafeteria/readiness';

// Cafetería Hoy V1: today's business and operation for ONE cafeteria. Every financial value is
// authoritative server output (5D reports + cafeteria_today_read); sections load and fail
// independently, and a failure is never rendered as zero.
// UX 9: figures that come from today's 5D reads open the matching Cafetería report for the same period
// and read (Ventas / Métodos de pago / Productos for Hoy; Cajas y cierres for the last 7 days).
export type Loaded<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: T };
export type TodayInputs = { today: Loaded<TodayRead>; summary: Loaded<SalesSummary>; products: Loaded<TopProducts>; recon: Loaded<Reconciliation> | null };
const loading = { status: 'loading' } as const;
const tenderLabel = { cash: 'Efectivo', student_wallet: 'PIKAS Cash', staff_credit: 'Crédito de personal' } as const;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const percent = (n: number) => `${n.toLocaleString('es-DO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

async function read<T>(url: string, body: unknown, parse: (v: unknown) => T | null): Promise<Loaded<T>> {
  try {
    const response = await postRead(url, body); if (!response.ok) return { status: 'error' };
    const value = parse((await response.json()).result); return value === null ? { status: 'error' } : { status: 'ready', value };
  } catch { return { status: 'error' }; }
}

export function CafeteriaToday({ data }: { data: CafeteriaRead }) {
  const id = data.scope.cafeteria_id, caps = data.scope.capabilities;
  const business = data.scope.tenant_kind === 'customer' && caps.includes('cafeteria:pos:purchases:read'), sessions = business && caps.includes('cafeteria:pos:sessions:read');
  const [inputs, setInputs] = useState<TodayInputs>({ today: loading, summary: loading, products: loading, recon: sessions ? loading : null });
  const gate = useRef(latestGate());
  const load = useCallback(() => {
    if (!business) return;
    const token = gate.current.next(), set = (patch: Partial<TodayInputs>) => { if (gate.current.isCurrent(token)) setInputs(s => ({ ...s, ...patch })); };
    const report = <K extends 'sales_summary' | 'top_products' | 'reconciliation'>(kind: K, period: 'today' | 'last_7_days') =>
      read('/api/cafeteria/reports', { cafeteria_id: id, kind, period, from: null, to: null }, v => { const p = reportResultSchema[kind].safeParse(v); return p.success && p.data.cafeteria_id === id && p.data.period === period ? p.data : null; });
    setInputs({ today: loading, summary: loading, products: loading, recon: sessions ? loading : null });
    void read('/api/cafeteria/today', { cafeteria_id: id }, v => { const p = todaySchema.safeParse(v); return p.success && p.data.cafeteria_id === id ? p.data : null; }).then(today => set({ today }));
    void report('sales_summary', 'today').then(summary => set({ summary: summary as Loaded<SalesSummary> }));
    void report('top_products', 'today').then(products => set({ products: products as Loaded<TopProducts> }));
    if (sessions) void report('reconciliation', 'last_7_days').then(recon => set({ recon: recon as Loaded<Reconciliation> }));
  }, [business, sessions, id]);
  useEffect(() => { queueMicrotask(load); }, [load]);
  return <CafeteriaTodayView data={data} business={business} inputs={inputs} onRefresh={load} />;
}

export function CafeteriaTodayView({ data, business, inputs, onRefresh }: { data: CafeteriaRead; business: boolean; inputs: TodayInputs; onRefresh?: () => void }) {
  const href = (path: string) => `/admin/cafeteria${path}?cafeteria=${data.scope.cafeteria_id}`, report: Report = (r, q) => `${href(`/reportes/${r}`)}&${q}`;
  const today = inputs.today.status === 'ready' ? inputs.today.value : null, summary = inputs.summary.status === 'ready' ? inputs.summary.value : null;
  const activeRegisters = data.registers.filter(r => r.status === 'active'), openRegisters = activeRegisters.filter(r => r.open);
  // UX 12A: orientation and readiness come from the same read (no sale required to be ready).
  const readiness = cafeteriaReadiness(data), guideOnTop = readiness.status !== 'operating';
  const firstSale = !!today && today.data.today_count > 0 && today.data.first_sale_date === today.today;
  const date = today?.today ?? data.service?.business_date;
  return <div className="hoy space-y-4">
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="font-display text-3xl font-black text-[var(--primary)]">Hoy</h1>
        {date && <p className="text-sm text-slate-600">{longDate(date)}</p>}</div>
      {business && onRefresh && <button type="button" className="hoy-refresh" onClick={onRefresh}><RefreshCw aria-hidden className="size-4" />Actualizar</button>}
    </header>
    {!business && <p className="hoy-note" role="status">{data.scope.tenant_kind === 'sandbox' ? 'Los datos financieros no están disponibles en el entorno sandbox. Aquí ves el estado operativo de la cafetería.' : 'Tu rol no tiene acceso a las ventas de esta cafetería. Aquí ves su estado operativo.'}</p>}
    <ManagementMap data={data} readiness={readiness} />
    {guideOnTop && <ReadinessGuide data={data} readiness={readiness} />}
    {guideOnTop && <StudentServiceNote data={data} />}
    {firstSale && <Milestone name={data.scope.cafeteria_name} />}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">
      <LiveStrip className="order-3 md:order-1 md:col-span-2 lg:col-span-12" open={openRegisters.length} today={today} loading={business && inputs.today.status === 'loading'} />
      {business && <>
        <Hero className="order-1 md:order-3 md:col-span-2 lg:col-span-5" inputs={inputs} report={report} />
        <Kpis className="order-5 md:order-4 md:col-span-2 lg:col-span-7" summary={inputs.summary} report={report} />
        <section aria-labelledby="hoy-dia" className="hoy-panel order-4 md:order-5 md:col-span-2 lg:col-span-8"><h2 id="hoy-dia" className="hoy-h2">Así va el día</h2>
          {inputs.today.status === 'ready' ? <HourlyChart today={inputs.today.value} /> : <SectionState state={inputs.today.status} what="la actividad por hora" />}</section>
        <Attention className="order-2 md:order-6 md:col-span-2 lg:col-span-4" today={today?.today ?? null} recon={inputs.recon} href={href} closes={report('cajas', 'period=last_7_days')} />
        <TopProductsPanel className="order-6 md:order-7 md:col-span-1 lg:col-span-4" products={inputs.products} href={report('productos', 'period=today')} />
      </>}
      <Registers className={`order-7 md:order-9 md:col-span-2 ${business ? 'lg:order-8 lg:col-span-4' : 'lg:col-span-6'}`} registers={activeRegisters} recon={inputs.recon?.status === 'ready' ? inputs.recon.value : null} today={today?.today ?? null} href={href('/cajas')} />
      {business && <Payments className="order-8 md:order-8 md:col-span-1 lg:order-9 lg:col-span-4" summary={inputs.summary} href={report('pagos', 'period=today')} />}
    </div>
    {!guideOnTop && <><ReadinessGuide data={data} readiness={readiness} collapsed /><StudentServiceNote data={data} /></>}
    {business && summary && <p className="text-xs text-slate-500">Ventas brutas del día de negocio ({summary.business_timezone}). Los reembolsos se muestran aparte, como en Reportes.</p>}
  </div>;
}

type Report = (report: string, query: string) => string;

function SectionState({ state, what }: { state: 'loading' | 'error'; what: string }) {
  return state === 'loading' ? <p className="hoy-muted" role="status">Cargando {what}…</p> : <p className="hoy-muted" role="alert">No pudimos cargar {what}. Intenta actualizar.</p>;
}

function LiveStrip({ className, open, today, loading }: { className: string; open: number; today: TodayRead | null; loading: boolean }) {
  const last = today?.data.last_sale;
  const lastText = !today ? (loading ? 'Revisando última venta…' : null) : !last ? 'Sin ventas registradas todavía'
    : last.business_date === today.today ? `Última venta ${clock(last.purchased_local)} · ${last.register_name}` : `Última venta: ${weekdayName(last.business_date)} ${last.business_date.slice(8, 10)}/${last.business_date.slice(5, 7)} ${clock(last.purchased_local)}`;
  return <div className={`hoy-live ${className}`} role="status" aria-label="Estado en vivo">
    <span className="hoy-live-item"><span className="hoy-dot" data-open={open > 0} aria-hidden />{open ? plural(open, 'caja abierta', 'cajas abiertas') : 'Ninguna caja abierta'}</span>
    {lastText && <span className="hoy-live-item">{lastText}</span>}
    {today && <span className="hoy-live-item text-slate-500">Actualizado {clock(today.as_of_local)}</span>}
  </div>;
}

function Hero({ className, inputs, report }: { className: string; inputs: TodayInputs; report: Report }) {
  const s = inputs.summary, t = inputs.today.status === 'ready' ? inputs.today.value : null;
  if (s.status !== 'ready') return <section className={`hoy-hero ${className}`} aria-labelledby="hoy-ventas"><p id="hoy-ventas" className="hoy-eyebrow">Ventas de hoy</p>
    <p className="mt-3 text-sm text-white/80" role={s.status === 'error' ? 'alert' : 'status'}>{s.status === 'loading' ? 'Cargando ventas…' : 'No pudimos cargar las ventas de hoy. Intenta actualizar.'}</p></section>;
  const d = s.value.data, c = t ? comparison(t) : { kind: 'none' as const };
  return <section className={`hoy-hero ${className}`} aria-labelledby="hoy-ventas">
    <p id="hoy-ventas" className="hoy-eyebrow">Ventas de hoy</p>
    <p className="num-display mt-1 break-words text-4xl sm:text-5xl"><TraceLink href={report('ventas', 'period=today')} label={`Ventas de hoy ${money(d.gross_sales_minor, s.value.currency_code)}: ver el reporte de ventas de hoy`}>{money(d.gross_sales_minor, s.value.currency_code)}</TraceLink></p>
    {d.transaction_count === 0 ? <p className="mt-2 text-sm text-white/85">Aún no hay ventas hoy. La primera venta aparecerá aquí.</p>
      : c.kind === 'delta' ? <p className="hoy-delta mt-2" data-direction={c.percent > 0 ? 'up' : c.percent < 0 ? 'down' : 'flat'}>
          {c.percent === 0 ? `Igual que el ${c.weekday} pasado a esta hora` : <><span aria-hidden>{c.percent > 0 ? '↑' : '↓'}</span><span className="sr-only">{c.percent > 0 ? 'Sube' : 'Baja'}</span> {`${Math.abs(c.percent)}% vs. ${c.weekday} pasado a esta hora`}</>}</p>
      : c.kind === 'reference' ? <p className="mt-2 text-sm text-white/85">El {c.weekday} pasado a esta hora: <span className="num">{money(c.baselineMinor, s.value.currency_code)}</span></p> : null}
    {d.refund_count > 0 && <p className="mt-3 text-xs text-white/75">{plural(d.refund_count, 'reembolso', 'reembolsos')} hoy · <span className="num">{money(d.refunds_minor, s.value.currency_code)}</span> · Netas <span className="num">{money(d.net_sales_minor, s.value.currency_code)}</span></p>}
  </section>;
}

function Kpis({ className, summary, report }: { className: string; summary: Loaded<SalesSummary>; report: Report }) {
  if (summary.status !== 'ready') return <div className={`hoy-panel ${className}`}><SectionState state={summary.status} what="los indicadores" /></div>;
  const d = summary.value.data, wallet = tenderShares(summary.value).find(x => x.tender === 'student_wallet')!;
  return <dl className={`hoy-kpis ${className}`}>
    <div><dt>Ventas</dt><dd className="num-display"><TraceLink href={report('ventas', 'period=today')} label={`${d.transaction_count} ventas hoy: ver el reporte de ventas de hoy`}>{d.transaction_count}</TraceLink></dd><dd className="hoy-kpi-help">{d.transaction_count === 1 ? 'transacción' : 'transacciones'}</dd></div>
    <div><dt>Ticket promedio</dt><dd className="num-display">{d.average_ticket_minor ? <TraceLink href={report('ventas', 'period=today')} label={`Ticket promedio ${money(d.average_ticket_minor, summary.value.currency_code)}: ver el reporte de ventas de hoy`}>{money(d.average_ticket_minor, summary.value.currency_code)}</TraceLink> : '—'}</dd><dd className="hoy-kpi-help">{d.average_ticket_minor ? 'por venta' : 'con la primera venta'}</dd></div>
    <div className="col-span-2 sm:col-span-1"><dt>Pagado con PIKAS Cash</dt><dd className="num-display">{d.transaction_count ? <TraceLink href={report('pagos', 'period=today')} label={`${percent(wallet.percent)} pagado con PIKAS Cash: ver métodos de pago de hoy`}>{percent(wallet.percent)}</TraceLink> : '—'}</dd><dd className="hoy-kpi-help">{d.transaction_count ? 'del total de hoy' : 'sin pagos todavía'}</dd></div>
  </dl>;
}

// Hourly gross for today (bars) with last week's same weekday as a dashed neutral line. The
// numbers are always available as text: a peak summary and a screen-reader table.
export function HourlyChart({ today }: { today: TodayRead }) {
  const hours = chartWindow(today), hasBaseline = today.data.baseline.day_count > 0, now = Number(today.as_of_local.slice(11, 13));
  const max = hours.reduce((m, h) => { const v = BigInt(h.today_gross_minor) > BigInt(h.baseline_gross_minor) || !hasBaseline ? BigInt(h.today_gross_minor) : BigInt(h.baseline_gross_minor); return v > m ? v : m; }, 0n);
  const pct = (minor: string) => max === 0n ? 0 : Number((BigInt(minor) * 1000n) / max) / 10;
  const peak = peakHour(today), weekday = weekdayName(today.baseline_date), cur = today.currency_code;
  if (today.data.today_count === 0 && !hasBaseline) return <div className="hoy-empty"><Image src="/brand/pikas-logo-mark-full-color.png" alt="" width={48} height={48} className="rounded-xl" /><div><p className="font-bold">Aún no hay ventas hoy.</p><p className="text-sm text-slate-600">La primera venta aparecerá aquí, hora por hora.</p></div></div>;
  return <figure className="m-0">
    <p className="text-sm text-slate-600">{peak ? <>Hora con más ventas: <b className="text-slate-900">{hourLabel(peak.hour)}</b> · <span className="num">{money(peak.today_gross_minor, cur)}</span></> : 'Aún no hay ventas hoy.'}</p>
    <div className="hoy-chart" aria-hidden>
      <div className="hoy-plot">
        {hours.map(h => <div key={h.hour} className="hoy-col-plot" title={`${hourLabel(h.hour)} · hoy ${money(h.today_gross_minor, cur)}${hasBaseline ? ` · ${weekday} pasado ${money(h.baseline_gross_minor, cur)}` : ''}`}>
          {h.today_count > 0 && <span className="hoy-bar" data-current={h.hour === now} style={{ height: `${Math.max(pct(h.today_gross_minor), 3)}%` }} />}
        </div>)}
        {/* Columns have no gap, so hour i is centred at (i + ½) / n; hours without sales sit on the baseline. */}
        {hasBaseline && <svg className="hoy-ref-line" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline fill="none" vectorEffect="non-scaling-stroke"
          points={hours.map((h, i) => `${((i + 0.5) / hours.length) * 100},${100 - pct(h.baseline_gross_minor)}`).join(' ')} /></svg>}
      </div>
      <div className="hoy-labels">{hours.map(h => <span key={h.hour} className="hoy-col-label" data-sparse={hours.length > 10 && h.hour % 2 === 1}>{h.hour}</span>)}</div>
    </div>
    <figcaption className="hoy-legend"><span><i className="hoy-key-bar" aria-hidden />Hoy por hora</span>{hasBaseline ? <span><i className="hoy-key-ref" aria-hidden />{`El ${weekday} pasado`}</span> : <span className="text-slate-500">La comparación aparecerá cuando haya ventas del {weekday} pasado.</span>}</figcaption>
    {/* sr-only on a wrapper: a <table> ignores the 1px width and would widen the page. */}
    <div className="sr-only"><table><caption>Ventas por hora de hoy{hasBaseline ? ` y del ${weekday} pasado` : ''}</caption><thead><tr><th scope="col">Hora</th><th scope="col">Hoy</th>{hasBaseline && <th scope="col">{`${weekday} pasado`}</th>}</tr></thead>
      <tbody>{hours.map(h => <tr key={h.hour}><th scope="row">{hourLabel(h.hour)}</th><td>{money(h.today_gross_minor, cur)} ({h.today_count})</td>{hasBaseline && <td>{money(h.baseline_gross_minor, cur)} ({h.baseline_count})</td>}</tr>)}</tbody></table></div>
  </figure>;
}

function Attention({ className, today, recon, href, closes }: { className: string; today: string | null; recon: Loaded<Reconciliation> | null; href: (p: string) => string; closes: string }) {
  const items = recon?.status === 'ready' && today ? attentionItems(today, recon.value, m => money(m, recon.value.currency_code)) : [];
  const calm = recon?.status === 'ready' && !!today && !items.length;
  return <section aria-labelledby="hoy-atencion" className={`${calm || !recon ? 'hoy-panel' : 'hoy-attention'} ${className}`}>
    <h2 id="hoy-atencion" className="hoy-h2">{calm ? 'Todo en orden' : 'Requiere atención'}</h2>
    {!recon ? <p className="hoy-muted">Las alertas de cierres y cajas requieren acceso al historial de cajas.</p>
      : recon.status !== 'ready' || !today ? <SectionState state={recon.status === 'ready' ? 'loading' : recon.status} what="el estado de las cajas" />
      : calm ? <p className="hoy-calm"><span aria-hidden>✓</span> Sin cierres con diferencias en los últimos 7 días ni cajas abiertas de días anteriores.</p>
      : <ul className="hoy-list">{items.slice(0, 5).map(i => <li key={i.id} data-tone={i.tone}><span>{i.text}</span><Link className="hoy-action" href={i.action === 'cajas' ? href('/cajas') : closes}>{i.action === 'cajas' ? 'Revisar caja' : 'Ver cierre'}</Link></li>)}
        {items.length > 5 && <li><span>{plural(items.length - 5, 'alerta más', 'alertas más')}</span><Link className="hoy-action" href={closes}>Ver todas</Link></li>}</ul>}
  </section>;
}

function TopProductsPanel({ className, products, href }: { className: string; products: Loaded<TopProducts>; href: string }) {
  const rows = products.status === 'ready' ? products.value.data.products.filter(p => p.net_units > 0).slice(0, 5) : [];
  const top = rows[0]?.net_units ?? 0;
  return <section aria-labelledby="hoy-productos" className={`hoy-panel ${className}`}>
    <div className="hoy-panel-head"><h2 id="hoy-productos" className="hoy-h2">Lo más vendido hoy</h2><Link className="hoy-action" href={href}>Reportes</Link></div>
    {products.status !== 'ready' ? <SectionState state={products.status} what="los productos" />
      : !rows.length ? <p className="hoy-muted">Los productos más vendidos aparecerán con las primeras ventas.</p>
      : <ol className="hoy-rank">{rows.map(p => <li key={p.product_id}><div className="flex items-baseline justify-between gap-3"><span className="min-w-0 break-words">{p.product_name}</span><b className="num shrink-0">{plural(p.net_units, 'ud.', 'uds.')}</b></div>
          <span className="hoy-rank-bar" aria-hidden><i style={{ width: `${(p.net_units / top) * 100}%` }} /></span></li>)}</ol>}
  </section>;
}

function Registers({ className, registers, recon, today, href }: { className: string; registers: CafeteriaRead['registers']; recon: Reconciliation | null; today: string | null; href: string }) {
  return <section aria-labelledby="hoy-cajas" className={`hoy-panel ${className}`}>
    <div className="hoy-panel-head"><h2 id="hoy-cajas" className="hoy-h2">Cajas ahora</h2><Link className="hoy-action" href={href}>Ver cajas</Link></div>
    {!registers.length ? <p className="hoy-muted">No hay cajas activas. Crea una caja para empezar a vender.</p> : <>
      {!registers.some(r => r.open) && <p className="hoy-muted mb-2">Ninguna caja abierta ahora. Las cajas se abren desde el POS.</p>}
      <ul className="hoy-list">{registers.map(r => { const s = recon?.data.open_sessions.find(x => x.register_id === r.id), stale = !!s && !!today && s.opened_local.slice(0, 10) < today;
        return <li key={r.id}><span className="min-w-0"><b>{r.name}</b> <span className="text-slate-500">· {r.code}</span>{s && <span className="block text-xs text-slate-600">{s.operator_name} · desde {stale ? `el ${weekdayName(s.opened_local)} ` : ''}{clock(s.opened_local)}</span>}</span>
          <span className="hoy-pill" data-state={r.open ? (stale ? 'stale' : 'open') : 'closed'}>{r.open ? (stale ? 'Abierta · revisar' : 'Abierta') : 'Cerrada'}</span></li>; })}</ul></>}
  </section>;
}

function Payments({ className, summary, href }: { className: string; summary: Loaded<SalesSummary>; href: string }) {
  const shares = summary.status === 'ready' ? tenderShares(summary.value) : [];
  const total = summary.status === 'ready' ? summary.value.data.transaction_count : 0;
  return <section aria-labelledby="hoy-pagos" className={`hoy-panel ${className}`}><div className="hoy-panel-head"><h2 id="hoy-pagos" className="hoy-h2">Cómo pagan</h2><Link className="hoy-action" href={href}>Ver métodos</Link></div>
    {summary.status !== 'ready' ? <SectionState state={summary.status} what="los medios de pago" /> : !total ? <p className="hoy-muted">Los medios de pago aparecerán con la primera venta.</p> : <>
      <div className="hoy-mix" aria-hidden>{shares.filter(s => s.percent > 0).map(s => <i key={s.tender} data-tender={s.tender} style={{ flexGrow: s.percent }} />)}</div>
      <ul className="hoy-mix-legend">{shares.map(s => <li key={s.tender}><span><i data-tender={s.tender} aria-hidden />{tenderLabel[s.tender]}</span><span className="num"><b>{percent(s.percent)}</b> · {money(s.gross_minor, summary.status === 'ready' ? summary.value.currency_code : 'DOP')}</span></li>)}</ul></>}
  </section>;
}

function Milestone({ name }: { name: string }) {
  return <div className="hoy-milestone" role="status"><Image src="/brand/pikas-logo-mark-full-color.png" alt="" width={48} height={48} className="rounded-xl" />
    <div><p className="font-display text-lg font-black">¡Primera venta con PIKAS!</p><p className="text-sm">{name} registró hoy su primera venta. Desde ahora, aquí verás cómo va cada día.</p></div></div>;
}
