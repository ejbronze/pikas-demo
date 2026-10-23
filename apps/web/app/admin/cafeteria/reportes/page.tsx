import Link from "next/link";
import { cafeteriaReportPage } from "../../../../lib/cafeteria/report-access";
import type { SearchParams } from "../../../../lib/reports/filters";
import { ConnectedCafeteriaShell } from "../../../../components/connected-cafeteria-shell";
import { CafeteriaReportsIndex } from "../../../../components/cafeteria-report-views";
import { ErrorState } from "../../../../components/state-panels";

// PIKAS UX 9 Cafetería Reportes: the landing lists only the reports this role can open.
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await cafeteriaReportPage(searchParams);
  return <ConnectedCafeteriaShell context={ctx.context} cafeteriaId={ctx.cafeteriaId} walletNav={ctx.walletNav} reportsNav={ctx.sales}>
    {ctx.sales ? <CafeteriaReportsIndex cafeteriaId={ctx.cafeteriaId} name={`${ctx.cafeteria.cafeteria_name} · ${ctx.cafeteria.school_name}`} sessions={ctx.sessions} />
      : <ErrorState kind={ctx.cafeteria.tenant_kind === "sandbox" ? "not_configured" : "permission"} title={ctx.cafeteria.tenant_kind === "sandbox" ? "Los reportes financieros no están disponibles en el entorno sandbox." : "Tu rol no tiene acceso a reportes de esta cafetería."} description={ctx.cafeteria.tenant_kind === "sandbox" ? "El sandbox no incluye datos financieros." : "Lo otorga el administrador de la cafetería; pídeselo si lo necesitas."} action={<Link className="btn-secondary" href={`/admin/cafeteria?cafeteria=${ctx.cafeteriaId}`}>Volver a Hoy</Link>} />}
  </ConnectedCafeteriaShell>;
}
