import Link from "next/link";
import { BarChart3, ChevronRight, CreditCard, PackageSearch, Wallet } from "lucide-react";
import { BarList, ReportSummary, ReportTable } from "./report-frame";
import { MoneyValue } from "./money-value";
import { HourlyChart } from "./cafeteria-today";
import { money } from "../lib/cafeteria/operations";
import { tenderShares, type TodayRead } from "../lib/cafeteria/today";
import { refundStatusLabel, tenderLabel } from "../lib/cafeteria/transactions";
import { closeStatusLabel, paymentOf, payments, type Payment, type SalesPage } from "../lib/cafeteria/sales-reports";
import { reportHref } from "../lib/reports/filters";
import type { PeriodFilter } from "../lib/reports/filters";
import type { Reconciliation, SalesSummary, TopProducts } from "../lib/cafeteria/reports";

// PIKAS UX 9 Cafetería Reportes. Presentation of data each page already read on the server under the
// Cafetería's authority. Cafetería sees its business: sales, payment methods, products and cajas.
export const cafeteriaReportPath = (report = "") => `/admin/cafeteria/reportes${report && `/${report}`}`;
const n = (k: number, one: string, many: string) => `${k.toLocaleString("es-DO")} ${k === 1 ? one : many}`;
const pct = (v: number) => `${v.toLocaleString("es-DO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const neg = (minor: string) => minor === "0" ? "0" : `-${minor}`;
const periodKeep = (p: PeriodFilter) => ({ period: p.period, from: p.from, to: p.to });

// Landing: what do you want to analyze? Only reports this role can open are listed.
export function CafeteriaReportsIndex({ cafeteriaId, name, sessions, settlements = false }: { cafeteriaId: string; name: string; sessions: boolean; settlements?: boolean }) {
  const reports = [
    { report: "ventas", icon: BarChart3, name: "Ventas", purpose: "Ventas brutas, transacciones, ticket promedio, reembolsos y el detalle de cada venta." },
    { report: "pagos", icon: CreditCard, name: "Métodos de pago", purpose: "Cómo pagaron: efectivo, PIKAS Cash y crédito de personal." },
    { report: "productos", icon: PackageSearch, name: "Productos", purpose: "Lo que más se vendió en unidades en el período." },
    ...(sessions ? [{ report: "cajas", icon: Wallet, name: "Cajas y cierres", purpose: "Cajas abiertas, cierres del período y su conciliación de efectivo." }] : []),
  ];
  return <div className="space-y-5">
    <header className="min-w-0"><h1 className="font-display text-3xl font-black text-[var(--primary)]">Reportes</h1>
      <p className="break-words text-slate-600">{name} · ¿qué quieres analizar?</p></header>
    <ul className="rpt-index" aria-label="Reportes de la cafetería">{reports.map(r => <li key={r.report}>
      <Link href={`${cafeteriaReportPath(r.report)}?cafeteria=${cafeteriaId}`}><r.icon aria-hidden size={22} className="rpt-index-icon" />
        <span className="min-w-0 flex-1"><span className="rpt-index-name">{r.name}</span><span className="rpt-index-purpose">{r.purpose}</span></span>
        <ChevronRight aria-hidden size={20} className="shrink-0 text-slate-400" /></Link></li>)}</ul>
    {settlements && <p className="text-sm text-slate-600">Lo que debes a PIKAS o PIKAS te debe cada semana está en <Link className="font-bold underline" href={`/admin/cafeteria/liquidaciones?cafeteria=${cafeteriaId}`}>Liquidaciones</Link>.</p>}
    <p className="text-sm text-slate-600">Cada reporte muestra solo esta cafetería, se puede imprimir y exportar en CSV con los filtros aplicados. Para buscar una venta concreta usa Transacciones.</p>
  </div>;
}

// Ventas: the period's sales. Summary from the 5D sales summary; detail from the 5D.4 sales list with the
// same period (and payment), so the list count equals the summary's transactions.
export function SalesReportBody({ cafeteriaId, period, payment, summary: s, sales, today, page }: { cafeteriaId: string; period: PeriodFilter; payment: Payment | null; summary: SalesSummary; sales: SalesPage; today: TodayRead | null; page: number }) {
  const d = s.data, cur = s.currency_code, path = cafeteriaReportPath("ventas"), keep = { cafeteria: cafeteriaId, ...periodKeep(period) };
  const tender = payment ? d.tenders.find(t => t.tender === payments[payment])! : null, share = payment ? tenderShares(s).find(x => x.tender === payments[payment])! : null;
  const pages = Math.max(1, Math.ceil(sales.total / sales.page_size)), shown = sales.rows.length;
  return <div className="space-y-5">
    <nav aria-label="Método de pago" className="stu-chips" data-print="hide">
      <Link className="stu-chip" aria-current={!payment ? "page" : undefined} href={reportHref(path, keep)}>Todos</Link>
      {d.tenders.filter(t => t.tender !== "staff_credit" || t.transaction_count > 0 || payment === "staff_credit").map(t => <Link key={t.tender} className="stu-chip" aria-current={payment === paymentOf(t.tender) ? "page" : undefined}
        href={reportHref(path, { ...keep, payment: paymentOf(t.tender) })}>{tenderLabel[t.tender]}</Link>)}
    </nav>
    {tender && share ? <ReportSummary label="Resumen de ventas" items={[
      { label: "Ventas brutas", value: <MoneyValue minor={tender.gross_sales_minor} intent="amount" />, help: `${pct(share.percent)} de las ventas del período` },
      { label: "Transacciones", value: tender.transaction_count.toLocaleString("es-DO"), help: `pagadas con ${tenderLabel[tender.tender]}` },
    ]} /> : <ReportSummary label="Resumen de ventas" items={[
      { label: "Ventas brutas", value: <MoneyValue minor={d.gross_sales_minor} intent="amount" />, help: "antes de reembolsos" },
      { label: "Transacciones", value: d.transaction_count.toLocaleString("es-DO"), help: "una venta reembolsada sigue contando" },
      { label: "Ticket promedio", value: d.average_ticket_minor === null ? "—" : <MoneyValue minor={d.average_ticket_minor} intent="amount" />, help: "ventas brutas ÷ transacciones" },
      { label: "Ventas netas", value: <MoneyValue minor={d.net_sales_minor} intent="balance" />, help: d.refund_count ? `${n(d.refund_count, "reembolso", "reembolsos")} · ${money(neg(d.refunds_minor), cur)}` : "sin reembolsos en el período" },
    ]} />}
    {!payment && d.refund_count > 0 && <p className="rpt-help">Reembolsos por la fecha del reembolso: efectivo {money(neg(d.refunds_by_tender.cash), cur)} · PIKAS Cash {money(neg(d.refunds_by_tender.student_wallet), cur)}. Ventas netas = brutas − reembolsos; puede ser negativa si se reembolsan ventas de otro período.</p>}
    {period.period === "today" && !payment && today && today.today === s.from ? <section aria-labelledby="rpt-hours" className="sch-panel space-y-2">
      <h2 id="rpt-hours" className="sch-h2">Ventas por hora</h2>
      <HourlyChart today={today} />
    </section> : <p className="rpt-help" data-print="hide">La gráfica por hora está disponible para Hoy{payment ? " sin filtro de método de pago" : ""}; para otros períodos PIKAS registra totales del período, no una serie diaria.</p>}
    <section aria-labelledby="rpt-sales" className="space-y-3">
      <h2 id="rpt-sales" className="sch-h2">{n(sales.total, "venta", "ventas")}{payment ? ` con ${tenderLabel[payments[payment]]}` : ""}</h2>
      {sales.total === 0 ? <p className="sch-panel text-sm text-slate-600">Sin ventas en este período{payment ? " con este método de pago" : ""}.</p> : <>
        <ReportTable label="Ventas del período" rows={sales.rows} rowKey={r => r.receipt} columns={[
          { header: "Recibo", primary: true, nowrap: true, cell: r => `#${r.receipt}` },
          { header: "Fecha", nowrap: true, cell: r => r.date.split("-").reverse().join("/") },
          { header: "Hora", nowrap: true, cell: r => r.time },
          { header: "Caja", nowrap: true, cell: r => r.register },
          { header: "Operador", cell: r => r.operator },
          { header: "Método", nowrap: true, cell: r => tenderLabel[r.tender] },
          { header: "Total", align: "end", cell: r => <MoneyValue minor={r.total_minor} intent="amount" /> },
          { header: "Reembolso", cell: r => r.refund_status === "none" ? "—" : `${refundStatusLabel[r.refund_status]} · ${money(neg(r.refunded_minor), cur)}` },
        ]} />
        <div className="flex flex-wrap items-center gap-3" data-print="hide"><span className="rpt-help">{`Ventas ${sales.offset + 1}–${sales.offset + shown} de ${sales.total.toLocaleString("es-DO")} · página ${page} de ${pages}`}</span>
          {page > 1 && <Link className="btn-secondary" href={reportHref(path, { ...keep, payment, page: String(page - 1) })}>Anterior</Link>}
          {page < pages && <Link className="btn-secondary" href={reportHref(path, { ...keep, payment, page: String(page + 1) })}>Siguiente</Link>}</div>
        {pages > 1 && <p className="rpt-help">La impresión incluye la página visible; el CSV incluye todas las ventas del filtro.</p>}
      </>}
    </section>
  </div>;
}

