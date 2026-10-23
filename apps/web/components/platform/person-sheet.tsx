"use client";
import { useRef, useState } from "react";
import { TaskActions, TaskCancelButton, TaskSummary, TaskWindow } from "../task-window";
import { ErrorState } from "../state-panels";
import { IdentityCredentials, IdentityRequestFailure, identityRequest } from "../identity-credentials";
import { isInternalEmail } from "../../lib/identity/staff-access";
import type { IdentitySummary } from "../../lib/identity/contracts";
import type { FailureKind } from "../../lib/ux/state-classes";
import { accessStatus, loginStatus, membershipStatusLabel, roleLabel, supportDate, type AccessPerson } from "../../lib/platform/customer-access";
import { GrantCafeteriaAdminAction, RenamePersonAction } from "../../app/platform/clientes/[accountId]/access-actions";
import { AddPosAccessAction, AssignmentActions, MembershipStatusActions, type SheetCafeteria } from "./access-lifecycle-actions";
import { membershipWord } from "../../lib/platform/lifecycle-access";

// UX 15+16: one person of the customer, in context. Identity, every access the person holds
// (operational words: role · where · state · cajas), POS context, the bounded support actions, and
// Credenciales opened right here (platform:identity:support) — no copying an email into Identidades.
// A window within the workspace: the customer stays visible behind the sheet on wide screens.
// provision: grants (active customers only). lifecycle: suspend/deactivate/reactivate an existing access (active or suspended customers). assign: caja assignment (operations:manage, active customers).
export type SheetActions = { accountId: string; provision: boolean; rename: boolean; cafeterias: SheetCafeteria[]; assign?: boolean; lifecycle?: boolean };
// «Sede Santiago», not «Sede Sede Santiago»: real names often already carry their level word.
const withLevel = (level: string, name: string) => name.trim().toLocaleLowerCase("es").startsWith(level.toLocaleLowerCase("es")) ? name : `${level} ${name}`;
const tone: Record<string, string> = { Activo: "bg-emerald-100 text-emerald-900", Suspendido: "bg-amber-100 text-amber-950", Inactivo: "bg-slate-200 text-slate-900" };

