import Link from "next/link";
import { networkArgs, platformSession, readNetwork } from "../../../../lib/platform/report-access";
import { one, generatedAt, parsePeriod, periodLabels, reportDay, reportHref, type SearchParams } from "../../../../lib/reports/filters";
import { PeriodControls, ReportFrame, ReportHeader } from "../../../../components/report-frame";
import { DemoIncluded, NetworkReportBody, platformReportPath } from "../../../../components/platform/report-views";
import { ErrorState } from "../../../../components/state-panels";
import { ReadFailure } from "../../console-views";

// Reportes / Red y adopción: platform_network_report for the period (America/Santo_Domingo business dates).
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [session, params] = await Promise.all([platformSession(), searchParams]), generated = generatedAt(), path = platformReportPath("red");
  const demo = one(params.demo) ?? "";
  if (demo !== "" && demo !== "1") return <ReportFrame generated={generated}><ErrorState kind="validation" title="Los filtros no son válidos." description="La dirección trae filtros que no existen." action={<Link className="btn-secondary" href={path}>Limpiar filtros</Link>} /></ReportFrame>;
  const period = parsePeriod(params, "last_30_days"), keep: Record<string, string> = demo ? { demo } : {};
  if (!period.ok) return <ReportFrame generated={generated}>
    <ReportHeader back={{ href: platformReportPath(), label: "Reportes" }} title="Red y adopción" scope="Red PIKAS" generated={generated} purpose="Preparación y uso de las cafeterías en operación." filters={[]} />
    <PeriodControls path={path} keep={keep} period={period.invalid ? null : "custom"} draft={period.draft} error={period.error} /></ReportFrame>;
  const read = await readNetwork(session, networkArgs(period.value, demo === "1"));
  if (read.kind !== "ready") return <ReadFailure kind={read.kind} />;
  const r = read.value, p = period.value;
  return <ReportFrame generated={generated}>
    <ReportHeader back={{ href: platformReportPath(), label: "Reportes" }} title="Red y adopción" scope={demo ? "Red PIKAS · clientes activos reales y Demo" : "Red PIKAS · clientes activos (sin Demo)"} generated={generated}
      purpose="Cafeterías en operación: si están listas para operar, si dan servicio a estudiantes y si ya se usan."
      filters={[{ label: "Período", value: `${periodLabels[p.period]} · ${reportDay(r.period.from)} – ${reportDay(r.period.to)}` }, { label: "Zona horaria", value: "Santo Domingo" }, { label: "Demo", value: demo ? "Incluida" : "Excluida" }]}
      csvHref={r.truncated ? undefined : reportHref(`${path}/csv`, { period: p.period, from: p.from, to: p.to, demo })} />
    <div className="flex flex-wrap items-start justify-between gap-3" data-print="hide">
      <PeriodControls path={path} keep={keep} period={p.period} draft={{ from: p.from ?? r.period.from, to: p.to ?? r.period.to }} />
      <Link className="inline-flex min-h-11 items-center font-bold text-teal-800 underline" href={reportHref(path, { period: p.period, from: p.from, to: p.to, demo: demo ? null : "1" })}>{demo ? "Excluir Demo" : "Incluir Demo"}</Link>
    </div>
    {demo && <DemoIncluded />}
    <NetworkReportBody report={r} demo={demo === "1"} />
  </ReportFrame>;
}
