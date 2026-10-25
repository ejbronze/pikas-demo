import Link from "next/link";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { AppPageHeader } from "../../../components/app-page-header";
import { EmptyState, ErrorState, LoadFailure } from "../../../components/state-panels";
import { SUPPORT_READ, categories, categoryLabel, platformFiltersSchema, platformListSchema, roleLabel, statusLabel, statuses, type PlatformTicketRow } from "../../../lib/support/contracts";
import { SupportStatusBadge, supportWhen } from "./support-views";

// Soporte / Tickets: the queue of customer reports. Open tickets first (Recibido, En revisión, Necesitamos información),
// newest activity first. Filters live in the URL; the database applies them under platform:support:read.
export default async function SupportQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes(SUPPORT_READ)) return <ErrorState kind="permission" title="No tienes acceso a Soporte." description="Pide a un administrador de PIKAS el permiso de lectura de soporte." />;
  const parsed = platformFiltersSchema.safeParse(await searchParams);
  if (!parsed.success) return <ErrorState kind="validation" title="Los filtros no son válidos." description="Restablécelos para ver los tickets." action={<Link className="btn-secondary" href="/platform/soporte">Restablecer filtros</Link>} />;
  const { estado, categoria, q } = parsed.data;
  const result = await readPlatform(session, SUPPORT_READ, "platform_support_list", { p_status: estado, p_category: categoria ?? null, p_query: q || null }, platformListSchema);
  const counts = result.kind === "ready" ? result.value.counts ?? {} : {};
  const open = (counts.received ?? 0) + (counts.in_review ?? 0) + (counts.info_requested ?? 0);
  const filtered = estado !== "open" || !!categoria || !!q;
  return <>
    <AppPageHeader title="Soporte" description="Reportes de colegios, cafeterías y cajas. Responde, pide información, resuelve y cierra; cada paso queda en el historial del ticket." />
    {result.kind === "ready" && <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {([["Abiertos", open], ["Recibidos", counts.received ?? 0], ["Necesitan información", counts.info_requested ?? 0], ["Resueltos", counts.resolved ?? 0]] as const).map(([label, n]) =>
        <div key={label} className="card p-4"><dt className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</dt><dd className="text-2xl font-black">{n}</dd></div>)}
    </dl>}
    <form action="/platform/soporte" className="card flex flex-wrap items-end gap-4 p-5" role="search">
      <label className="min-w-0 flex-1 basis-56">Referencia, asunto, cliente o persona<input className="field mt-1 w-full" name="q" defaultValue={q} maxLength={100} placeholder="SOP-000001" /></label>
      <label className="basis-44">Estado<select className="field mt-1 w-full" name="estado" defaultValue={estado}>
        <option value="open">Abiertos</option><option value="all">Todos</option>{statuses.map(s => <option key={s} value={s}>{statusLabel[s]}</option>)}</select></label>
      <label className="basis-44">Categoría<select className="field mt-1 w-full" name="categoria" defaultValue={categoria ?? ""}>
        <option value="">Todas</option>{categories.map(c => <option key={c} value={c}>{categoryLabel[c]}</option>)}</select></label>
      <button className="btn">Filtrar</button>{filtered && <Link className="btn-tertiary" href="/platform/soporte">Limpiar</Link>}
    </form>
    {result.kind !== "ready" ? <LoadFailure kind={result.failure} what="los tickets de soporte" retryHref="/platform/soporte" />
      : result.value.rows.length === 0 ? <EmptyState title={filtered ? "No hay tickets que coincidan." : "No hay tickets abiertos."} description={filtered ? "Cambia o limpia los filtros." : "Cuando un cliente reporte un problema, aparecerá aquí."} />
      : <ul className="space-y-3" aria-label="Tickets">{result.value.rows.map(r => <TicketRow key={r.id} row={r} />)}</ul>}
  </>;
}

function TicketRow({ row }: { row: PlatformTicketRow }) {
  const where = [row.cafeteria_name, row.school_name].filter(Boolean).join(" · ");
  return <li className="card p-4"><Link href={`/platform/soporte/${row.id}`} className="flex flex-wrap items-start justify-between gap-3">
    <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-500">{row.reference} · {categoryLabel[row.category]}</span>
      <span className="block break-words font-bold text-indigo-900 underline-offset-2 hover:underline">{row.subject}</span>
      <span className="block text-sm text-slate-600">{row.account_name}{where && ` · ${where}`} · {row.reporter_name} ({roleLabel[row.reporter_role] ?? row.reporter_role})</span></span>
    <span className="flex flex-col items-end gap-1"><SupportStatusBadge status={row.status} /><span className="text-xs text-slate-500">{supportWhen(row.updated_at)}</span></span>
  </Link></li>;
}