// Métodos de pago: the period's sales per payment method, from the same 5D sales summary.
export function PaymentsReportBody({ cafeteriaId, period, summary: s }: { cafeteriaId: string; period: PeriodFilter; summary: SalesSummary }) {
  const d = s.data, cur = s.currency_code, shares = tenderShares(s).filter(t => t.tender !== "staff_credit" || t.count > 0);
  const sales = (t: (typeof shares)[number]["tender"]) => reportHref(cafeteriaReportPath("ventas"), { cafeteria: cafeteriaId, ...periodKeep(period), payment: paymentOf(t) });
  if (d.transaction_count === 0 && d.refund_count === 0) return <p className="sch-panel text-sm text-slate-600">Sin ventas ni reembolsos en este período.</p>;
  return <div className="space-y-5">
    <ReportSummary label="Resumen de métodos de pago" items={[
      { label: "Ventas brutas", value: <MoneyValue minor={d.gross_sales_minor} intent="amount" />, help: n(d.transaction_count, "transacción", "transacciones") },
      ...shares.filter(t => t.tender !== "staff_credit").map(t => ({ label: `Con ${tenderLabel[t.tender]}`, value: pct(t.percent), help: "de las ventas brutas" })),
    ]} />
    {d.transaction_count > 0 && <section aria-labelledby="rpt-mix" className="sch-panel space-y-3">
      <h2 id="rpt-mix" className="sch-h2">Ventas por método de pago</h2>
      <p className="rpt-help">Ventas brutas del período por método de la compra. Elige un método para ver sus ventas.</p>
      <BarList label="Ventas por método de pago" items={shares.map(t => ({ key: t.tender, label: tenderLabel[t.tender], count: Number(t.gross_minor), value: `${money(t.gross_minor, cur)} · ${pct(t.percent)}`, href: t.count ? sales(t.tender) : undefined }))} />
    </section>}
    <ReportTable label="Métodos de pago" rows={shares} rowKey={t => t.tender} columns={[
      { header: "Método", primary: true, cell: t => t.count ? <Link className="rpt-record" href={sales(t.tender)}>{tenderLabel[t.tender]}</Link> : tenderLabel[t.tender] },
      { header: "Transacciones", align: "end", cell: t => t.count.toLocaleString("es-DO") },
      { header: "Ventas brutas", align: "end", cell: t => <MoneyValue minor={t.gross_minor} intent="amount" /> },
      { header: "Participación", align: "end", cell: t => pct(t.percent) },
      { header: "Reembolsos", align: "end", cell: t => t.tender === "staff_credit" ? "—" : <MoneyValue minor={neg(d.refunds_by_tender[t.tender])} intent="movement" /> },
    ]} foot={<tr><th scope="row">Total</th><td data-align="end">{d.transaction_count.toLocaleString("es-DO")}</td><td data-align="end"><MoneyValue minor={d.gross_sales_minor} intent="amount" /></td><td data-align="end">100%</td><td data-align="end"><MoneyValue minor={neg(d.refunds_minor)} intent="movement" /></td></tr>} />
    <p className="rpt-help">Los reembolsos se cuentan por la fecha del reembolso. Las recargas y ajustes de PIKAS Cash no son ventas.</p>
  </div>;
}

