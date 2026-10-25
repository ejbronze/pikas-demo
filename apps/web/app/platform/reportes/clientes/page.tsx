import Link from "next/link";
import { clientesNetworkArgs, platformSession, readNetwork, readReadiness } from "../../../../lib/platform/report-access";
import { customerRows, filterRows, lifecycleLabel, parseCustomerFilters, stepLabel } from "../../../../lib/platform/reports";
import { generatedAt, reportHref, type SearchParams } from "../../../../lib/reports/filters";
import { ReportFrame, ReportHeader } from "../../../../components/report-frame";
import { CustomersReportBody, platformReportPath } from "../../../../components/platform/report-views";
import { ErrorState } from "../../../../components/state-panels";
import { ReadFailure } from "../../console-views";

const launchNames = { configuring: "En configuración", ready: "Listo para operar", operating: "Operando" } as const;
// Reportes / Clientes: puesta en marcha (platform_customer_readiness) + lifecycle footprint (platform_network_report),
// filtered by URL (q, status, readiness, step, attention, demo). Operational changes stay in Clientes.
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [session, params] = await Promise.all([platformSession(), searchParams]), generated = generatedAt(), path = platformReportPath("clientes");
  const filters = parseCustomerFilters(params);
  if (!filters.success) return <ReportFrame generated={generated}><ErrorState kind="validation" title="Los filtros no son válidos." description="La dirección trae filtros que no existen." action={<Link className="btn-secondary" href={path}>Limpiar filtros</Link>} /></ReportFrame>;
  const f = filters.data, [readiness, network] = await Promise.all([readReadiness(session), readNetwork(session, clientesNetworkArgs(f))]);
  if (readiness.kind !== "ready") return <ReadFailure kind={readiness.kind} />;
  if (network.kind !== "ready") return <ReadFailure kind={network.kind} />;
  const all = customerRows(readiness.value, network.value), rows = filterRows(all, f), truncated = readiness.value.truncated || network.value.truncated;
  return <ReportFrame generated={generated}>
    <ReportHeader back={{ href: platformReportPath(), label: "Reportes" }} title="Clientes" scope={f.demo ? "Red PIKAS · clientes reales y Demo" : "Red PIKAS · clientes reales (sin Demo)"} generated={generated}
      purpose="Cartera de clientes: ciclo de vida, presencia en la red y puesta en marcha de cada uno."
      filters={[...(f.q ? [{ label: "Búsqueda", value: f.q }] : []), { label: "Ciclo de vida", value: f.status ? lifecycleLabel(f.status) : "Todos" }, { label: "Puesta en marcha", value: f.readiness ? launchNames[f.readiness] : "Todas" },
        ...(f.step ? [{ label: "Paso pendiente", value: stepLabel[f.step] }] : []), ...(f.attention ? [{ label: "Requiere atención", value: "Sí" }] : []), { label: "Demo", value: f.demo ? "Incluida" : "Excluida" }]}
      csvHref={truncated ? undefined : reportHref(`${path}/csv`, f)} />
    <CustomersReportBody filters={f} all={all} rows={rows} truncated={truncated} />
  </ReportFrame>;
}
