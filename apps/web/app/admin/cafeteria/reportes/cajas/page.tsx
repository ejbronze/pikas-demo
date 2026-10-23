import { cafeteriaReportPage } from "../../../../../lib/cafeteria/report-access";
import { cafeteriaReportFrame } from "../../../../../lib/cafeteria/report-page-parts";
import { loadReport } from "../../../../../lib/cafeteria/sales-reports";
import type { SearchParams } from "../../../../../lib/reports/filters";
import { CajasReportBody } from "../../../../../components/cafeteria-report-views";

// Reportes / Cajas y cierres: cafeteria_report_read 'reconciliation' for the period in the URL.
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await cafeteriaReportPage(searchParams);
  const f = cafeteriaReportFrame(ctx, "cajas", "Cajas y cierres", "Cajas abiertas ahora y cierres del período con su conciliación de efectivo.", { needs: "sessions" });
  if (f.refusal) return f.refusal; if (f.invalid) return f.invalid;
  if (!f.period.ok) return f.shell(<>{f.header(null, [], null)}{f.controls()}</>);
  const loaded = await loadReport(ctx.client, ctx.cafeteriaId, "reconciliation", f.period.value), r = loaded.status === "ok" ? loaded.value : null;
  const head = <>{f.header(r, [], r ? {} : null)}{f.controls()}</>;
  if (loaded.status !== "ok") return f.shell(<>{head}{f.failed(loaded.status === "error" ? loaded.message : undefined, loaded.status === "error" ? loaded.kind : undefined)}</>);
  return f.shell(<>{head}<CajasReportBody cafeteriaId={ctx.cafeteriaId} report={loaded.value} /></>);
}