// Productos: top products by net units (5D.2: up to 10, units only — the read carries no amounts).
export function ProductsReportBody({ report: r }: { report: TopProducts }) {
  const d = r.data;
  if (!d.products.length) return <p className="sch-panel text-sm text-slate-600">Sin ventas ni reembolsos de productos en este período.</p>;
  const ranked = d.products.filter(p => p.net_units > 0);
  return <div className="space-y-5">
    <ReportSummary label="Resumen de productos" items={[
      { label: "Productos con actividad", value: d.product_count.toLocaleString("es-DO"), help: d.product_count > d.products.length ? `se muestran los ${d.products.length} principales` : "todos se muestran abajo" },
      { label: "Unidades netas", value: d.products.reduce((a, p) => a + p.net_units, 0).toLocaleString("es-DO"), help: d.product_count > d.products.length ? "de los productos mostrados" : "vendidas − reembolsadas" },
    ]} />
    {ranked.length > 1 && <section aria-labelledby="rpt-top" className="sch-panel space-y-3">
      <h2 id="rpt-top" className="sch-h2">Productos por unidades netas</h2>
      <BarList label="Productos por unidades netas" unit={["unidad", "unidades"]} items={ranked.map(p => ({ key: p.product_id, label: p.product_name, count: p.net_units }))} />
    </section>}
    <ReportTable label="Productos del período" rows={d.products} rowKey={p => p.product_id} columns={[
      { header: "Producto", primary: true, cell: p => <span><span className="rpt-help">{p.rank}. </span>{p.product_name}</span> },
      { header: "Vendidas", align: "end", cell: p => p.gross_units.toLocaleString("es-DO") },
      { header: "Reembolsadas", align: "end", cell: p => p.refunded_units.toLocaleString("es-DO") },
      { header: "Netas", align: "end", cell: p => p.net_units.toLocaleString("es-DO") },
    ]} />
    <p className="rpt-help">Unidades netas = vendidas − reembolsadas, por la fecha de cada evento. Es actividad del período, no inventario.{d.refunds_without_item_detail > 0 ? ` ${n(d.refunds_without_item_detail, "reembolso", "reembolsos")} sin detalle por producto.` : ""}</p>
  </div>;
}

