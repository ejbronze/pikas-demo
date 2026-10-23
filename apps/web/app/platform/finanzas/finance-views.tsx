import Link from "next/link";
import { ErrorState } from "../../../components/state-panels";
import { money } from "../../../lib/cafeteria/operations";
import { statusLabel, statusTone, type FinanceStatus } from "../../../lib/platform/finance";

export function FinanceStatusBadge({ status }: { status: FinanceStatus }) {
  return <span className={`chip ${statusTone[status]}`}>{statusLabel[status]}</span>;
}

// Gross → fee → net as a small statement: the fee is a replenishment charge, never a spending fee.
export function AmountBreakdown({ gross, fee, net, feeBps = 300, compact = false, credited = false }: {
  gross: string; fee: string; net: string; feeBps?: number; compact?: boolean; credited?: boolean;
}) {
  const rate = `${(feeBps / 100).toLocaleString("es-DO", { maximumFractionDigits: 2 })} %`;
  const rows: [string, string, string][] = [["Pagado", money(gross), ""], [`Cargo por recarga PIKAS (${rate})`, `− ${money(fee)}`, "text-slate-600"],
    [credited ? "Se acreditó a PIKAS Cash" : "Se acredita a PIKAS Cash", money(net), "font-black"]];
  return <dl className={`tabular-nums ${compact ? "text-sm" : ""}`} aria-label="Montos de la recarga">
    {rows.map(([label, value, tone], index) => <div key={label} className={`flex flex-wrap items-baseline justify-between gap-x-4 ${compact ? "py-0.5" : "py-2"} ${index === 2 ? "border-t border-slate-300" : ""}`}>
      <dt className={index === 2 ? "font-bold" : "text-slate-600"}>{label}</dt><dd className={`text-right ${tone}`}>{value}</dd></div>)}
  </dl>;
}

export function FinanceTabs({ current }: { current: "pendientes" | "historial" }) {
  return <nav aria-label="Vistas de finanzas" className="overflow-x-auto"><ul className="flex w-max gap-1 rounded-2xl bg-slate-100 p-1">
    {([["pendientes", "Por verificar"], ["historial", "Historial"]] as const).map(([key, label]) => <li key={key}>
      <Link href={key === "pendientes" ? "/platform/finanzas" : "/platform/finanzas?vista=historial"} aria-current={key === current ? "page" : undefined}
        className={`flex min-h-11 items-center rounded-xl px-4 text-sm font-bold ${key === current ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}>{label}</Link></li>)}
  </ul></nav>;
}

// UX 14: the same three answers as the rest of Platform, with finance's own wording kept restrained.
export function FinanceReadFailure({ kind }: { kind: string }) {
  const back = <Link className="btn-secondary" href="/platform/finanzas">Volver a Finanzas</Link>;
  if (kind === "forbidden") return <ErrorState kind="permission" title="No tienes permiso para consultar finanzas." description="Este destino requiere acceso de lectura financiera de PIKAS." action={back} />;
  if (kind === "missing") return <ErrorState kind="not_found" title="No encontramos esta solicitud." description="Puede haber sido procesada con otra referencia o la dirección ya no es válida." action={back} />;
  return <ErrorState title="No pudimos cargar la información financiera." description="Inténtalo de nuevo. Si continúa, vuelve a Finanzas más tarde." action={back} />;
}
