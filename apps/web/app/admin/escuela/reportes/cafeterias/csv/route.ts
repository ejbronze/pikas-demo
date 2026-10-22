import { schoolReportRoute } from "../../../../../../lib/school/report-access";
import { loadServiceReport, serviceCsv } from "../../../../../../lib/school/reports";
import { csvFilename, csvResponse } from "../../../../../../lib/reports/csv";

// CSV of Reportes / Cafeterías conectadas: the same rows as the report; never student names.
export async function GET(request: Request) {
  const access = await schoolReportRoute(request);
  if (!access.ok) return access.response;
  const loaded = await loadServiceReport(access.client, access.schoolId, access.context.person_id);
  if (loaded.status !== "ok") return Response.json({ error: "export_unavailable" }, { status: 502 });
  return csvResponse(serviceCsv(loaded.value), csvFilename("reporte-cafeterias"), loaded.value.length);
}