// Cajas y cierres: open sessions now and the period's closes with the Phase 5A cash capture.
export function CajasReportBody({ cafeteriaId, report: r }: { cafeteriaId: string; report: Reconciliation }) {
  const d = r.data, s = d.summary, cur = r.currency_code, signed = (v: string | null) => v === null ? "—" : money(v, cur);
  return <div className="space-y-5">
    <ReportSummary label="Resumen de cierres" items={[
      { label: "Cierres", value: s.closed_count.toLocaleString("es-DO"), help: `${n(d.open_sessions.length, "caja abierta", "cajas abiertas")} ahora` },
      { label: "Cuadrados", value: s.balanced_count.toLocaleString("es-DO") },
      { label: "Con diferencia", value: (s.shortage_count + s.overage_count).toLocaleString("es-DO"), help: `${n(s.shortage_count, "faltante", "faltantes")} · ${n(s.overage_count, "sobrante", "sobrantes")}` },
      { label: "Sin conteo", value: s.uncaptured_count.toLocaleString("es-DO"), help: "cierres anteriores al conteo de efectivo" },
    ]} />
    <section aria-labelledby="rpt-open" className="space-y-3">
      <h2 id="rpt-open" className="sch-h2">Cajas abiertas ahora</h2>
      {!d.open_sessions.length ? <p className="sch-panel text-sm text-slate-600">Ninguna caja abierta.</p>
        : <ReportTable label="Cajas abiertas" rows={d.open_sessions} rowKey={o => o.session_id} columns={[
          { header: "Caja", primary: true, cell: o => `${o.register_name} · ${o.register_code}` },
          { header: "Operador", cell: o => o.operator_name },
          { header: "Abierta desde", cell: o => o.opened_local.replace("T", " ") },
          { header: "Efectivo esperado", align: "end", cell: o => money(o.expected_minor, cur) },
        ]} />}
    </section>
    <section aria-labelledby="rpt-closed" className="space-y-3">
      <h2 id="rpt-closed" className="sch-h2">Cierres del período</h2>
      {!d.closed_sessions.length ? <p className="sch-panel text-sm text-slate-600">Sin cierres en este período.</p> : <>
        <ReportTable label="Cierres del período" rows={d.closed_sessions} rowKey={c => c.session_id} columns={[
          { header: "Caja", primary: true, cell: c => `${c.register_name} · ${c.register_code}` },
          { header: "Operador", cell: c => c.operator_name },
          { header: "Cerrada", cell: c => `${c.closed_local.replace("T", " ")}${c.close_type === "exceptional" ? " · excepcional" : ""}` },
          { header: "Esperado", align: "end", cell: c => signed(c.expected_minor) },
          { header: "Contado", align: "end", cell: c => money(c.counted_minor, cur) },
          { header: "Diferencia", align: "end", cell: c => c.difference_minor === null ? "—" : <MoneyValue minor={c.difference_minor} intent="balance" /> },
          { header: "Resultado", cell: c => closeStatusLabel[c.status] },
        ]} />
        {s.closed_count > d.closed_sessions.length && <p className="rpt-help">Se muestran los {d.closed_sessions.length} cierres más recientes de {s.closed_count}. Acota el período para ver el resto.</p>}
      </>}
      <p className="rpt-help">Diferencia = contado − esperado, registrada al cerrar la caja. <Link className="rpt-record" data-print="hide" href={`/admin/cafeteria/cajas?cafeteria=${cafeteriaId}`}>Administrar cajas</Link></p>
    </section>
  </div>;
}
