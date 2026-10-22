import { schoolReportPage } from "../../../../lib/school/report-access";
import type { SearchParams } from "../../../../lib/reports/filters";
import { ConnectedSchoolShell } from "../../../../components/connected-school-shell";
import { SchoolReportsIndex } from "../../../../components/school-reports";

// PIKAS UX 8 School Reportes: the landing lists only the reports this role can open.
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { context, schoolId, school, walletRead } = await schoolReportPage(searchParams);
  return <ConnectedSchoolShell context={context} schoolId={schoolId} walletNav={walletRead}><SchoolReportsIndex schoolId={schoolId} schoolName={school.school_name} walletRead={walletRead} /></ConnectedSchoolShell>;
}
