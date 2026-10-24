import { createHash } from "node:crypto";
import { z } from "zod";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { AppPageHeader } from "../../../../../components/app-page-header";
import { SettlementBadge, SettlementLines, SettlementTotals } from "../../../../../components/settlement-views";
import { FINANCE_READ, customerLine } from "../../../../../lib/platform/finance";
import { SETTLEMENT_MANAGE, dueLabel, previewSchema, weekLabel } from "../../../../../lib/platform/settlements";
import { FinanceReadFailure } from "../../finance-views";
import { FinalizeSettlement } from "../settlement-actions";

const query = z.object({ cafeteria: z.guid(), semana: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

// A closed week before finalization: exactly the obligations finalization would include right now.
export default async function ReadyWeekPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes(FINANCE_READ)) return <FinanceReadFailure kind="forbidden" />;
  const parsed = query.safeParse(await searchParams);
  if (!parsed.success) return <FinanceReadFailure kind="missing" />;
  const result = await readPlatform(session, FINANCE_READ, "platform_finance_settlement_preview", { p_cafeteria_id: parsed.data.cafeteria, p_week_start: parsed.data.semana }, previewSchema);
  if (result.kind !== "ready") return <FinanceReadFailure kind={result.kind} />;
  const p = result.value, week = weekLabel(p.week_start, p.week_end);
  const actor = createHash("sha256").update(`settlement:${session.identity.person.id}`).digest("hex").slice(0, 24);
  return <>
    <AppPageHeader back={{ href: "/platform/finanzas/liquidaciones", label: "Liquidaciones" }} title={week}
      meta={<span className="flex flex-wrap items-center gap-2"><SettlementBadge status="ready" /><span>{p.cafeteria} · {customerLine(p.customer, p.school)}</span></span>} />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="min-w-0 space-y-5">
        <section className="card space-y-3 p-5" aria-label="Cálculo"><h2 className="text-lg font-bold">Cálculo actual</h2>
          <SettlementTotals owes={p.cafeteria_owes_minor} owed={p.clearing_owes_minor} direction={p.net_direction} net={p.net_amount_minor} audience="platform" />
          <p className="text-sm text-slate-600">La semana terminó. Vencerá el {dueLabel(p.due_on)}. Al calcular la liquidación, estos montos quedan fijos.</p></section>
        <section className="card space-y-3 p-5" aria-label="Movimientos"><h2 className="text-lg font-bold">Movimientos ({p.lines.length})</h2><SettlementLines lines={p.lines} audience="platform" /></section>
      </div>
      <aside className="min-w-0 space-y-5" aria-label="Acciones">
        {session.capabilities.includes(SETTLEMENT_MANAGE)
          ? <FinalizeSettlement actor={actor} cafeteriaId={p.cafeteria_id} cafeteria={p.cafeteria} weekStart={p.week_start} weekEnd={p.week_end} direction={p.net_direction} net={p.net_amount_minor} />
          : <p className="card p-4 text-sm">Tu acceso permite consultar. Calcular liquidaciones requiere el permiso de liquidaciones.</p>}
      </aside>
    </div>
  </>;
}
