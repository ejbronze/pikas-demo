import { schoolReportRoute } from "../../../../../../lib/school/report-access";
import { loadStudentsReport, parseStudentFilters, studentsCsv } from "../../../../../../lib/school/reports";
import { csvFilename, csvResponse } from "../../../../../../lib/reports/csv";

// CSV of Reportes / Estudiantes: the full filtered result, exactly the rows the report shows.
export async function GET(request: Request) {
  const access = await schoolReportRoute(request);
  if (!access.ok) return access.response;
  const filters = parseStudentFilters(access.params);
  if (!filters.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const loaded = await loadStudentsReport(access.client, access.schoolId, access.context.person_id, filters.data);
  if (loaded.status === "too_many") return Response.json({ error: "student_export_limit" }, { status: 413 });
  if (loaded.status !== "ok") return Response.json({ error: "export_unavailable" }, { status: 502 });
  return csvResponse(studentsCsv(loaded.value.rows), csvFilename("reporte-estudiantes"), loaded.value.rows.length);
}
