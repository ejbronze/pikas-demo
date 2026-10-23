import { cafeteriaReportPage } from "../../../../../lib/cafeteria/report-access";
import { cafeteriaReportFrame } from "../../../../../lib/cafeteria/report-page-parts";
import { loadReport } from "../../../../../lib/cafeteria/sales-reports";
import type { SearchParams } from "../../../../../lib/reports/filters";
import { PaymentsReportBody } from "../../../../../components/cafeteria-report-views";

// Reportes / Métodos de pago: cafeteria_report_read 'sales_summary' for the period in the URL.
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await cafeteriaReportPage(searchParams);
  const f = cafeteriaReportFrame(ctx, "pagos", "Métodos de pago", "Cómo pagaron las ventas del período");
  if (f.refusal) return f.refusal; if (f.invalid) return f.invalid;
  if (!f.period.ok) return f.shell(<>{f.header(null, [], null)}{f.controls()}</>);
  const loaded = await loadReport(ctx.client, ctx.cafeteriaId, "sales_summary", f.period.value), r = loaded.status === "ok" ? loaded.value : null;
  const head = <>{f.header(r, [], r ? {} : null)}{f.controls()}</>;
  if (loaded.status !== "ok") return f.shell(<>{head}{f.failed(loaded.status === "error" ? loaded.message : undefined, loaded.status === "error" ? loaded.kind : undefined)}</>);
  return f.shell(<>{head}<PaymentsReportBody cafeteriaId={ctx.cafeteriaId} period={f.period.value} summary={loaded.value} /></>);
}
