import Link from "next/link";
import { cafeteriaReportPage } from "../../../../../lib/cafeteria/report-access";
import { cafeteriaReportFrame } from "../../../../../lib/cafeteria/report-page-parts";
import { loadReport, loadSales, loadToday, parseSalesFilters, payments } from "../../../../../lib/cafeteria/sales-reports";
import { tenderLabel } from "../../../../../lib/cafeteria/transactions";
import type { SearchParams } from "../../../../../lib/reports/filters";
import { SalesReportBody, cafeteriaReportPath } from "../../../../../components/cafeteria-report-views";
import { ErrorState } from "../../../../../components/state-panels";

// Reportes / Ventas: period (and payment method) from the URL; summary, hourly shape for Hoy, sales list.
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await cafeteriaReportPage(searchParams);
  const f = cafeteriaReportFrame(ctx, "ventas", "Ventas", "Ventas de la cafetería en el período: totales, reembolsos y cada venta. Para buscar un recibo concreto usa Transacciones.");
  if (f.refusal) return f.refusal; if (f.invalid) return f.invalid;
  const filters = parseSalesFilters(ctx.params);
  if (!filters.success) return f.shell(<ErrorState kind="validation" title="Los filtros no son válidos." description="La dirección trae filtros que no existen. Restablécelos para ver el reporte completo." action={<Link className="btn-secondary" href={`${cafeteriaReportPath("ventas")}?cafeteria=${ctx.cafeteriaId}`}>Restablecer filtros</Link>} />);
  const { payment, page } = filters.data, extra = [{ label: "Método de pago", value: payment ? tenderLabel[payments[payment]] : "Todos" }];
  if (!f.period.ok) return f.shell(<>{f.header(null, extra, null)}{f.controls(payment ? { payment } : {})}</>);
  const p = f.period.value, tender = payment ? payments[payment] : null;
  const [summary, sales, today] = await Promise.all([loadReport(ctx.client, ctx.cafeteriaId, "sales_summary", p), loadSales(ctx.client, ctx.cafeteriaId, p, tender, (page - 1) * 25),
    p.period === "today" && !payment ? loadToday(ctx.client, ctx.cafeteriaId) : Promise.resolve(null)]);
  const r = summary.status === "ok" ? summary.value : null;
  const head = <>{f.header(r, extra, r ? { payment } : null)}{f.controls(payment ? { payment } : {})}</>;
  if (summary.status !== "ok" || sales.status !== "ok") return f.shell(<>{head}{f.failed(summary.status === "error" ? summary.message : sales.status === "error" ? sales.message : undefined, summary.status === "error" ? summary.kind : sales.status === "error" ? sales.kind : undefined)}</>);
  return f.shell(<>{head}<SalesReportBody cafeteriaId={ctx.cafeteriaId} period={p} payment={payment} summary={summary.value} sales={sales.value} today={today} page={page} /></>);
}
