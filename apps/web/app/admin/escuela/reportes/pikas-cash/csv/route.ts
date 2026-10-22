import { schoolReportRoute } from "../../../../../../lib/school/report-access";
import { loadWalletReport, walletCsv } from "../../../../../../lib/school/reports";
import { parsePeriod } from "../../../../../../lib/reports/filters";
import { csvFilename, csvResponse } from "../../../../../../lib/reports/csv";

// CSV of Reportes / PIKAS Cash: the movement lines of the period in the URL. No per-cafetería rows.
export async function GET(request: Request) {
  const access = await schoolReportRoute(request, { wallet: true });
  if (!access.ok) return access.response;
  const period = parsePeriod(access.params, "last_30_days");
  if (!period.ok) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const loaded = await loadWalletReport(access.client, access.schoolId, period.value);
  if (loaded.status !== "ok") return Response.json({ error: "export_unavailable" }, { status: 502 });
  return csvResponse(walletCsv(loaded.value), csvFilename("reporte-pikas-cash"), 1);
}
