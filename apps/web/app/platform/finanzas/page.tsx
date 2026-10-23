import Link from "next/link";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { AppPageHeader } from "../../../components/app-page-header";
import { DataList } from "../../../components/data-list";
import { EmptyState, ErrorState } from "../../../components/state-panels";
import { money } from "../../../lib/cafeteria/operations";
import { FINANCE_READ, customerLine, estadoToStatus, filtersSchema, financeWhen, listSchema, type FinanceListRow } from "../../../lib/platform/finance";
import { AmountBreakdown, FinanceReadFailure, FinanceStatusBadge, FinanceTabs } from "./finance-views";

// FIN 3: "What needs financial review right now?" Pending bank transfers first; recent decisions in
// Historial. Operational only (no analytics). Filters are validated before the read.
export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes(FINANCE_READ)) return <FinanceReadFailure kind="forbidden" />;
  const parsed = filtersSchema.safeParse(await searchParams);
  if (!parsed.success) return <ErrorState kind="validation" title="Los filtros no son válidos." description="La dirección trae filtros que no existen. Restablécelos para ver todas las solicitudes." action={<Link className="btn-secondary" href="/platform/finanzas">Restablecer filtros</Link>} />;
  const { vista, estado, q } = parsed.data, history = vista === "historial";
  const result = await readPlatform(session, FINANCE_READ, "platform_finance_replenishments_read",
    { p_view: history ? "history" : "pending", p_status: history && estado ? estadoToStatus[estado] : null, p_query: q || null }, listSchema);
  const filtered = !!(q || (history && estado));
  return <>
    <AppPageHeader title="Finanzas" description="Operaciones financieras de PIKAS Cash: transferencias bancarias por verificar y decisiones recientes." />
    <FinanceTabs current={vista} />
    <form action="/platform/finanzas" className="card flex flex-wrap items-end gap-4 p-5" role="search">
      {history && <input type="hidden" name="vista" value="historial" />}
      <label className="min-w-0 flex-1 basis-56">Referencia, cliente o estudiante<input className="field mt-1" name="q" defaultValue={q} maxLength={80} placeholder="REC-00000001" /></label>
      {history && <label className="min-w-0 flex-1 basis-40">Estado<select className="field mt-1" name="estado" defaultValue={estado}>
        <option value="">Todas</option><option value="verificadas">Verificadas</option><option value="rechazadas">Rechazadas</option><option value="revertidas">Revertidas</option></select></label>}
      <button className="btn">Buscar</button>{filtered && <Link className="btn-tertiary" href={history ? "/platform/finanzas?vista=historial" : "/platform/finanzas"}>Limpiar</Link>}
    </form>
    {result.kind !== "ready" ? <FinanceReadFailure kind={result.kind} />
      : result.value.requests.length === 0 ? (history
        ? <EmptyState title={filtered ? "No hay decisiones que coincidan con esta búsqueda." : "Todavía no hay decisiones registradas."} description="Aquí aparecen las transferencias verificadas, rechazadas y revertidas." />
        : <EmptyState title={filtered ? "No hay transferencias pendientes que coincidan." : "No hay transferencias pendientes de verificación."} description="Cuando una familia o un colegio registre una transferencia bancaria, aparecerá aquí para su revisión." />)
      : history ? <HistoryList rows={result.value.requests} /> : <PendingQueue rows={result.value.requests} />}
    {result.kind === "ready" && result.value.truncated && <p className="text-sm text-slate-600">Se muestran las 50 más {history ? "recientes" : "antiguas"}. Usa la búsqueda para encontrar una solicitud concreta.</p>}
  </>;
}

const student = (r: FinanceListRow) => `${r.student}${r.student_code ? ` · ${r.student_code}` : ""}`;

// Oldest first: each card leads to its review.
function PendingQueue({ rows }: { rows: FinanceListRow[] }) {
  return <section aria-labelledby="pendientes" className="space-y-3">
    <h2 id="pendientes" className="text-lg font-bold">Transferencias por verificar <span className="text-slate-500">({rows.length})</span></h2>
    <ul className="grid gap-3 lg:grid-cols-2">{rows.map(r => <li key={r.reference} className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-base font-bold">{r.reference}</span><FinanceStatusBadge status={r.status} /></div>
      <div className="min-w-0 break-words"><p className="font-bold">{student(r)}</p><p className="text-sm text-slate-600">{customerLine(r.customer, r.school)}</p></div>
      <AmountBreakdown gross={r.gross_minor} fee={r.fee_minor} net={r.net_minor} compact />
      <p className="text-sm text-slate-600">Enviada {financeWhen(r.submitted_at)}{r.payer_reference ? <> · Ref. bancaria <span className="font-mono">{r.payer_reference}</span></> : null} · {r.has_proof ? "Con referencia de comprobante" : "Sin referencia de comprobante"}</p>
      <Link className="btn w-full sm:w-auto" href={`/platform/finanzas/${r.reference}`} aria-label={`Revisar ${r.reference} de ${r.student}`}>Revisar</Link>
    </li>)}</ul>
  </section>;
}

function HistoryList({ rows }: { rows: FinanceListRow[] }) {
  const decision = (r: FinanceListRow) => r.status === "reversed" && r.reversed_at ? `Revertida ${financeWhen(r.reversed_at)}${r.reversed_by ? ` por ${r.reversed_by}` : ""}`
    : r.decided_at ? `${r.status === "rejected" ? "Rechazada" : "Verificada"} ${financeWhen(r.decided_at)}${r.decided_by ? ` por ${r.decided_by}` : ""}` : "—";
  return <DataList label="Historial de transferencias" rows={rows} rowKey={r => r.reference} columns={[
    { header: "Referencia", primary: true, cell: r => <Link className="whitespace-nowrap font-mono underline-offset-2 hover:underline" href={`/platform/finanzas/${r.reference}`}>{r.reference}</Link> },
    { header: "Estado", cell: r => <FinanceStatusBadge status={r.status} /> },
    { header: "Estudiante", cell: r => <span className="break-words">{student(r)}<span className="block text-slate-600">{customerLine(r.customer, r.school)}</span></span> },
    { header: "Pagado", align: "end", cell: r => <span className="whitespace-nowrap tabular-nums">{money(r.gross_minor)}</span> },
    { header: "Acreditado", align: "end", cell: r => <span className="whitespace-nowrap tabular-nums">{r.status === "rejected" ? "—" : money(r.net_minor)}</span> },
    { header: "Decisión", cell: r => decision(r) },
  ]} />;
}
