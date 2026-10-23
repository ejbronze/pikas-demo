import { ErrorState, EmptyState } from "../../../../components/state-panels";
import { CompleteStaffAction, StaffActivationAction } from "./access-actions";
import { PeopleList } from "../../../../components/platform/people-list";
import { AddStaffAccessAction, type StaffCafeteria } from "../../../../components/platform/staff-access-task";
import { linkStatus, pendingStatus, roleLabel, supportDate, type CustomerAccess, type PendingAccess } from "../../../../lib/platform/customer-access";

// Personas y accesos (UX 15+16). People of the customer as rows that open in a sheet (identity,
// accesos, cajas, credentials, bounded support actions); pending accesses beneath with their
// recovery. New Personal POS is created in one step (the canonical workflow); the link-based
// preparation is no longer offered, only recovered where a pending invitation still exists.
export type AccessActions = { accountId: string; provision: boolean; rename: boolean; cafeterias: StaffCafeteria[]; staffAccess: boolean };

function PendingCard({ item, actions }: { item: PendingAccess; actions: AccessActions }) {
  const staff = item.kind === "invitation" && ["pos_cashier", "pos_supervisor"].includes(item.role_code) && !!item.cafeteria_id && !item.request_expired;
  const link = linkStatus(item.link_state), where = item.cafeteria_name ?? item.school_name;
  return <li className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-bold">{roleLabel(item.role_code)}{where ? ` · ${where}` : ""}</p>
      <div className="flex flex-wrap gap-1.5 text-sm"><span className="chip bg-amber-100 text-amber-950">{pendingStatus(item)}</span>{link && !item.request_expired && <span className="chip bg-slate-100 text-slate-800">{link}</span>}</div></div>
    <p className="break-all text-sm text-slate-700">{item.email}{item.username ? ` · Usuario reservado ${item.username}` : ""}</p>
    {item.intended_display_name && <p className="break-words text-sm font-semibold">{item.intended_display_name}</p>}
    <p className="text-sm text-slate-600">{item.kind === "initial_admin" ? "Solicitud de PIKAS" : "Invitación del cliente"}{supportDate(item.created_at) ? ` · creada ${supportDate(item.created_at)}` : ""}{supportDate(item.expires_at) ? ` · vence ${supportDate(item.expires_at)}` : ""}</p>
    {item.kind === "initial_admin" && <p className="text-sm text-slate-600">Se activa y completa en <a className="font-semibold text-indigo-700 underline underline-offset-4" href="#administrador-inicial">Administrador inicial</a>.</p>}
    {item.request_expired && item.kind === "invitation" && <p className="text-sm text-slate-600">Venció sin usarse. Si la persona todavía necesita acceso, créalo de nuevo con «Agregar personal POS».</p>}
    {staff && actions.provision && <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
      <StaffActivationAction accountId={actions.accountId} cafeteriaId={item.cafeteria_id!} invitationId={item.request_id} hasLink={item.link_state === "active" || item.link_state === "expired"} />
      <CompleteStaffAction accountId={actions.accountId} cafeteriaId={item.cafeteria_id!} invitationId={item.request_id} intendedName={item.intended_display_name ?? null} ready={item.identity_state === "ready"} />
    </div>}
  </li>;
}

export function CustomerAccessSection({ access, identities, actions, openPerson = null, customerName = "" }: { access: CustomerAccess | null; identities: boolean; actions: AccessActions; openPerson?: string | null; customerName?: string }) {
  const canAdd = actions.provision && actions.staffAccess && actions.cafeterias.length > 0;
  return <section id="customer-access" aria-labelledby="customer-access-title" className="card scroll-mt-24 space-y-4 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 basis-60"><h2 id="customer-access-title" className="text-lg font-bold">Personas y accesos</h2>
      <p className="text-sm text-slate-600">{actions.provision ? "Personal del cliente con acceso a PIKAS. Abre una persona para ver sus accesos, sus cajas y sus credenciales. Desde aquí PIKAS crea Personal POS y da acceso de administrador de cafetería." : "Personal del cliente con acceso a PIKAS y accesos pendientes. Solo consulta."}</p></div>
      {access && canAdd && <AddStaffAccessAction accountId={actions.accountId} customerName={customerName} cafeterias={actions.cafeterias} />}</div>
    {actions.provision && !actions.staffAccess && access && actions.cafeterias.length > 0 && <p className="text-sm text-slate-600">Crear Personal POS requiere también soporte de identidad (la contraseña temporal). Pide el acceso a un administrador de la plataforma o deja que el administrador de la cafetería lo cree desde Personal POS.</p>}
    {!access ? <ErrorState title="No pudimos cargar los accesos de este cliente." description="Actualiza la página para intentarlo de nuevo. El resto del cliente se muestra con normalidad." /> : <>
      <section aria-labelledby="access-people" className="space-y-2"><h3 id="access-people" className="font-black">Usuarios con acceso <span className="font-normal text-slate-600">({access.people.length})</span></h3>
        {access.people.length ? <PeopleList people={access.people} customerName={customerName} identities={identities} openPerson={openPerson} actions={{ accountId: actions.accountId, provision: actions.provision, rename: actions.rename, cafeterias: actions.cafeterias.map(c => ({ id: c.id, name: c.name })) }} />
          : <EmptyState title={access.pending.length ? "No hay usuarios con acceso activo para este cliente." : "Aún no se ha dado acceso al personal de este cliente."} description={access.pending.length ? "Los accesos pendientes aparecen abajo con su estado y su siguiente paso." : "Cuando el administrador del colegio active su acceso o PIKAS cree Personal POS, aparecerán aquí."} />}
      </section>
      {access.pending.length > 0 && <section aria-labelledby="access-pending" className="space-y-2"><h3 id="access-pending" className="font-black">Pendientes <span className="font-normal text-slate-600">({access.pending.length})</span></h3>
        <ul className="space-y-2">{access.pending.map(item => <PendingCard key={item.request_id} item={item} actions={actions} />)}</ul></section>}
    </>}
  </section>;
}
