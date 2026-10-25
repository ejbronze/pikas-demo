import { FINANCE_REPORT_CAPABILITY, financeArgs, platformReportRoute } from "../../../../../lib/platform/report-access";
import { financeCsv, financeReportSchema } from "../../../../../lib/platform/reports";
import { parsePeriod } from "../../../../../lib/reports/filters";
import { csvFilename, csvResponse } from "../../../../../lib/reports/csv";

// CSV of Reportes / Finanzas (resumen): platform:finance:read only, same period as the page.
export async function GET(request: Request) {
  const period = parsePeriod(Object.fromEntries(new URL(request.url).searchParams), "last_30_days");
  if (!period.ok) return Response.json({ error: "invalid_filters" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const access = await platformReportRoute(request, FINANCE_REPORT_CAPABILITY, { finance: { fn: "platform_finance_report", args: financeArgs(period.value), schema: financeReportSchema } });
  if (!access.ok) return access.response;
  const body = financeCsv(access.values.finance);
  return csvResponse(body, csvFilename("reporte-finanzas"), body.split("\r\n").length - 2);
}
