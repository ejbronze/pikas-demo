import { clientesNetworkArgs, platformReportRoute } from "../../../../../lib/platform/report-access";
import { READINESS_CAPABILITY, readinessSchema } from "../../../../../lib/platform/readiness";
import { customerRows, customersCsv, filterRows, networkReportSchema, parseCustomerFilters } from "../../../../../lib/platform/reports";
import { csvFilename, csvResponse } from "../../../../../lib/reports/csv";

// CSV of Reportes / Clientes: the same reads, filters and rows as the report; never an incomplete network.
export async function GET(request: Request) {
  const filters = parseCustomerFilters(Object.fromEntries(new URL(request.url).searchParams));
  if (!filters.success) return Response.json({ error: "invalid_filters" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const access = await platformReportRoute(request, READINESS_CAPABILITY, {
    readiness: { fn: "platform_customer_readiness", args: { p_account_id: null }, schema: readinessSchema },
    network: { fn: "platform_network_report", args: clientesNetworkArgs(filters.data), schema: networkReportSchema } });
  if (!access.ok) return access.response;
  const rows = filterRows(customerRows(access.values.readiness, access.values.network), filters.data);
  return csvResponse(customersCsv(rows), csvFilename(filters.data.demo ? "reporte-clientes-con-demo" : "reporte-clientes"), rows.length);
}
