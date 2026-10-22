import { schoolReportPage } from "../../../../../lib/school/report-access";
import { generatedAt, type SearchParams } from "../../../../../lib/reports/filters";
import { loadServiceReport } from "../../../../../lib/school/reports";
import { ConnectedSchoolShell } from "../../../../../components/connected-school-shell";
import { ReportHeader } from "../../../../../components/report-frame";
import { ServiceReportBody, schoolReportPath } from "../../../../../components/school-reports";
import { ErrorState } from "../../../../../components/state-panels";

// Reportes / Cafeterías conectadas: the school's service relationships (school:sharing:read).
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client, context, schoolId, school, walletRead } = await schoolReportPage(searchParams);
  const loaded = await loadServiceReport(client, schoolId, context.person_id);
  return <ConnectedSchoolShell context={context} schoolId={schoolId} walletNav={walletRead}><div className="rpt">
    <ReportHeader back={{ href: `${schoolReportPath()}?school=${schoolId}`, label: "Reportes" }} title="Cafeterías conectadas" scope={school.school_name}
      purpose="Cafeterías que atienden al colegio, qué información comparte el colegio con cada una y cuántos estudiantes están habilitados."
      filters={[{ label: "Alcance", value: "Todas las cafeterías del colegio" }]} generated={generatedAt()} csvHref={loaded.status === "ok" ? `${schoolReportPath("cafeterias")}/csv?school=${schoolId}` : undefined} />
    {loaded.status === "ok" ? <ServiceReportBody rows={loaded.value} /> : <ErrorState title="No pudimos cargar el reporte de cafeterías." description="Puede ser un problema temporal o un cambio en tus permisos." />}
  </div></ConnectedSchoolShell>;
}
