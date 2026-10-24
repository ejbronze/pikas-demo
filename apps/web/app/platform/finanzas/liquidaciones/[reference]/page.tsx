import { createHash } from "node:crypto";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { AppPageHeader } from "../../../../../components/app-page-header";
import { SettlementBadge, SettlementEvents, SettlementLines, SettlementTotals } from "../../../../../components/settlement-views";
import { FINANCE_READ, customerLine } from "../../../../../lib/platform/finance";
import { SETTLEMENT_MANAGE, dueLabel, settlementDetailSchema, settlementWhen, weekLabel } from "../../../../../lib/platform/settlements";
import { FinanceReadFailure } from "../../finance-views";
import { SettlementActions } from "../settlement-actions";

// One finalized settlement: the immutable snapshot (gross both ways, net and direction), every included obligation, and
// its payment/review history. Actions appear only with settlement authority.
export default async function SettlementPage({ params }: { params: Promise<{ reference: string }> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes(FINANCE_READ)) return <FinanceReadFailure kind="forbidden" />;
  const { reference } = await params;
  if (!/^LIQ-[0-9]{8}$/.test(reference)) return <FinanceReadFailure kind="missing" />;
  const result = await readPlatform(session, FINANCE_READ, "platform_finance_settlement_detail", { p_reference: reference }, settlementDetailSchema);
  if (result.kind !== "ready") return <FinanceReadFailure kind={result.kind} />;
  const d = result.value, week = weekLabel(d.week_start, d.week_end);
  const actor = createHash("sha256").update(`settlement:${session.identity.person.id}`).digest("hex").slice(0, 24);
  return <>
    <AppPageHeader back={{ href: d.status === "settled" ? "/platform/finanzas/liquidaciones?vista=historial" : "/platform/finanzas/liquidaciones", label: "Liquidaciones" }}
      title={<span className="font-mono">{d.reference}</span>}
      meta={<span className="flex flex-wrap items-center gap-2"><SettlementBadge status={d.status} />{d.overdue && <span className="chip bg-red-100 text-red-900">Vencida</span>}<span>{d.cafeteria} · {week} · {customerLine(d.customer, d.school)}</span></span>} />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="min-w-0 space-y-5">
        <Section title="Resultado">
          <SettlementTotals owes={d.cafeteria_owes_minor} owed={d.clearing_owes_minor} direction={d.net_direction} net={d.net_amount_minor} audience="platform" />
          <p className="text-sm text-slate-600">Semana del lunes al domingo, hora de Santo Domingo. Vence el {dueLabel(d.due_on)}. El cargo PIKAS ya se registró en cada recarga; la liquidación no cobra otro cargo.</p>
          <p className="text-sm text-slate-600">Calculada {settlementWhen(d.finalized_at)}{d.finalized_by ? ` por ${d.finalized_by}` : ""}. Los totales no cambian: lo que llegue después entra en una liquidación posterior.</p>
        </Section>
        <Section title={`Movimientos incluidos (${d.lines.length})`}><SettlementLines lines={d.lines} audience="platform" /></Section>
      </div>
      <aside className="min-w-0 space-y-5" aria-label="Acciones de la liquidación">
        {session.capabilities.includes(SETTLEMENT_MANAGE)
          ? <SettlementActions actor={actor} reference={d.reference} cafeteria={d.cafeteria} week={week} status={d.status} direction={d.net_direction} net={d.net_amount_minor} />
          : d.status !== "settled" && <p className="card p-4 text-sm">Tu acceso permite consultar. Confirmar pagos o revisar requiere el permiso de liquidaciones.</p>}
        <Section title="Historial"><SettlementEvents events={d.events} direction={d.net_direction} audience="platform" /></Section>
      </aside>
    </div>
  </>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card space-y-3 p-5" aria-label={title}><h2 className="text-lg font-bold">{title}</h2>{children}</section>;
}
