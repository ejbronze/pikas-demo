import { cafeteriaReportPage } from "../../../../../lib/cafeteria/report-access";
import { cafeteriaReportFrame } from "../../../../../lib/cafeteria/report-page-parts";
import { loadReport } from "../../../../../lib/cafeteria/sales-reports";
import type { SearchParams } from "../../../../../lib/reports/filters";
import { ProductsReportBody } from "../../../../../components/cafeteria-report-views";

// Reportes / Productos: cafeteria_report_read 'top_products' for the period in the URL.
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await cafeteriaReportPage(searchParams);
  const f = cafeteriaReportFrame(ctx, "productos", "Productos", "Productos con actividad en el período por unidades vendidas, reembolsadas y netas.");
  if (f.refusal) return f.refusal; if (f.invalid) return f.invalid;
  if (!f.period.ok) return f.shell(<>{f.header(null, [], null)}{f.controls()}</>);
  const loaded = await loadReport(ctx.client, ctx.cafeteriaId, "top_products", f.period.value), r = loaded.status === "ok" ? loaded.value : null;
  const head = <>{f.header(r, [], r ? {} : null)}{f.controls()}</>;
  if (loaded.status !== "ok") return f.shell(<>{head}{f.failed(loaded.status === "error" ? loaded.message : undefined, loaded.status === "error" ? loaded.kind : undefined)}</>);
  return f.shell(<>{head}<ProductsReportBody report={loaded.value} /></>);
}
