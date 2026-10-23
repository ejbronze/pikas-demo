import { schoolReportPage } from "../../../../../lib/school/report-access";
import { generatedAt, type SearchParams } from "../../../../../lib/reports/filters";
import { loadServiceReport } from "../../../../../lib/school/reports";
import { ConnectedSchoolShell } from "../../../../../components/connected-school-shell";
import { ReportFrame, ReportHeader } from "../../../../../components/report-frame";
import { ServiceReportBody, schoolReportPath } from "../../../../../components/school-reports";
import { LoadFailure } from "../../../../../components/state-panels";

// Reportes / Cafeterías conectadas: the school's service relationships (school:sharing:read).
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client, context, schoolId, school, walletRead } = await schoolReportPage(searchParams);
  const loaded = await loadServiceReport(client, schoolId, context.person_id), generated = generatedAt();
  return <ConnectedSchoolShell context={context} schoolId={schoolId} walletNav={walletRead}><ReportFrame generated={generated}>
    <ReportHeader back={{ href: `${schoolReportPath()}?school=${schoolId}`, label: "Reportes" }} title="Cafeterías conectadas" scope={school.school_name}
      purpose="Cafeterías que atienden al colegio, qué información comparte el colegio con cada una y cuántos estudiantes están habilitados."
      filters={[{ label: "Alcance", value: "Todas las cafeterías del colegio" }]} generated={generated} csvHref={loaded.status === "ok" ? `${schoolReportPath("cafeterias")}/csv?school=${schoolId}` : undefined} />
    {loaded.status === "ok" ? <ServiceReportBody rows={loaded.value} /> : <LoadFailure kind={loaded.status === "error" ? loaded.kind : undefined} what="el reporte de cafeterías" retryHref={`${schoolReportPath("cafeterias")}?school=${schoolId}`} />}
  </ReportFrame></ConnectedSchoolShell>;
}
