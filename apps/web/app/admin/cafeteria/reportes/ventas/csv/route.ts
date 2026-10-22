import { cafeteriaReportRoute } from "../../../../../../lib/cafeteria/report-access";
import { loadAllSales, parseSalesFilters, payments, salesCsv, salesExportLimit } from "../../../../../../lib/cafeteria/sales-reports";
import { parsePeriod } from "../../../../../../lib/reports/filters";
import { csvFilename, csvResponse } from "../../../../../../lib/reports/csv";

// CSV of Reportes / Ventas: every sale of the period (and payment) — the full filtered list, never a page.
export async function GET(request: Request) {
  const access = await cafeteriaReportRoute(request);
  if (!access.ok) return access.response;
  const period = parsePeriod(access.params, "last_30_days"), filters = parseSalesFilters(access.params);
  if (!period.ok || !filters.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const loaded = await loadAllSales(access.client, access.cafeteriaId, period.value, filters.data.payment ? payments[filters.data.payment] : null);
  if (loaded.status === "too_many") return Response.json({ error: "sales_export_limit", limit: salesExportLimit }, { status: 413 });
  if (loaded.status !== "ok") return Response.json({ error: "export_unavailable" }, { status: 502 });
  return csvResponse(salesCsv(loaded.value), csvFilename("reporte-ventas"), loaded.value.length);
}
