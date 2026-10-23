import Link from "next/link";
import { z } from "zod";
import { customerListSchema } from "../../../lib/platform/customer-contracts";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { CustomerLink, LifecycleBadge, ReadFailure } from "../console-views";
import { AppPageHeader } from "../../../components/app-page-header";
import { DataList } from "../../../components/data-list";
import { EmptyState, ErrorState } from "../../../components/state-panels";
import { LaunchPill } from "../../../components/platform/cockpit";
import { READINESS_CAPABILITY, launchStatus, nextStep, readinessSchema, readinessSteps, type CustomerReadiness } from "../../../lib/platform/readiness";
import { structureSummary, workspaceHref } from "../../../lib/platform/workspace";
const filters = z.object({ q: z.string().max(80).default(""), status: z.enum(["active", "suspended", "closed", ""]).default(""), kind: z.enum(["customer", "sandbox", ""]).default(""), after: z.guid().optional() });
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes("platform:tenant:lifecycle:read")) return <ReadFailure kind="forbidden" />;
  const parsed = filters.safeParse(await searchParams);
  if (!parsed.success) return <ErrorState kind="validation" title="Los filtros no son válidos." description="La dirección trae filtros que no existen. Restablécelos para ver todos los clientes." action={<Link className="btn-secondary" href="/platform/clientes">Restablecer filtros</Link>} />;
  const { q, status, kind, after } = parsed.data;
  const result = await readPlatform(session, "platform:tenant:lifecycle:read", "platform_list_customers",
    { p_query: q, p_status: status || null, p_kind: kind || null, p_after: after ?? null, p_limit: 25 }, customerListSchema);
  // UX 15: launch status and next step beside each customer, from the readiness facts the operator may already read.
  const readiness = session.capabilities.includes(READINESS_CAPABILITY) ? await readPlatform(session, READINESS_CAPABILITY, "platform_customer_readiness", { p_account_id: null }, readinessSchema) : null;
  const launches = new Map<string, CustomerReadiness>(readiness?.kind === "ready" ? readiness.value.customers.filter(c => typeof c?.account_id === "string").map(c => [c.account_id, c] as const) : []);
  const launchCell = (c: { id: string; status: string; tenant_kind: string }) => {
    const l = launches.get(c.id); if (!l || c.tenant_kind !== "customer") return <span className="text-sm text-slate-500">—</span>;
    const steps = readinessSteps(l), st = launchStatus(l, steps), next = nextStep(steps);
    return <span className="flex flex-col gap-1"><LaunchPill status={st} lifecycle={c.status} /><span className="text-xs text-slate-600">{st === "operating" ? "Operando" : st === "ready" ? "Esperando la primera venta" : st === "inactive" ? "Puesta en marcha en pausa" : next ? `Siguiente: ${next.label} · ${next.owner === "PIKAS" ? "PIKAS" : "cafetería"}` : ""}</span></span>;
  };
  return <><AppPageHeader title="Clientes" description="Administra las organizaciones que usan PIKAS."
    action={session.capabilities.includes("platform:tenant:provision") && session.capabilities.includes("platform:customer_admin:provision") ? <Link className="btn" href="/platform/clientes/nuevo">Agregar colegio</Link> : undefined} />
    <form action="/platform/clientes" className="card flex flex-wrap items-end gap-4 p-5">
      <label className="min-w-0 flex-1 basis-48">Nombre o código<input className="field mt-1" name="q" defaultValue={q} maxLength={80} /></label>
      <label className="min-w-0 flex-1 basis-32">Estado<select className="field mt-1" name="status" defaultValue={status}><option value="">Todos</option><option value="active">Activos</option><option value="suspended">Suspendidos</option><option value="closed">Cerrados</option></select></label>
      <label className="min-w-0 flex-1 basis-32">Tipo<select className="field mt-1" name="kind" defaultValue={kind}><option value="">Todos</option><option value="customer">Clientes</option><option value="sandbox">Sandbox</option></select></label>
      <button className="btn">Buscar</button><Link className="btn-tertiary" href="/platform/clientes">Limpiar</Link>
    </form>
    {result.kind !== "ready" ? <ReadFailure kind={result.kind} failure={result.failure} reason={"reason" in result ? result.reason : undefined} /> : result.value.customers.length === 0
      ? <EmptyState title="No hay clientes que coincidan con esta búsqueda." description="Ajusta los filtros o límpialos para ver todos los clientes." />
      : <DataList label="Clientes" rows={result.value.customers} rowKey={(c) => c.id} columns={[
        { header: "Cliente", primary: true, cell: (c) => <><CustomerLink id={c.id} name={c.name} /><span className="block text-xs font-normal text-slate-500">Código interno {c.code}</span></> },
        { header: "Estado", cell: (c) => <LifecycleBadge status={c.status} /> },
        { header: "Puesta en marcha", cell: launchCell },
        { header: "Tipo", cell: (c) => <span className={`chip ${c.tenant_kind === "sandbox" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{c.tenant_kind === "sandbox" ? "Sandbox · Demostración" : "Cliente"}</span> },
        { header: "Estructura", cell: (c) => structureSummary(c) },
      ]} actions={(c) => <Link className="btn-secondary" href={workspaceHref(c.id)} aria-label={`Abrir ${c.name}`}>Abrir</Link>} />}
    {result.kind === "ready" && result.value.next_cursor && <Link className="btn-secondary" href={`/platform/clientes?${new URLSearchParams({ q, status, kind, after: result.value.next_cursor })}`}>Siguiente página</Link>}
  </>;
}
