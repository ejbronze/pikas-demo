import Link from "next/link";
import { schoolReportPage } from "../../../../../lib/school/report-access";
import { generatedAt, parsePeriod, periodLabels, reportDay, reportHref, type SearchParams } from "../../../../../lib/reports/filters";
import { loadWalletReport } from "../../../../../lib/school/reports";
import { ConnectedSchoolShell } from "../../../../../components/connected-school-shell";
import { PeriodControls, ReportFrame, ReportHeader } from "../../../../../components/report-frame";
import { SchoolWalletReport } from "../../../../../components/school-wallet-report";
import { schoolReportPath } from "../../../../../components/school-reports";
import { ErrorState, LoadFailure } from "../../../../../components/state-panels";

// Reportes / PIKAS Cash: wallet movement of the school's students for the period in the URL
// (school:wallets:read; excluded from the sandbox POV like School PIKAS Cash).
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client, context, params, schoolId, school, walletRead } = await schoolReportPage(searchParams), generated = generatedAt();
  const shell = (children: React.ReactNode) => <ConnectedSchoolShell context={context} schoolId={schoolId} walletNav={walletRead}><ReportFrame generated={generated}>{children}</ReportFrame></ConnectedSchoolShell>;
  const back = { href: `${schoolReportPath()}?school=${schoolId}`, label: "Reportes" }, path = schoolReportPath("pikas-cash");
  if (!walletRead) return shell(<ErrorState kind={context.pov ? "not_configured" : "permission"} title={context.pov ? "Los reportes financieros no están habilitados en este punto de vista de sandbox." : "Tu rol no tiene acceso a los reportes de PIKAS Cash en esta escuela."} description={context.pov ? "El sandbox no incluye datos financieros." : "Lo otorga el administrador de la cuenta del colegio; pídeselo si lo necesitas."} action={<Link className="btn-secondary" href={back.href}>Volver a Reportes</Link>} />);
  const period = parsePeriod(params, "last_30_days");
  if (!period.ok && period.invalid) return shell(<ErrorState kind="validation" title="Los filtros no son válidos." description={period.error} action={<Link className="btn-secondary" href={`${path}?school=${schoolId}`}>Restablecer filtros</Link>} />);
  const loaded = period.ok ? await loadWalletReport(client, schoolId, period.value) : null, r = loaded?.status === "ok" ? loaded.value : null;
  const header = <ReportHeader back={back} title="PIKAS Cash" scope={school.school_name} purpose="Movimiento de los monederos de los estudiantes en el período. No incluye ventas en efectivo, otras formas de pago ni detalle por cafetería."
    filters={[{ label: "Período", value: period.ok ? periodLabels[period.value.period] : "Personalizado" }, { label: "Fechas", value: r ? `${reportDay(r.from)} al ${reportDay(r.to)}` : "—" }]}
    generated={generated} csvHref={r && period.ok ? reportHref(`${path}/csv`, { school: schoolId, ...period.value }) : undefined} />;
  const controls = <PeriodControls path={path} keep={{ school: schoolId }} period={period.ok ? period.value.period : "custom"} draft={period.ok ? { from: period.value.from ?? "", to: period.value.to ?? "" } : period.draft} error={period.ok ? undefined : period.error} />;
  if (!period.ok) return shell(<>{header}{controls}</>);
  if (!r) return shell(<>{header}{controls}{loaded?.status === "error" && loaded.message ? <ErrorState kind={loaded.kind ?? "validation"} title={loaded.message} description="Ajusta el período y vuelve a generar el reporte." /> : <LoadFailure kind={loaded?.status === "error" ? loaded.kind : undefined} what="el reporte de PIKAS Cash" retryHref={`${path}?school=${schoolId}`} />}</>);
  return shell(<>{header}{controls}<SchoolWalletReport report={r} /></>);
}
