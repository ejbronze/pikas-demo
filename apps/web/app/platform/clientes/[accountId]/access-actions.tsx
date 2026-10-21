"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sessionFetch } from "../../../../lib/auth/session-fetch";
import { grantResultSchema, provisioningMessages, renamePersonResultSchema, renamePersonSchema, staffCommandSchema, staffResultSchema, type StaffCommand } from "../../../../lib/platform/customer-provisioning";
import { usernameRejectionMessage } from "../../../../lib/identity/provisioning";
import { ProvisioningUsernameField } from "../../../../components/provisioning-username-field";
import { TaskActions, TaskCancelButton, TaskOutcome, TaskWindow } from "../../../../components/task-window";
import { useKeyedSend } from "./profile-actions";

// Platform customer provisioning actions inside Usuarios y accesos. Each action is one keyed request
// to a Platform command that re-checks authority, customer scope and lifecycle in the database.
type Cafeteria = { id: string; name: string };
const messages: Record<string, string> = { ...provisioningMessages, ...Object.fromEntries(["username_unavailable", "identity_has_username", "email_has_other_username", "invalid_username", "username_reserved", "sandbox_username_unsupported"].map(code => [code, usernameRejectionMessage(code)])) };
const nameHelp = "Nombre de la persona como aparecerá en PIKAS. Se guarda al completar el acceso.";
const Failure = ({ kind, message, title }: { kind: string; message?: string; title: string }) =>
  <TaskOutcome kind={kind === "failure" ? "failure" : "uncertain"} title={kind === "failure" ? title : "Resultado sin confirmar"}><p>{message}</p></TaskOutcome>;

