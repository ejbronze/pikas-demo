import { createHash } from "node:crypto";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { AppPageHeader } from "../../../../components/app-page-header";
import { money } from "../../../../lib/cafeteria/operations";
import { FINANCE_READ, FINANCE_REVERSE, FINANCE_VERIFY, customerLine, detailSchema, financeWhen, methodLabel, reversalReasonLabel, submittedRoleLabel, type FinanceDetail } from "../../../../lib/platform/finance";
import { AmountBreakdown, FinanceReadFailure, FinanceStatusBadge } from "../finance-views";
import { FinanceActions } from "./finance-actions";

// One bank transfer, reviewed before any decision: who receives the credit, gross → fee → net, the
// manual evidence, and what has been decided. Actions appear only with their own capability.
export default async function FinanceRequestPage({ params }: { params: Promise<{ reference: string }> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes(FINANCE_READ)) return <FinanceReadFailure kind="forbidden" />;
  const { reference } = await params;
  if (!/^REC-[0-9]{8}$/.test(reference)) return <FinanceReadFailure kind="missing" />;
  const result = await readPlatform(session, FINANCE_READ, "platform_finance_replenishment_detail", { p_reference: reference }, detailSchema);
  if (result.kind !== "ready") return <FinanceReadFailure kind={result.kind} />;
  const d = result.value;
  // Scopes the browser's recovery journal to this operator without exposing an identifier.
  const actor = createHash("sha256").update(`finance:${session.identity.person.id}`).digest("hex").slice(0, 24);
  return <>
    <AppPageHeader back={{ href: d.status === "pending" ? "/platform/finanzas" : "/platform/finanzas?vista=historial", label: "Finanzas" }}
      title={<span className="font-mono">{d.reference}</span>}
      meta={<span className="flex flex-wrap items-center gap-2"><FinanceStatusBadge status={d.status} method={d.method} /><span>{methodLabel(d.method, d.cafeteria)} · {customerLine(d.customer, d.school)}</span></span>} />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="min-w-0 space-y-5">
        <Section title="Montos"><AmountBreakdown gross={d.gross_minor} fee={d.fee_minor} net={d.net_minor} feeBps={d.fee_bps} credited={d.status === "posted" || d.status === "reversed"} cash={d.method === "cafeteria_cash"} />
          <p className="text-sm text-slate-600">El cargo PIKAS se aplica solo a recargas. Las compras con PIKAS Cash no tienen cargo.</p></Section>
        <Section title="Quién recibe el crédito"><Rows rows={[["Estudiante", `${d.student}${d.student_code ? ` · ${d.student_code}` : ""}`], ...(d.customer === d.school ? [["Colegio", d.school] as [string, string]] : [["Colegio", d.school], ["Cliente", d.customer]] as [string, string][]),
          ["Monedero", `PIKAS Cash en ${d.currency === "DOP" ? "pesos dominicanos (RD$)" : d.currency}`], ["Política", `Versión ${d.policy_version} · cargo de ${d.fee_bps / 100} %`]]} /></Section>
        {d.method === "cafeteria_cash" ? <Section title="Efectivo recibido en la cafetería">
          <p className="rounded-xl bg-slate-50 p-3 text-sm">La cafetería recibió el efectivo y la recarga se acreditó al registrarla. La cafetería debe a la compensación el efectivo recibido; ese monto entra en su liquidación semanal (Liquidaciones).</p>
          <Rows rows={[["Cafetería", d.cafeteria ?? "—"], ["Recibido por", d.submitted_by ?? "—"], ["Entregado por", d.payer_name ?? "No registrado"], ["Fecha", financeWhen(d.posted_at ?? d.submitted_at)]]} />
        </Section> : <Section title="Evidencia de la transferencia">
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">PIKAS no confirma transacciones bancarias automáticamente. Comprueba el depósito en el banco antes de decidir.</p>
          <Rows rows={[["Referencia bancaria", d.payer_reference ?? "No registrada"], ["Pagador", d.payer_name ?? "No registrado"], ["Nota del pagador", d.payer_note ?? "Sin nota"],
            ["Comprobante", d.proof_reference ?? "No se registró referencia de comprobante"],
            ["Enviada", `${financeWhen(d.submitted_at)}${d.submitted_by ? ` por ${d.submitted_by}` : ""} (${submittedRoleLabel[d.submitted_role] ?? d.submitted_role})`]]} />
        </Section>}
        {d.status !== "pending" && <Section title="Decisión"><Rows rows={decisionRows(d)} /></Section>}
      </div>
      <aside className="min-w-0 space-y-5" aria-label="Acciones financieras">
        {!d.customer_activated && d.status === "pending" && <p role="status" className="card p-4 text-sm">El modelo financiero de PIKAS Cash no está activo para este cliente. No se puede verificar.</p>}
        <FinanceActions actor={actor} detail={d} canVerify={session.capabilities.includes(FINANCE_VERIFY)} canReverse={session.capabilities.includes(FINANCE_REVERSE)} />
      </aside>
    </div>
  </>;
}

function decisionRows(d: FinanceDetail): [string, string][] {
  const rows: [string, string][] = [];
  if (d.status === "rejected") rows.push(["Rechazada", `${d.decided_at ? financeWhen(d.decided_at) : "—"}${d.decided_by ? ` por ${d.decided_by}` : ""}`], ["Motivo del rechazo", d.rejection_reason ?? "—"], ["Efecto", "Sin crédito, sin cargo y sin recarga"]);
  else if (d.method === "cafeteria_cash") rows.push(["Acreditada", `${d.posted_at ? financeWhen(d.posted_at) : "—"}${d.submitted_by ? ` al recibirla ${d.submitted_by}` : ""}`], ["Acreditado", money(d.net_minor)]);
  else rows.push(["Verificada", `${d.decided_at ? financeWhen(d.decided_at) : "—"}${d.decided_by ? ` por ${d.decided_by}` : ""}`], ["Acreditado", money(d.net_minor)]);
  if (d.reversal) rows.push(["Revertida", `${financeWhen(d.reversal.reversed_at)}${d.reversal.reversed_by ? ` por ${d.reversal.reversed_by}` : ""}`], ["Motivo de la reversión", reversalReasonLabel(d.reversal.reason)],
    ...(d.reversal.note ? [["Explicación", d.reversal.note] as [string, string]] : []),
    ["Revertido", `${money(d.reversal.net_minor)} de PIKAS Cash · cargo ${money(d.reversal.fee_minor)} · ${d.method === "cafeteria_cash" ? "efectivo" : "pagado"} ${money(d.reversal.gross_minor)}`]);
  return rows;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card space-y-3 p-5" aria-label={title}><h2 className="text-lg font-bold">{title}</h2>{children}</section>;
}
function Rows({ rows }: { rows: [string, string][] }) {
  return <dl className="divide-y">{rows.map(([label, value]) => <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
    <dt className="text-sm text-slate-600">{label}</dt><dd className="min-w-0 break-words text-right font-semibold">{value}</dd></div>)}</dl>;
}
