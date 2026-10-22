import { cafeteriaReportRoute } from "../../../../../../lib/cafeteria/report-access";
import { cajasCsv, loadReport } from "../../../../../../lib/cafeteria/sales-reports";
import { parsePeriod } from "../../../../../../lib/reports/filters";
import { csvFilename, csvResponse } from "../../../../../../lib/reports/csv";

// CSV of Reportes / Cajas y cierres: the same read and period as the report; no internal ids.
export async function GET(request: Request) {
  const access = await cafeteriaReportRoute(request);
  if (!access.ok) return access.response;
  const period = parsePeriod(access.params, "last_30_days");
  if (!period.ok) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const loaded = await loadReport(access.client, access.cafeteriaId, "reconciliation", period.value);
  if (loaded.status !== "ok") return Response.json({ error: "export_unavailable" }, { status: 502 });
  return csvResponse(cajasCsv(loaded.value), csvFilename("reporte-cajas"), 1);
}