export function AddStaffAction({ accountId, cafeterias }: { accountId: string; cafeterias: Cafeteria[] }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Agregar personal de caja</button>
    {open && <AddStaffTask accountId={accountId} cafeterias={cafeterias} onClose={() => setOpen(false)} />}</>;
}
function AddStaffTask({ accountId, cafeterias, onClose }: { accountId: string; cafeterias: Cafeteria[]; onClose: () => void }) {
  const [f, setF] = useState({ displayName: "", email: "", username: "", cafeteriaId: cafeterias.length === 1 ? cafeterias[0].id : "" });
  const body: StaffCommand = { operation: "staff_prepare", accountId, ...f };
  const parsed = staffCommandSchema.safeParse(body);
  const { send, busy, outcome, locked } = useKeyedSend<StaffCommand>("/api/platform/customer-access/staff", staffResultSchema, messages);
  const done = outcome?.kind === "success", dirty = Object.values(f).some(Boolean) && !done && !locked;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return <TaskWindow title="Agregar personal de caja" context="Personal de caja (cajero o cajera)" busy={busy} dirty={dirty} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={busy || (!locked && !parsed.success)} onClick={() => send(parsed.success ? body : null)}>{busy ? "Preparando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : "Preparar acceso"}</button></TaskActions>}>
    {done ? <TaskOutcome kind="success" title="Acceso preparado"><p>Aparece en Pendientes. Genera allí su enlace de activación; cuando guarde su contraseña, completa el acceso. Preparar no concede acceso.</p></TaskOutcome> : <>
      <fieldset className="space-y-3" disabled={locked}>
        <div><label className="block font-bold">Nombre *<input className="field mt-1 w-full" value={f.displayName} onChange={set("displayName")} maxLength={200} required data-autofocus autoComplete="off" aria-describedby="staff-name-help" /></label><p id="staff-name-help" className="mt-1 text-sm text-slate-600">{nameHelp}</p></div>
        <label className="block font-bold">Correo *<input className="field mt-1 w-full" type="email" value={f.email} onChange={set("email")} maxLength={254} required autoComplete="off" /></label>
        <ProvisioningUsernameField value={f.username} onChange={(v) => setF({ ...f, username: v })} />
        <label className="block font-bold">Cafetería *<select className="field mt-1 w-full" value={f.cafeteriaId} onChange={set("cafeteriaId")} required><option value="">Seleccionar cafetería</option>{cafeterias.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <p className="text-sm text-slate-600">Rol: Personal de caja. Después podrás asignarle una caja en Administrar cliente → Cajas.</p>
      </fieldset>
      {outcome && <Failure kind={outcome.kind} message={outcome.message} title="No se preparó el acceso" />}
    </>}
  </TaskWindow>;
}

export function StaffActivationAction({ accountId, cafeteriaId, invitationId, hasLink }: { accountId: string; cafeteriaId: string; invitationId: string; hasLink: boolean }) {
  const router = useRouter(), inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [link, setLink] = useState(""), [message, setMessage] = useState("");
  async function issue() {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setLink(""); setMessage("");
    try {
      const response = await sessionFetch("/api/platform/customer-access/staff-activation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, cafeteriaId, invitationId }) });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error === "identity_unavailable" ? "No se puede activar esta identidad con esta invitación. Revisa el correo de la persona." : "No se pudo crear el enlace. Recarga el estado e inténtalo de nuevo."); return; }
      if (result.status === "identity_ready") { setMessage("La persona ya guardó su contraseña. Completa su acceso."); router.refresh(); return; }
      const url = new URL(result.link);
      if (url.origin !== window.location.origin || url.pathname !== "/activar" || !/^#token=[0-9a-f]{64}$/.test(url.hash)) throw Error("invalid");
      setLink(result.link); setMessage("Enlace creado. No se envió correo: entrégalo solo a esta persona por un canal privado. Vence en una hora; si vence, genera uno nuevo.");
    } catch { setMessage("No se pudo confirmar el enlace. Recarga el estado; puedes generar otro para la misma invitación."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="space-y-2">
    <button type="button" className="btn-secondary" disabled={busy} onClick={issue}>{busy ? "Generando…" : hasLink ? "Generar un enlace nuevo" : "Generar enlace de activación"}</button>
    {message && <p role="status" className="break-words text-sm">{message}</p>}
    {link && <label className="block text-sm font-bold">Enlace privado de activación<input className="field mt-1 w-full" readOnly value={link} onFocus={e => e.currentTarget.select()} /></label>}
  </div>;
}

export function CompleteStaffAction({ accountId, cafeteriaId, invitationId, intendedName, ready }: { accountId: string; cafeteriaId: string; invitationId: string; intendedName: string | null; ready: boolean }) {
  const [name, setName] = useState(intendedName ?? "");
  const body: StaffCommand = { operation: "staff_complete", accountId, cafeteriaId, invitationId, displayName: name };
  const parsed = staffCommandSchema.safeParse(body);
  const { send, busy, outcome, locked } = useKeyedSend<StaffCommand>("/api/platform/customer-access/staff", staffResultSchema, messages);
  if (outcome?.kind === "success") return <p role="status" className="text-sm font-bold">Acceso completado.</p>;
  return <div className="space-y-2">
    <label className="block text-sm font-bold">Nombre<input className="field mt-1 w-full" value={name} onChange={e => setName(e.target.value)} maxLength={200} disabled={locked} aria-describedby={`complete-${invitationId}-help`} /></label>
    <p id={`complete-${invitationId}-help`} className="text-sm text-slate-600">{nameHelp} Si la persona ya existe en PIKAS, se conserva su nombre actual.</p>
    <button type="button" className="btn" disabled={busy || (!locked && (!ready || !parsed.success))} onClick={() => send(parsed.success ? body : null)}>{busy ? "Completando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : "Completar acceso"}</button>
    {!ready && !locked && <p className="text-sm text-slate-600">Se habilita cuando la persona guarde su contraseña con el enlace de activación.</p>}
    {outcome && <p role="alert" className="text-sm">{outcome.message}</p>}
  </div>;
}

export function GrantCafeteriaAdminAction({ accountId, personId, personName, cafeterias }: { accountId: string; personId: string; personName: string; cafeterias: Cafeteria[] }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Dar acceso de administrador de cafetería</button>
    {open && <GrantTask accountId={accountId} personId={personId} personName={personName} cafeterias={cafeterias} onClose={() => setOpen(false)} />}</>;
}
function GrantTask({ accountId, personId, personName, cafeterias, onClose }: { accountId: string; personId: string; personName: string; cafeterias: Cafeteria[]; onClose: () => void }) {
  const [cafeteriaId, setCafeteriaId] = useState(cafeterias.length === 1 ? cafeterias[0].id : "");
  const { send, busy, outcome, locked } = useKeyedSend<{ accountId: string; personId: string; cafeteriaId: string }>("/api/platform/customer-access/cafeteria-admin", grantResultSchema, messages);
  const done = outcome?.kind === "success", chosen = cafeterias.find(c => c.id === cafeteriaId);
  return <TaskWindow title="Dar acceso de administrador de cafetería" context={personName} busy={busy} dirty={!!cafeteriaId && !done && !locked} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={busy || (!locked && !cafeteriaId)} onClick={() => send(cafeteriaId ? { accountId, personId, cafeteriaId } : null)}>{busy ? "Guardando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : "Dar acceso"}</button></TaskActions>}>
    {done ? <TaskOutcome kind="success" title="Acceso otorgado"><p>{personName} ahora es Administrador de cafetería · {chosen?.name}. Usa su mismo inicio de sesión.</p></TaskOutcome> : <>
      <label className="block font-bold">Cafetería *<select className="field mt-1 w-full" value={cafeteriaId} onChange={e => setCafeteriaId(e.target.value)} disabled={locked} data-autofocus><option value="">Seleccionar cafetería</option>{cafeterias.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <p className="text-sm text-slate-600">Se agrega a la misma persona y al mismo inicio de sesión. No crea usuarios nuevos ni cambia sus otros accesos. Repite para cada cafetería que administra.</p>
      {outcome && <Failure kind={outcome.kind} message={outcome.message} title="No se otorgó el acceso" />}
    </>}
  </TaskWindow>;
}

export function RenamePersonAction({ accountId, personId, currentName }: { accountId: string; personId: string; currentName: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn-tertiary" onClick={() => setOpen(true)}>Corregir nombre</button>
    {open && <RenamePersonTask accountId={accountId} personId={personId} currentName={currentName} onClose={() => setOpen(false)} />}</>;
}
function RenamePersonTask({ accountId, personId, currentName, onClose }: { accountId: string; personId: string; currentName: string; onClose: () => void }) {
  const [name, setName] = useState(currentName);
  const parsed = renamePersonSchema.safeParse({ accountId, personId, expectedName: currentName, name });
  const { send, busy, outcome, locked } = useKeyedSend<{ accountId: string; personId: string; expectedName: string; name: string }>("/api/platform/customer-access/person-name", renamePersonResultSchema, messages);
  const done = outcome?.kind === "success", changed = name.trim() !== currentName;
  return <TaskWindow title="Corregir nombre" context={currentName} busy={busy} dirty={changed && !done && !locked} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={busy || (!locked && (!parsed.success || !changed))} onClick={() => send(parsed.success ? parsed.data : null)}>{busy ? "Guardando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : "Guardar nombre"}</button></TaskActions>}>
    {done ? <TaskOutcome kind="success" title="Nombre corregido"><p>Ahora aparece como «{name.trim()}». Su usuario, correo y accesos no cambian.</p></TaskOutcome> : <>
      <label className="block font-bold">Nombre *<input className="field mt-1 w-full" value={name} onChange={e => setName(e.target.value)} maxLength={200} disabled={locked} data-autofocus autoComplete="off" /></label>
      <p className="text-sm text-slate-600">Corrige cómo aparece la persona en PIKAS. No cambia su usuario, correo, contraseña ni accesos.</p>
      {outcome && <Failure kind={outcome.kind} message={outcome.message} title="No se corrigió el nombre" />}
    </>}
  </TaskWindow>;
}