export function PersonSheet({ person, customerName, identities, actions, onClose }: { person: AccessPerson; customerName: string; identities: boolean; actions: SheetActions; onClose: () => void }) {
  const [view, setView] = useState<"person" | "credentials">("person");
  const [credentials, setCredentials] = useState<{ summary?: IdentitySummary; error?: { message: string; kind: FailureKind } }>({});
  const loading = useRef(false);
  const access = accessStatus(person), login = loginStatus(person), last = supportDate(person.last_sign_in_at);
  const grantable = actions.cafeterias.filter(c => !person.grants.some(g => g.role_code === "cafeteria_admin" && g.cafeteria_id === c.id));
  const canCredentials = identities && person.has_login;
  // Credentials load once, when the operator asks for them; the sheet stays mounted meanwhile.
  const openCredentials = () => {
    setView("credentials");
    if (credentials.summary || loading.current) return;
    loading.current = true; setCredentials({});
    identityRequest({ operation: "read", person_id: person.person_id }).then(r => setCredentials(r.summary ? { summary: r.summary } : { error: { message: "No encontramos la identidad de esta persona.", kind: "not_found" } }),
      e => setCredentials({ error: { message: e instanceof Error ? e.message : "No se pudo cargar.", kind: e instanceof IdentityRequestFailure ? e.kind : "temporary" } })).finally(() => { loading.current = false; });
  };
  const footer = view === "credentials"
    ? <TaskActions><button type="button" className="btn-secondary" onClick={() => setView("person")}>Volver a la persona</button><TaskCancelButton>Cerrar</TaskCancelButton></TaskActions>
    : <TaskActions>{canCredentials && <button type="button" className="btn" onClick={openCredentials}>Credenciales</button>}<TaskCancelButton>Cerrar</TaskCancelButton></TaskActions>;
  return <TaskWindow variant="sheet" title={person.display_name} context={<span><span className="font-bold">{customerName}</span> → Personas → {view === "credentials" ? "Credenciales" : person.display_name}</span>} onClose={onClose} footer={footer}>
    {view === "credentials" ? (credentials.summary ? <IdentityCredentials key={credentials.summary.person_id} initial={credentials.summary} />
        : credentials.error ? <ErrorState kind={credentials.error.kind} title={credentials.error.message} description={credentials.error.kind === "permission" ? "Lo administra un administrador de la plataforma; el soporte de identidad requiere su propio permiso." : credentials.error.kind === "temporary" ? "Vuelve a la persona e inténtalo de nuevo." : undefined} />
        : <p role="status">Cargando credenciales…</p>)
      : <div className="space-y-5" data-person={person.person_id}>
        <section aria-label="Identidad" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm"><span className={`chip ${tone[access]}`}>{access}</span><span className="chip bg-slate-100 text-slate-800">{login}{login === "Activo" && last ? ` · ${last}` : ""}</span></div>
          <TaskSummary rows={[
            ["Usuario", person.username ?? <span className="font-normal text-slate-600">Sin usuario</span>],
            ["Correo", <span key="e" className="break-all">{!person.email || isInternalEmail(person.email) ? "Sin correo · entra solo con su usuario" : person.email}</span>],
            ...(person.phone ? [["Teléfono", person.phone] as [string, React.ReactNode]] : []),
            ["Último ingreso", last ?? "Nunca"],
            ...(person.must_change_password ? [["Contraseña", person.temporary_issued_at ? `Temporal emitida ${supportDate(person.temporary_issued_at) ?? ""}` : "Cambio pendiente"] as [string, React.ReactNode]] : []),
            ...(person.login_suspended ? [["Inicio de sesión", "Suspendido por PIKAS"] as [string, React.ReactNode]] : []),
            ...(person.email_change_pending ? [["Cambio de correo", "Pendiente de confirmar"] as [string, React.ReactNode]] : []),
          ]} />
        </section>
        <section aria-labelledby={`accesos-${person.person_id}`} className="space-y-2"><h3 id={`accesos-${person.person_id}`} className="font-black">Accesos</h3>
          {person.grants.length === 0 ? <p className="text-sm text-slate-600">Sin accesos en este cliente.</p> : <ul className="space-y-2">{person.grants.map(g => <li key={g.membership_id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-bold">{g.scope === "cafeteria" ? g.cafeteria_name ?? "Cafetería" : g.scope === "school" ? g.school_name ?? "Colegio" : customerName} · {roleLabel(g.role_code)}</p>
            <p className="text-slate-700">{g.scope === "account" ? "Todo el cliente" : g.scope === "school" ? "Colegio" : g.location_name ? withLevel("Sede", g.location_name) : "Cafetería"} · {membershipStatusLabel(g.status)}{supportDate(g.created_at) ? ` · desde ${supportDate(g.created_at)}` : ""}</p>
            {g.scope === "cafeteria" && ["pos_cashier", "pos_supervisor", "pos_operator"].includes(g.role_code) && <p className="text-slate-700">{g.registers.length ? `Cajas: ${g.registers.map(r => `${r.name}${r.assignment_status !== "active" ? ` (${membershipStatusLabel(r.assignment_status).toLowerCase()})` : ""}`).join(", ")}` : "Sin caja asignada · la asigna el administrador de la cafetería en Cajas"}</p>}
            {g.status !== "active" && <p className="text-amber-950">{membershipWord[g.status] ?? g.status}{g.status === "suspended" ? " · temporal, reversible" : " · reversible desde aquí"}</p>}
            {(actions.lifecycle || actions.assign) && <div className="mt-2 space-y-2">{actions.lifecycle && <MembershipStatusActions accountId={actions.accountId} grant={g} customerName={customerName} personName={person.display_name} />}
              {actions.assign && <AssignmentActions accountId={actions.accountId} grant={g} personName={person.display_name} cafeterias={actions.cafeterias} />}</div>}
          </li>)}</ul>}
          <p className="text-xs text-slate-500">Los accesos del colegio (estudiantes, familias) los administra el colegio; los de la cafetería, su administrador. PIKAS da acceso de administrador de cafetería y crea Personal POS cuando el cliente lo pide.</p>
        </section>
        {(actions.rename || (actions.provision && person.has_login)) && <section aria-label="Acciones de soporte" className="flex flex-wrap gap-2 border-t pt-3">
          {actions.provision && person.has_login && <AddPosAccessAction accountId={actions.accountId} personId={person.person_id} personName={person.display_name} grants={person.grants} cafeterias={actions.cafeterias} canAssign={!!actions.assign} />}
          {actions.provision && person.has_login && grantable.length > 0 && <GrantCafeteriaAdminAction accountId={actions.accountId} personId={person.person_id} personName={person.display_name} cafeterias={grantable} />}
          {actions.rename && <RenamePersonAction accountId={actions.accountId} personId={person.person_id} currentName={person.display_name} />}
        </section>}
        {identities && !person.has_login && <p className="text-sm text-slate-600">Esta persona no tiene inicio de sesión: no hay credenciales que gestionar.</p>}
      </div>}
  </TaskWindow>;
}
