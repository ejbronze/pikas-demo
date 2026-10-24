import { money } from "../lib/cafeteria/operations";
import { cafeteriaDirection, eventLabel, lineGroups, lineReasonLabel, lineSource, paidOnLabel, platformDirection, reviewReasonLabel, settlementWhen, statusText, statusTone, weekLabel,
  type SettlementDirection, type SettlementEvent, type SettlementLine, type SettlementStatus } from "../lib/platform/settlements";

type Audience = "platform" | "cafeteria";

export function SettlementBadge({ status }: { status: SettlementStatus | "ready" }) {
  return <span className={`chip ${statusTone[status]}`}>{statusText[status]}</span>;
}

// Gross both ways, then the net and who sends it. Direction is always written out (never color alone).
export function SettlementTotals({ owes, owed, direction, net, audience, compact = false }: {
  owes: string; owed: string; direction: SettlementDirection; net: string; audience: Audience; compact?: boolean;
}) {
  const rows: [string, string][] = audience === "cafeteria"
    ? [["Por enviar a PIKAS (efectivo recibido y reembolsos)", owes], ["Por recibir de PIKAS (ventas con PIKAS Cash)", owed]]
    : [["La cafetería debe (efectivo recibido y reembolsos)", owes], ["PIKAS debe (ventas con PIKAS Cash)", owed]];
  const label = (audience === "cafeteria" ? cafeteriaDirection : platformDirection)[direction];
  return <dl className={`tabular-nums ${compact ? "text-sm" : ""}`} aria-label="Cálculo de la liquidación">
    {rows.map(([k, v]) => <div key={k} className={`flex flex-wrap items-baseline justify-between gap-x-4 ${compact ? "py-0.5" : "py-1.5"}`}>
      <dt className="min-w-0 text-slate-600">{k}</dt><dd className="text-right">{money(v)}</dd></div>)}
    <div className={`flex flex-wrap items-baseline justify-between gap-x-4 border-t border-slate-300 ${compact ? "pt-1" : "pt-2"}`}>
      <dt className="font-bold">{label}</dt><dd className={`text-right font-black ${compact ? "" : "text-lg"}`}>{money(net)}</dd></div>
  </dl>;
}

// Every included obligation, grouped so the Cafetería can reconcile it against its own operation.
export function SettlementLines({ lines, audience }: { lines: SettlementLine[]; audience: Audience }) {
  return <div className="space-y-4">{lineGroups.map(group => {
    const items = lines.filter(l => (group.reasons as readonly string[]).includes(l.reason));
    if (!items.length) return null;
    const total = items.reduce((sum, l) => sum + (l.direction === "cafeteria_to_clearing" ? BigInt(l.amount_minor) : -BigInt(l.amount_minor)), 0n);
    return <section key={group.key} aria-label={group.title} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4"><h3 className="font-bold">{group.title} <span className="font-normal text-slate-600">({items.length})</span></h3>
        <span className="text-sm tabular-nums text-slate-700">{total >= 0n ? (audience === "cafeteria" ? "Por enviar " : "La cafetería debe ") : (audience === "cafeteria" ? "Por recibir " : "PIKAS debe ")}{money((total < 0n ? -total : total).toString())}</span></div>
      <ul className="divide-y rounded-xl border">{items.map((l, i) => <li key={i} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
        <div className="min-w-0 flex-1 basis-48 break-words"><p className="font-semibold">{lineReasonLabel[l.reason]}</p>
          <p className="text-slate-600">{[lineSource(l), settlementWhen(l.occurred_at)].filter(Boolean).join(" · ")}</p>
          {l.late && <p className="mt-1"><span className="chip bg-slate-200 text-slate-900">De la {weekLabel(l.week_start, addDays(l.week_start, 6)).toLowerCase()}: registrado después de su liquidación</span></p>}</div>
        <span className="whitespace-nowrap text-right tabular-nums">{l.direction === "cafeteria_to_clearing" ? (audience === "cafeteria" ? "Debes " : "Debe la cafetería ") : (audience === "cafeteria" ? "Te debe PIKAS " : "Debe PIKAS ")}{money(l.amount_minor)}</span>
      </li>)}</ul></section>;
  })}</div>;
}

export function SettlementEvents({ events, direction, audience }: { events: SettlementEvent[]; direction: SettlementDirection; audience: Audience }) {
  return <ol className="space-y-3">{events.map((e, i) => <li key={i} className="rounded-xl border p-3 text-sm">
    <p className="font-bold">{eventLabel(e, direction)}</p>
    <p className="text-slate-600">{settlementWhen(e.occurred_at)}{audience === "platform" && e.actor ? ` · ${e.actor}` : audience === "cafeteria" ? " · PIKAS" : ""}</p>
    {e.amount_minor && <p>Monto {money(e.amount_minor)} · Referencia <span className="font-mono">{e.payment_reference}</span>{e.paid_on ? ` · Fecha del pago ${paidOnLabel(e.paid_on)}` : ""}</p>}
    {e.kind === "review_opened" && <p>Motivo: {reviewReasonLabel(e.reason)}</p>}
    {e.note && <p className="break-words">Nota: {e.note}</p>}
  </li>)}</ol>;
}

export const addDays = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
