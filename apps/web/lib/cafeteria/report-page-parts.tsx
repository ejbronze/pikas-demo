import Link from "next/link";
import { ConnectedCafeteriaShell } from "../../components/connected-cafeteria-shell";
import { PeriodControls, ReportFrame, ReportHeader, type ReportFilterLabel } from "../../components/report-frame";
import { ErrorState } from "../../components/state-panels";
import { cafeteriaReportPath } from "../../components/cafeteria-report-views";
import { generatedAt, parsePeriod, periodLabels, reportDay, reportHref, type PeriodParse } from "../reports/filters";
import type { cafeteriaReportPage } from "./report-access";

// UX 9: the shared frame of a Cafetería period report — shell, refusal for roles or tenants without
// financial reports, period parsing with the accepted Hoy / 7 / 30 / Personalizado controls, header.
type PageCtx = Awaited<ReturnType<typeof cafeteriaReportPage>>;
export function cafeteriaReportFrame(ctx: PageCtx, report: string, title: string, purpose: string, { needs = "sales" as "sales" | "sessions" } = {}) {
  const generated = generatedAt(), path = cafeteriaReportPath(report), back = { href: `${cafeteriaReportPath()}?cafeteria=${ctx.cafeteriaId}`, label: "Reportes" };
  const shell = (children: React.ReactNode) => <ConnectedCafeteriaShell context={ctx.context} cafeteriaId={ctx.cafeteriaId} walletNav={ctx.walletNav} reportsNav={ctx.sales}><ReportFrame generated={generated}>{children}</ReportFrame></ConnectedCafeteriaShell>;
  const allowed = needs === "sessions" ? ctx.sessions : ctx.sales;
  const refusal = allowed ? null : shell(<ErrorState title={ctx.cafeteria.tenant_kind === "sandbox" ? "Los reportes financieros no están disponibles en el entorno sandbox." : needs === "sessions" ? "Tu rol no tiene acceso al historial de cajas de esta cafetería." : "Tu rol no tiene acceso a reportes de esta cafetería."}
    retry={<Link className="btn-secondary" href={back.href}>Volver a Reportes</Link>} />);
  const period: PeriodParse = parsePeriod(ctx.params, "last_30_days");
  const invalid = !period.ok && period.invalid ? shell(<ErrorState title="Los filtros no son válidos." description={period.error} retry={<Link className="btn-secondary" href={`${path}?cafeteria=${ctx.cafeteriaId}`}>Limpiar filtros</Link>} />) : null;
  const header = (range: { from: string; to: string } | null, extra: ReportFilterLabel[], csv: Record<string, string | null> | null) => <ReportHeader back={back} title={title}
    scope={`${ctx.cafeteria.cafeteria_name} · ${ctx.cafeteria.school_name}`} purpose={purpose} generated={generated}
    filters={[{ label: "Período", value: period.ok ? periodLabels[period.value.period] : "Personalizado" }, { label: "Fechas", value: range ? (range.from === range.to ? reportDay(range.from) : `${reportDay(range.from)} al ${reportDay(range.to)}`) : "—" }, ...extra]}
    csvHref={csv && period.ok ? reportHref(`${path}/csv`, { cafeteria: ctx.cafeteriaId, ...period.value, ...csv }) : undefined} />;
  const controls = (keep: Record<string, string> = {}) => <PeriodControls path={path} keep={{ cafeteria: ctx.cafeteriaId, ...keep }} period={period.ok ? period.value.period : "custom"}
    draft={period.ok ? { from: period.value.from ?? "", to: period.value.to ?? "" } : period.draft} error={period.ok ? undefined : period.error} />;
  const failed = (message?: string) => <ErrorState title={message || "No pudimos cargar el reporte con tus permisos actuales."} />;
  return { shell, refusal, invalid, period, header, controls, failed };
}
