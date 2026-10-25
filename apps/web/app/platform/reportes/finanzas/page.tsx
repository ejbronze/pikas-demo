import { FINANCE_REPORT_CAPABILITY, financeArgs, platformSession, readFinance } from "../../../../lib/platform/report-access";
import { generatedAt, parsePeriod, periodLabels, reportDay, reportHref, type SearchParams } from "../../../../lib/reports/filters";
import { PeriodControls, ReportFrame, ReportHeader } from "../../../../components/report-frame";
import { FinanceReportBody, platformReportPath } from "../../../../components/platform/report-views";
import { FinanceReadFailure } from "../../finanzas/finance-views";

// Reportes / Finanzas (resumen): platform:finance:read only. A summary; every action stays in Finanzas.
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [session, params] = await Promise.all([platformSession(), searchParams]), generated = generatedAt(), path = platformReportPath("finanzas");
  if (!session.capabilities.includes(FINANCE_REPORT_CAPABILITY)) return <FinanceReadFailure kind="forbidden" />;
  const period = parsePeriod(params, "last_30_days");
  if (!period.ok) return <ReportFrame generated={generated}>
    <ReportHeader back={{ href: platformReportPath(), label: "Reportes" }} title="Finanzas (resumen)" scope="Red PIKAS · clientes reales" generated={generated} purpose="Resumen financiero de solo lectura." filters={[]} />
    <PeriodControls path={path} keep={{}} period={period.invalid ? null : "custom"} draft={period.draft} error={period.error} /></ReportFrame>;
  const read = await readFinance(session, financeArgs(period.value));
  if (read.kind !== "ready") return <FinanceReadFailure kind={read.kind} />;
  const r = read.value, p = period.value;
  return <ReportFrame generated={generated}>
    <ReportHeader back={{ href: platformReportPath(), label: "Reportes" }} title="Finanzas (resumen)" scope="Red PIKAS · clientes reales (sin Demo)" generated={generated}
      purpose="Activación financiera, recargas, obligaciones y liquidaciones. Solo lectura: las operaciones están en Finanzas."
      filters={[{ label: "Período", value: `${periodLabels[p.period]} · ${reportDay(r.period.from)} – ${reportDay(r.period.to)}` }, { label: "Zona horaria", value: "Santo Domingo" }]}
      csvHref={reportHref(`${path}/csv`, { period: p.period, from: p.from, to: p.to })} />
    <PeriodControls path={path} keep={{}} period={p.period} draft={{ from: p.from ?? r.period.from, to: p.to ?? r.period.to }} />
    <FinanceReportBody report={r} />
  </ReportFrame>;
}
