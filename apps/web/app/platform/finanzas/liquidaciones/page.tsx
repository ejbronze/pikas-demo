import { createHash } from "node:crypto";
import Link from "next/link";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { AppPageHeader } from "../../../../components/app-page-header";
import { DataList } from "../../../../components/data-list";
import { EmptyState, ErrorState } from "../../../../components/state-panels";
import { SettlementBadge, SettlementTotals } from "../../../../components/settlement-views";
import { money } from "../../../../lib/cafeteria/operations";
import { FINANCE_READ, customerLine } from "../../../../lib/platform/finance";
import { SETTLEMENT_MANAGE, dueLabel, platformDirection, settlementFiltersSchema, settlementListSchema, weekLabel, type ReadyRow, type SettlementRow } from "../../../../lib/platform/settlements";
import { FinanceReadFailure, FinanceTabs } from "../finance-views";
import { RunSettlements } from "./settlement-actions";

// Weekly Cafetería settlements (Monday–Sunday, America/Santo_Domingo; due the following Tuesday). The queue answers
// "which periods need finance action?": ended weeks ready to calculate, and settlements awaiting payment or in review.
export default async function SettlementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes(FINANCE_READ)) return <FinanceReadFailure kind="forbidden" />;
  const parsed = settlementFiltersSchema.safeParse(await searchParams);
  if (!parsed.success) return <ErrorState kind="validation" title="Los filtros no son válidos." description="La dirección trae filtros que no existen. Restablécelos para ver las liquidaciones." action={<Link className="btn-secondary" href="/platform/finanzas/liquidaciones">Restablecer filtros</Link>} />;
  const { vista, q } = parsed.data, history = vista === "historial";
  const result = await readPlatform(session, FINANCE_READ, "platform_finance_settlements_read", { p_view: history ? "history" : "action", p_query: q || null }, settlementListSchema);
  const canManage = session.capabilities.includes(SETTLEMENT_MANAGE);
  const actor = createHash("sha256").update(`settlement:${session.identity.person.id}`).digest("hex").slice(0, 24);
  return <>
    <AppPageHeader title="Finanzas" description="Liquidaciones semanales con cada cafetería: lo que la cafetería recibió en efectivo para PIKAS Cash frente a lo que sus estudiantes pagaron con PIKAS Cash." />
    <FinanceTabs current="liquidaciones" />
    <p className="text-sm text-slate-600">La liquidación registra y concilia lo que cada parte debe. No mueve dinero por sí sola: los pagos se hacen fuera de PIKAS y aquí se confirman con su referencia.</p>
    <nav aria-label="Vistas de liquidaciones" className="flex flex-wrap gap-2">
      {([["accion", "Requieren acción", "/platform/finanzas/liquidaciones"], ["historial", "Historial", "/platform/finanzas/liquidaciones?vista=historial"]] as const).map(([key, label, href]) =>
        <Link key={key} href={href} aria-current={vista === key ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-bold ${vista === key ? "border-slate-900 bg-white" : "text-slate-600"}`}>{label}</Link>)}
    </nav>
    <form action="/platform/finanzas/liquidaciones" className="card flex flex-wrap items-end gap-4 p-5" role="search">
      {history && <input type="hidden" name="vista" value="historial" />}
      <label className="min-w-0 flex-1 basis-56">Referencia, cafetería o cliente<input className="field mt-1" name="q" defaultValue={q} maxLength={80} placeholder="LIQ-00000001" /></label>
      <button className="btn">Buscar</button>{q && <Link className="btn-tertiary" href={history ? "/platform/finanzas/liquidaciones?vista=historial" : "/platform/finanzas/liquidaciones"}>Limpiar</Link>}
    </form>
    {result.kind !== "ready" ? <FinanceReadFailure kind={result.kind} /> : history
      ? (result.value.settlements.length ? <HistoryList rows={result.value.settlements} /> : <EmptyState title={q ? "No hay liquidaciones que coincidan." : "Todavía no hay liquidaciones."} description="Cuando una semana se liquide, aparecerá aquí con su estado y su pago." />)
      : <>
        <section aria-labelledby="por-liquidar" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="por-liquidar" className="text-lg font-bold">Semanas cerradas por liquidar <span className="text-slate-500">({result.value.ready.length})</span></h2>
            {canManage && result.value.ready.length > 0 && <RunSettlements actor={actor} count={result.value.ready.length} />}</div>
          {result.value.ready.length ? <ul className="grid gap-3 lg:grid-cols-2">{result.value.ready.map(r => <ReadyCard key={`${r.cafeteria_id}:${r.week_start}`} row={r} />)}</ul>
            : <p className="card p-5 text-sm">No hay semanas cerradas pendientes de liquidar. Cada lunes, la semana anterior queda lista para calcularse.</p>}
        </section>
        <section aria-labelledby="por-cobrar" className="space-y-3">
          <h2 id="por-cobrar" className="text-lg font-bold">Pendientes de pago o en revisión <span className="text-slate-500">({result.value.settlements.length})</span></h2>
          {result.value.settlements.length ? <ul className="grid gap-3 lg:grid-cols-2">{result.value.settlements.map(s => <SettlementCard key={s.reference} row={s} />)}</ul>
            : <EmptyState title="No hay liquidaciones pendientes." description="Las liquidaciones calculadas que esperan un pago o una revisión aparecen aquí." />}
        </section>
      </>}
    {result.kind === "ready" && result.value.truncated && <p className="text-sm text-slate-600">Se muestran 50. Usa la búsqueda para encontrar una liquidación concreta.</p>}
  </>;
}

function ReadyCard({ row }: { row: ReadyRow }) {
  return <li className="card space-y-3 p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">{weekLabel(row.week_start, row.week_end)}</span><SettlementBadge status="ready" /></div>
    <div className="min-w-0 break-words"><p className="font-bold">{row.cafeteria}</p><p className="text-sm text-slate-600">{customerLine(row.customer, row.school)}</p></div>
    <SettlementTotals owes={row.cafeteria_owes_minor} owed={row.clearing_owes_minor} direction={row.net_direction} net={row.net_amount_minor} audience="platform" compact />
    <p className="text-sm text-slate-600">{row.line_count} movimientos{row.late_line_count ? ` · ${row.late_line_count} de semanas anteriores` : ""} · vence el {dueLabel(row.due_on)}</p>
    <Link className="btn-secondary w-full sm:w-auto" href={`/platform/finanzas/liquidaciones/semana?cafeteria=${row.cafeteria_id}&semana=${row.week_start}`} aria-label={`Revisar ${weekLabel(row.week_start, row.week_end)} de ${row.cafeteria}`}>Revisar movimientos</Link>
  </li>;
}

function SettlementCard({ row }: { row: SettlementRow }) {
  return <li className="card space-y-3 p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-base font-bold">{row.reference}</span><span className="flex flex-wrap gap-2"><SettlementBadge status={row.status} />{row.overdue && <span className="chip bg-red-100 text-red-900">Vencida</span>}</span></div>
    <div className="min-w-0 break-words"><p className="font-bold">{row.cafeteria} · {weekLabel(row.week_start, row.week_end)}</p><p className="text-sm text-slate-600">{customerLine(row.customer, row.school)} · vence el {dueLabel(row.due_on)}</p></div>
    <SettlementTotals owes={row.cafeteria_owes_minor} owed={row.clearing_owes_minor} direction={row.net_direction} net={row.net_amount_minor} audience="platform" compact />
    <Link className="btn w-full sm:w-auto" href={`/platform/finanzas/liquidaciones/${row.reference}`} aria-label={`Abrir ${row.reference} de ${row.cafeteria}`}>Abrir liquidación</Link>
  </li>;
}

function HistoryList({ rows }: { rows: SettlementRow[] }) {
  return <DataList label="Historial de liquidaciones" rows={rows} rowKey={r => r.reference} columns={[
    { header: "Referencia", primary: true, cell: r => <Link className="whitespace-nowrap font-mono underline-offset-2 hover:underline" href={`/platform/finanzas/liquidaciones/${r.reference}`}>{r.reference}</Link> },
    { header: "Estado", cell: r => <SettlementBadge status={r.status} /> },
    { header: "Cafetería", cell: r => <span className="break-words">{r.cafeteria}<span className="block text-slate-600">{weekLabel(r.week_start, r.week_end)} · {customerLine(r.customer, r.school)}</span></span> },
    { header: "Resultado", cell: r => <span className="break-words">{platformDirection[r.net_direction]}</span> },
    { header: "Neto", align: "end", cell: r => <span className="whitespace-nowrap tabular-nums font-bold">{money(r.net_amount_minor)}</span> },
  ]} />;
}
