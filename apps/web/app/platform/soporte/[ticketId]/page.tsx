import { createHash } from "node:crypto";
import Link from "next/link";
import { z } from "zod";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { AppPageHeader } from "../../../../components/app-page-header";
import { ErrorState, LoadFailure } from "../../../../components/state-panels";
import { TaskSummary } from "../../../../components/task-window";
import { SUPPORT_MANAGE, SUPPORT_READ, actionsFor, categoryLabel, eventLabel, platformTicketSchema, roleLabel, statusLabel } from "../../../../lib/support/contracts";
import { SupportStatusBadge, supportWhen } from "../support-views";
import { SupportActions } from "./support-actions";

// One ticket: what the customer reported, the full timeline (internal notes marked) and the actions its status allows.
export default async function SupportTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const session = await requirePlatform();
  const back = <Link className="btn-tertiary" href="/platform/soporte">Volver a Soporte</Link>;
  if (!session.capabilities.includes(SUPPORT_READ)) return <ErrorState kind="permission" title="No tienes acceso a Soporte." />;
  const id = z.uuid().safeParse((await params).ticketId);
  if (!id.success) return <ErrorState kind="not_found" title="No encontramos ese ticket." action={back} />;
  const result = await readPlatform(session, SUPPORT_READ, "platform_support_ticket", { p_ticket_id: id.data }, platformTicketSchema);
  if (result.kind === "missing") return <ErrorState kind="not_found" title="No encontramos ese ticket." action={back} />;
  if (result.kind !== "ready") return <LoadFailure kind={result.failure} what="el ticket" retryHref={`/platform/soporte/${id.data}`} />;
  const t = result.value;
  const actor = createHash("sha256").update(`support:${session.identity.person.id}`).digest("hex").slice(0, 24);
  const canManage = t.can_manage && session.capabilities.includes(SUPPORT_MANAGE);
  return <>
    <AppPageHeader title={t.subject} description={`${t.reference} · ${categoryLabel[t.category]}`} back={{ href: "/platform/soporte", label: "Soporte" }} meta={<SupportStatusBadge status={t.status} />} />
    <TaskSummary rows={[["Cliente", <Link key="c" className="underline" href={`/platform/clientes/${t.account_id}`}>{t.account_name}</Link>],
      ...(t.school_name ? [["Colegio", t.school_name] as [string, React.ReactNode]] : []), ...(t.cafeteria_name ? [["Cafetería", t.cafeteria_name] as [string, React.ReactNode]] : []),
      ["Reportado por", `${t.reporter_name} · ${roleLabel[t.reporter_role] ?? t.reporter_role}`], ["Recibido", supportWhen(t.created_at)], ["Estado", statusLabel[t.status]],
      ...(t.page_path ? [["Página", t.page_path] as [string, React.ReactNode]] : [])]} />
    <section className="card space-y-2 p-5" aria-labelledby="descripcion"><h2 id="descripcion" className="font-bold">Lo que reportó</h2><p className="whitespace-pre-wrap break-words text-sm">{t.description}</p></section>
    {canManage ? <SupportActions actor={actor} ticketId={t.id} reference={t.reference} actions={actionsFor(t.status)} />
      : <p className="card p-4 text-sm">Puedes leer este ticket. Gestionarlo requiere el permiso de gestión de soporte.</p>}
    <section aria-labelledby="historial" className="space-y-3">
      <h2 id="historial" className="text-lg font-bold">Historial</h2>
      <ol className="space-y-3">{t.events.map((e, i) => <li key={i} className={`card p-4 ${e.visibility === "internal" ? "border-dashed border-amber-400 bg-amber-50/50" : ""}`}>
        <p className="text-xs text-slate-500">{supportWhen(e.created_at)} · {e.author} · {eventLabel[e.kind] ?? e.kind}{e.visibility === "internal" && " · Solo PIKAS"}
          {e.from_status && e.to_status && e.from_status !== e.to_status && ` · ${statusLabel[e.from_status as keyof typeof statusLabel] ?? e.from_status} → ${statusLabel[e.to_status as keyof typeof statusLabel] ?? e.to_status}`}</p>
        {e.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{e.body}</p>}</li>)}</ol>
    </section>
  </>;
}
