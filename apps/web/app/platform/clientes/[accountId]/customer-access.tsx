import Link from "next/link";
import { accessStatus, grantLabel, linkStatus, loginStatus, membershipStatusLabel, pendingStatus, roleLabel, supportDate, type AccessPerson, type CustomerAccess, type PendingAccess } from "../../../../lib/platform/customer-access";

// Backoffice "Usuarios y accesos": display only. No role, membership, identity or activation action
// lives here; credential support stays in Identidades and initial-admin activation in its section.
const tone: Record<string, string> = { Activo: "bg-emerald-100 text-emerald-900", Suspendido: "bg-amber-100 text-amber-950", Inactivo: "bg-slate-200 text-slate-900" };
const Row = ({ label, value }: { label: string; value: React.ReactNode }) =>
  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"><dt className="text-sm text-slate-600">{label}</dt><dd className="min-w-0 break-words text-right font-semibold">{value}</dd></div>;

function PersonCard({ person, identities }: { person: AccessPerson; identities: boolean }) {
  const access = accessStatus(person), login = loginStatus(person), last = supportDate(person.last_sign_in_at);
  return <li className="rounded-xl border">
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1 basis-56 space-y-2">
          <p className="break-words font-bold">{person.display_name}</p>
          <ul className="flex flex-wrap gap-1.5" aria-label={`Roles de ${person.display_name}`}>{person.grants.map(g => <li key={g.membership_id} className={`chip max-w-full whitespace-normal break-words text-left ${g.status === "active" ? "bg-indigo-50 text-indigo-950" : "bg-slate-100 text-slate-600"}`}>{grantLabel(g)}{g.status !== "active" ? ` · ${membershipStatusLabel(g.status)}` : ""}</li>)}</ul>
          <p className="break-all text-sm text-slate-600">{[person.username && `Usuario ${person.username}`, person.email].filter(Boolean).join(" · ") || "Sin usuario ni correo registrados"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm"><span className={`chip ${tone[access]}`}>{access}</span><span className="chip bg-slate-100 text-slate-800">{login}{login === "Activo" && last ? ` · ${last}` : ""}</span>
          <span className="text-indigo-800 underline group-open:hidden">Ver detalle</span><span className="hidden text-indigo-800 underline group-open:inline">Ocultar detalle</span></div>
      </summary>
      <div className="space-y-4 border-t px-4 py-3">
        <section aria-label={`Accesos de ${person.display_name}`} className="space-y-2"><h4 className="font-black">Accesos</h4>
          <ul className="space-y-2">{person.grants.map(g => <li key={g.membership_id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-bold">{roleLabel(g.role_code)}</p>
            <p className="break-words text-slate-700">{g.scope === "account" ? "Todo el cliente" : g.scope === "school" ? `Colegio ${g.school_name ?? ""}` : `${g.cafeteria_name ?? "Cafetería"}${g.location_name ? ` · ${g.location_name}` : ""}`} · {membershipStatusLabel(g.status)}{supportDate(g.created_at) ? ` · desde ${supportDate(g.created_at)}` : ""}</p>
            {g.scope === "cafeteria" && <p className="break-words text-slate-700">{g.registers.length ? `Cajas: ${g.registers.map(r => `${r.name}${r.assignment_status !== "active" ? ` (${membershipStatusLabel(r.assignment_status).toLowerCase()})` : ""}`).join(", ")}` : "Sin cajas asignadas"}</p>}
          </li>)}</ul></section>
        <dl className="divide-y rounded-lg border px-3 text-sm" aria-label={`Inicio de sesión de ${person.display_name}`}>
          <Row label="Usuario" value={person.username ?? "No registrado"} /><Row label="Correo" value={<span className="break-all">{person.email ?? "No registrado"}</span>} />
          {person.phone && <Row label="Teléfono" value={person.phone} />}
          <Row label="Correo confirmado" value={person.has_login ? (person.email_confirmed ? "Sí" : "No") : "—"} />
          <Row label="Último ingreso" value={last ?? "Nunca"} />
          <Row label="Cambio de contraseña pendiente" value={person.must_change_password ? "Sí" : "No"} />
          <Row label="Inicio de sesión suspendido" value={person.login_suspended ? "Sí" : "No"} />
          {person.email_change_pending && <Row label="Cambio de correo" value="Pendiente de confirmar" />}
          {person.temporary_issued_at && <Row label="Contraseña temporal emitida" value={supportDate(person.temporary_issued_at)} />}
        </dl>
        {identities && person.has_login && (person.username || person.email) && <p className="text-sm"><Link className="font-bold text-indigo-800 underline" href="/platform/identidades">Abrir Identidades</Link> y busca «{person.username ?? person.email}» para soporte de credenciales.</p>}
      </div>
    </details>
  </li>;
}

function PendingCard({ item }: { item: PendingAccess }) {
  const link = linkStatus(item.link_state), where = item.cafeteria_name ?? item.school_name;
  return <li className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-bold">{roleLabel(item.role_code)}{where ? ` · ${where}` : ""}</p>
      <div className="flex flex-wrap gap-1.5 text-sm"><span className="chip bg-amber-100 text-amber-950">{pendingStatus(item)}</span>{link && !item.request_expired && <span className="chip bg-slate-100 text-slate-800">{link}</span>}</div></div>
    <p className="break-all text-sm text-slate-700">{item.email}{item.username ? ` · Usuario reservado ${item.username}` : ""}</p>
    <p className="text-sm text-slate-600">{item.kind === "initial_admin" ? "Solicitud de PIKAS" : "Invitación del cliente"}{supportDate(item.created_at) ? ` · creada ${supportDate(item.created_at)}` : ""}{supportDate(item.expires_at) ? ` · vence ${supportDate(item.expires_at)}` : ""}</p>
  </li>;
}

export function CustomerAccessSection({ access, identities }: { access: CustomerAccess | null; identities: boolean }) {
  return <section aria-labelledby="customer-access" className="card space-y-4 p-5">
    <div><h2 id="customer-access" className="text-lg font-bold">Usuarios y accesos</h2><p className="text-sm text-slate-600">Personal del cliente con acceso a PIKAS y accesos pendientes. Solo consulta.</p></div>
    {!access ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">No pudimos cargar los accesos de este cliente. Vuelve a intentarlo.</p> : <>
      <section aria-labelledby="access-people" className="space-y-2"><h3 id="access-people" className="font-black">Usuarios con acceso <span className="font-normal text-slate-600">({access.people.length})</span></h3>
        {access.people.length ? <ul className="space-y-2">{access.people.map(p => <PersonCard key={p.person_id} person={p} identities={identities} />)}</ul>
          : <p className="rounded-lg bg-slate-50 p-3 text-sm">{access.pending.length ? "No hay usuarios con acceso activo para este cliente." : "Aún no se ha dado acceso al personal de este cliente. Cuando el administrador del colegio active su acceso o se invite personal, aparecerá aquí."}</p>}
      </section>
      {access.pending.length > 0 && <section aria-labelledby="access-pending" className="space-y-2"><h3 id="access-pending" className="font-black">Pendientes <span className="font-normal text-slate-600">({access.pending.length})</span></h3>
        <ul className="space-y-2">{access.pending.map(item => <PendingCard key={item.request_id} item={item} />)}</ul></section>}
    </>}
  </section>;
}
