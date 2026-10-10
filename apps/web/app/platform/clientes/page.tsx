import Link from "next/link";
import { z } from "zod";
import { customerListSchema, statusLabel } from "../../../lib/platform/customer-contracts";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { CustomerLink, ReadFailure } from "../console-views";
const filters = z.object({ q: z.string().max(80).default(""), status: z.enum(["active", "suspended", "inactive", ""]).default(""), kind: z.enum(["customer", "sandbox", ""]).default(""), after: z.uuid().optional() });
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes("platform:tenant:lifecycle:read")) return <ReadFailure kind="forbidden" />;
  const parsed = filters.safeParse(await searchParams);
  if (!parsed.success) return <><p role="alert">Los filtros no son válidos.</p><Link href="/platform/clientes">Limpiar filtros</Link></>;
  const { q, status, kind, after } = parsed.data;
  const result = await readPlatform(session, "platform:tenant:lifecycle:read", "platform_list_customers",
    { p_query: q, p_status: status || null, p_kind: kind || null, p_after: after ?? null, p_limit: 25 }, customerListSchema);
  return <><div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-bold">Clientes</h1>
    {session.capabilities.includes("platform:tenant:provision") && session.capabilities.includes("platform:customer_admin:provision") && <Link className="btn" href="/platform/clientes/nuevo">Nuevo cliente</Link>}</div>
    <form action="/platform/clientes" className="card flex flex-wrap items-end gap-4 p-5">
      <label>Nombre o código<input className="field mt-1" name="q" defaultValue={q} maxLength={80} /></label>
      <label>Estado<select className="field mt-1" name="status" defaultValue={status}><option value="">Todos</option><option value="active">Activos</option><option value="suspended">Suspendidos</option><option value="inactive">Inactivos</option></select></label>
      <label>Tipo<select className="field mt-1" name="kind" defaultValue={kind}><option value="">Todos</option><option value="customer">Clientes</option><option value="sandbox">Sandbox</option></select></label>
      <button className="btn">Buscar</button><Link href="/platform/clientes">Limpiar</Link>
    </form>
    {result.kind !== "ready" ? <ReadFailure kind={result.kind} /> : result.value.customers.length === 0 ? <p className="card p-5">No hay clientes que coincidan con esta búsqueda.</p> : <ul className="space-y-3">{result.value.customers.map((customer) => <li className="card flex flex-wrap justify-between gap-3 p-5" key={customer.id}>
      <div><CustomerLink id={customer.id} name={customer.name} /><p className="text-sm text-slate-600">{customer.code} · {statusLabel[customer.status]}</p><span className={`chip mt-2 ${customer.tenant_kind === "sandbox" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{customer.tenant_kind === "sandbox" ? "Sandbox · Demostración" : "Cliente"}</span></div>
      <p className="text-sm text-slate-600">{customer.school_count} escuelas · {customer.location_count} ubicaciones · {customer.cafeteria_count} cafeterías</p>
    </li>)}</ul>}
    {result.kind === "ready" && result.value.next_cursor && <Link className="btn-outline" href={`/platform/clientes?${new URLSearchParams({ q, status, kind, after: result.value.next_cursor })}`}>Siguiente página</Link>}
  </>;
}
