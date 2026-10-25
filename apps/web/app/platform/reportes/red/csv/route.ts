import { networkArgs, platformReportRoute } from "../../../../../lib/platform/report-access";
import { READINESS_CAPABILITY } from "../../../../../lib/platform/readiness";
import { networkCsv, networkReportSchema } from "../../../../../lib/platform/reports";
import { one, parsePeriod } from "../../../../../lib/reports/filters";
import { csvFilename, csvResponse } from "../../../../../lib/reports/csv";

// CSV of Reportes / Red y adopción: one row per cafetería en operación, the report's table, same period and Demo choice.
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams), demo = one(params.demo) ?? "", period = parsePeriod(params, "last_30_days");
  if (!period.ok || (demo !== "" && demo !== "1")) return Response.json({ error: "invalid_filters" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const access = await platformReportRoute(request, READINESS_CAPABILITY, { network: { fn: "platform_network_report", args: networkArgs(period.value, demo === "1"), schema: networkReportSchema } });
  if (!access.ok) return access.response;
  const body = networkCsv(access.values.network);
  return csvResponse(body, csvFilename(demo ? "reporte-red-con-demo" : "reporte-red"), body.split("\r\n").length - 2);
}
