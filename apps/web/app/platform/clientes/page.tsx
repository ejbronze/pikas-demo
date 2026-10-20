import Link from "next/link";
import { z } from "zod";
import { customerListSchema } from "../../../lib/platform/customer-contracts";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { CustomerLink, LifecycleBadge, ReadFailure } from "../console-views";
import { AppPageHeader } from "../../../components/app-page-header";
import { DataList } from "../../../components/data-list";
import { EmptyState, ErrorState } from "../../../components/state-panels";
const filters = z.object({ q: z.string().max(80).default(""), status: z.enum(["active", "suspended", "closed", ""]).default(""), kind: z.enum(["customer", "sandbox", ""]).default(""), after: z.guid().optional() });
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes("platform:tenant:lifecycle:read")) return <ReadFailure kind="forbidden" />;
  const parsed = filters.safeParse(await searchParams);
  if (!parsed.success) return <ErrorState title="Los filtros no son válidos." retry={<Link className="btn-secondary" href="/platform/clientes">Limpiar filtros</Link>} />;
  const { q, status, kind, after } = parsed.data;
  const result = await readPlatform(session, "platform:tenant:lifecycle:read", "platform_list_customers",
    { p_query: q, p_status: status || null, p_kind: kind || null, p_after: after ?? null, p_limit: 25 }, customerListSchema);
  return <><AppPageHeader title="Clientes" description="Administra las organizaciones que usan PIKAS."
    action={session.capabilities.includes("platform:tenant:provision") && session.capabilities.includes("platform:customer_admin:provision") ? <Link className="btn" href="/platform/clientes/nuevo">Agregar colegio</Link> : undefined} />
    <form action="/platform/clientes" className="card flex flex-wrap items-end gap-4 p-5">
      <label className="min-w-0 flex-1 basis-48">Nombre o código<input className="field mt-1" name="q" defaultValue={q} maxLength={80} /></label>
      <label className="min-w-0 flex-1 basis-32">Estado<select className="field mt-1" name="status" defaultValue={status}><option value="">Todos</option><option value="active">Activos</option><option value="suspended">Suspendidos</option><option value="closed">Cerrados</option></select></label>
      <label className="min-w-0 flex-1 basis-32">Tipo<select className="field mt-1" name="kind" defaultValue={kind}><option value="">Todos</option><option value="customer">Clientes</option><option value="sandbox">Sandbox</option></select></label>
      <button className="btn">Buscar</button><Link className="btn-tertiary" href="/platform/clientes">Limpiar</Link>
    </form>
    {result.kind !== "ready" ? <ReadFailure kind={result.kind} /> : result.value.customers.length === 0
      ? <EmptyState title="No hay clientes que coincidan con esta búsqueda." description="Ajusta los filtros o límpialos para ver todos los clientes." />
      : <DataList label="Clientes" rows={result.value.customers} rowKey={(c) => c.id} columns={[
        { header: "Cliente", primary: true, cell: (c) => <><CustomerLink id={c.id} name={c.name} /><span className="block text-sm font-normal text-slate-600">{c.code}</span></> },
        { header: "Estado", cell: (c) => <LifecycleBadge status={c.status} /> },
        { header: "Tipo", cell: (c) => <span className={`chip ${c.tenant_kind === "sandbox" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{c.tenant_kind === "sandbox" ? "Sandbox · Demostración" : "Cliente"}</span> },
        { header: "Estructura", cell: (c) => `${c.school_count} escuelas · ${c.location_count} ubicaciones · ${c.cafeteria_count} cafeterías` },
      ]} />}
    {result.kind === "ready" && result.value.next_cursor && <Link className="btn-secondary" href={`/platform/clientes?${new URLSearchParams({ q, status, kind, after: result.value.next_cursor })}`}>Siguiente página</Link>}
  </>;
}
