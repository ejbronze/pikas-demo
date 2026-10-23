"use client";
import { useState } from "react";
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from "../task-window";
import { useKeyedSend } from "../../app/platform/clientes/[accountId]/profile-actions";
import { assignmentResultSchema, lifecycleAccessMessages, membershipConsequences, membershipStatusResultSchema, membershipTransitions, membershipWord, posAccessResultSchema, type AssignmentRequest, type MembershipStatusRequest, type PosAccessRequest } from "../../lib/platform/lifecycle-access";
import { roleLabel, type AccessGrant } from "../../lib/platform/customer-access";

// Lifecycle & Access Management on the Platform person sheet. Every action names its scope
// ("Suspender acceso a Cafetería Santiago", "Quitar asignación de Caja 01"), says what stops, what
// remains and whether it is reversible, and asks for a reason where the database records one. The
// global login is never here: it stays in Credenciales, a different authority.
export type SheetCafeteria = { id: string; name: string; location?: string; registers?: { id: string; name: string; code: string }[] };
const Failure = ({ outcome }: { outcome: { kind: string; message?: string } }) =>
  <TaskOutcome kind={outcome.kind === "failure" ? "failure" : "uncertain"} title={outcome.kind === "failure" ? "No se realizó el cambio" : "Resultado sin confirmar"}><p>{outcome.message}</p></TaskOutcome>;
const where = (g: AccessGrant, customerName: string) => g.scope === "cafeteria" ? g.cafeteria_name ?? "la cafetería" : g.scope === "school" ? g.school_name ?? "el colegio" : customerName;
const isPos = (g: AccessGrant) => ["pos_cashier", "pos_supervisor", "pos_operator"].includes(g.role_code);

export function MembershipStatusActions({ accountId, grant, customerName, personName }: { accountId: string; grant: AccessGrant; customerName: string; personName: string }) {
  const [target, setTarget] = useState<"active" | "suspended" | "inactive" | null>(null);
  if (grant.scope === "account") return null; // the customer's own administrators manage account-level access
  const w = where(grant, customerName);
  return <div className="flex flex-wrap gap-2">
    {membershipTransitions(grant.status).map(t => <button key={t.status} type="button" className={t.status === "active" ? "btn-secondary" : "btn-secondary border-amber-300 text-amber-950 hover:bg-amber-50"} onClick={() => setTarget(t.status)}>{t.label(w)}</button>)}
    {target && <MembershipStatusTask accountId={accountId} grant={grant} where={w} personName={personName} status={target} onClose={() => setTarget(null)} />}
  </div>;
}
function MembershipStatusTask({ accountId, grant, where: w, personName, status, onClose }: { accountId: string; grant: AccessGrant; where: string; personName: string; status: "active" | "suspended" | "inactive"; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const body: MembershipStatusRequest = { accountId, scope: grant.scope === "school" ? "school" : "cafeteria", membershipId: grant.membership_id, expectedStatus: grant.status, status, reason: reason.trim() };
  const { send, busy, outcome, locked } = useKeyedSend<MembershipStatusRequest>("/api/platform/customer-access/membership-status", membershipStatusResultSchema, lifecycleAccessMessages);
  const done = outcome?.kind === "success", ready = reason.trim().length >= 3 && reason.trim().length <= 500;
  const title = membershipTransitions(grant.status).find(t => t.status === status)?.label(w) ?? "Cambiar acceso";
  return <TaskWindow title={title} context={`${personName} · ${roleLabel(grant.role_code)}`} busy={busy} dirty={!!reason && !done && !locked} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className={status === "active" ? "btn" : "btn-destructive"} disabled={busy || (!locked && !ready)} onClick={() => send(ready ? body : null)}>{busy ? "Guardando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : title}</button></TaskActions>}>
    {done ? <TaskOutcome kind="success" title={status === "active" ? "Acceso reactivado" : status === "suspended" ? "Acceso suspendido" : "Acceso desactivado"}><p>{personName} · {roleLabel(grant.role_code)} · {w}: ahora {membershipWord[status].toLowerCase()}. Su usuario, su inicio de sesión y sus otros accesos no cambiaron.</p></TaskOutcome> : <>
      <TaskSummary rows={[["Persona", personName], ["Acceso", `${roleLabel(grant.role_code)} · ${w}`], ["Estado actual", membershipWord[grant.status] ?? grant.status], ["Nuevo estado", membershipWord[status]]]} />
      <ul className="list-disc space-y-1 pl-5 text-sm">{membershipConsequences(w, status, isPos(grant)).map(p => <li key={p}>{p}</li>)}</ul>
      <p className="text-sm text-slate-600">Esto no es «Suspender inicio de sesión en PIKAS»: esa suspensión global vive en Credenciales y afecta todos sus accesos.</p>
      <label className="block font-bold">Motivo *<textarea className="field mt-1 min-h-20" value={reason} disabled={locked} maxLength={500} data-autofocus onChange={e => setReason(e.target.value)} aria-describedby="membership-reason-help" />
        <span id="membership-reason-help" className="mt-1 block text-sm font-normal text-slate-600">Queda en el historial de PIKAS y de la cafetería. No incluyas contraseñas ni datos sensibles.</span></label>
      {outcome && <Failure outcome={outcome} />}
    </>}
  </TaskWindow>;
}

export function AssignmentActions({ accountId, grant, personName, cafeterias }: { accountId: string; grant: AccessGrant; personName: string; cafeterias: SheetCafeteria[] }) {
  const [task, setTask] = useState<{ registerId: string; name: string; status: "active" | "inactive" } | null>(null);
  if (grant.scope !== "cafeteria" || !grant.cafeteria_id || !isPos(grant)) return null;
  const available = (cafeterias.find(c => c.id === grant.cafeteria_id)?.registers ?? []).filter(r => !grant.registers.some(g => g.register_id === r.id && g.assignment_status === "active"));
  const assigned = grant.registers.filter(r => r.assignment_status === "active");
  if (!assigned.length && !available.length) return null;
  return <div className="flex flex-wrap gap-2">
    {assigned.map(r => <button key={r.register_id} type="button" className="btn-tertiary" onClick={() => setTask({ registerId: r.register_id, name: r.name, status: "inactive" })}>Quitar asignación de {r.name}</button>)}
    {grant.status === "active" && available.map(r => <button key={r.id} type="button" className="btn-tertiary" onClick={() => setTask({ registerId: r.id, name: r.name, status: "active" })}>Asignar {r.name}</button>)}
    {task && <AssignmentTask accountId={accountId} grant={grant} personName={personName} task={task} onClose={() => setTask(null)} />}
  </div>;
}
function AssignmentTask({ accountId, grant, personName, task, onClose }: { accountId: string; grant: AccessGrant; personName: string; task: { registerId: string; name: string; status: "active" | "inactive" }; onClose: () => void }) {
  const body: AssignmentRequest = { accountId, cafeteriaId: grant.cafeteria_id!, membershipId: grant.membership_id, registerId: task.registerId, status: task.status };
  const { send, busy, outcome } = useKeyedSend<AssignmentRequest>("/api/platform/customer-access/assignment", assignmentResultSchema, lifecycleAccessMessages);
  const done = outcome?.kind === "success", removing = task.status === "inactive";
  const title = removing ? `Quitar asignación de ${task.name}` : `Asignar ${task.name}`;
  return <TaskWindow title={title} context={`${personName} · ${grant.cafeteria_name ?? ""}`} busy={busy} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className={removing ? "btn-destructive" : "btn"} disabled={busy} onClick={() => send(body)}>{busy ? "Guardando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : title}</button></TaskActions>}>
    {done ? <TaskOutcome kind="success" title={removing ? "Asignación retirada" : "Caja asignada"}><p>{removing ? `${personName} ya no puede abrir ${task.name}. Su acceso a la cafetería, sus sesiones anteriores y su historial se conservan.` : `${personName} puede abrir ${task.name} desde el POS.`}</p></TaskOutcome> : <>
      <TaskSummary rows={[["Persona", personName], ["Cafetería", grant.cafeteria_name ?? ""], ["Caja", task.name]]} />
      <ul className="list-disc space-y-1 pl-5 text-sm">{removing
        ? [`Deja de poder abrir ${task.name}; si tiene una sesión abierta allí, la cierra con normalidad.`, "Solo es acceso operativo a esa caja: su acceso a la cafetería, su usuario y su inicio de sesión no cambian.", "Las sesiones, ventas e historial de esa caja se conservan.", "Es reversible: puede volver a asignarse."]
        : ["Podrá abrir sesiones en esa caja desde el POS.", "Requiere acceso activo a la cafetería y una caja activa.", "La cafetería puede cambiarlo después desde Cajas."].map(p => <li key={p}>{p}</li>)}</ul>
      {outcome && <Failure outcome={outcome} />}
    </>}
  </TaskWindow>;
}

export function AddPosAccessAction({ accountId, personId, personName, grants, cafeterias, canAssign }: { accountId: string; personId: string; personName: string; grants: AccessGrant[]; cafeterias: SheetCafeteria[]; canAssign: boolean }) {
  const [open, setOpen] = useState(false);
  const targets = cafeterias.filter(c => !grants.some(g => g.cafeteria_id === c.id && isPos(g) && g.status === "active"));
  if (!targets.length) return null;
  return <><button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Agregar a otra cafetería</button>
    {open && <AddPosAccessTask accountId={accountId} personId={personId} personName={personName} targets={targets} canAssign={canAssign} onClose={() => setOpen(false)} />}</>;
}
function AddPosAccessTask({ accountId, personId, personName, targets, canAssign, onClose }: { accountId: string; personId: string; personName: string; targets: SheetCafeteria[]; canAssign: boolean; onClose: () => void }) {
  const [cafeteriaId, setCafeteriaId] = useState(targets.length === 1 ? targets[0].id : ""), [roleCode, setRoleCode] = useState<"pos_cashier" | "pos_supervisor">("pos_cashier"), [registerId, setRegisterId] = useState("");
  const cafeteria = targets.find(c => c.id === cafeteriaId) ?? null, registers = cafeteria?.registers ?? [];
  const body: PosAccessRequest = { accountId, personId, cafeteriaId, roleCode, registerId: canAssign && registerId ? registerId : null };
  const { send, busy, outcome, locked } = useKeyedSend<PosAccessRequest>("/api/platform/customer-access/pos-access", posAccessResultSchema, lifecycleAccessMessages);
  const done = outcome?.kind === "success";
  return <TaskWindow title="Agregar a otra cafetería" context={personName} busy={busy} dirty={!!cafeteriaId && !done && !locked} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={busy || (!locked && !cafeteriaId)} onClick={() => send(cafeteriaId ? body : null)}>{busy ? "Guardando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : "Dar acceso"}</button></TaskActions>}>
    {done ? <TaskOutcome kind="success" title="Acceso agregado"><p>{personName} ahora es {roleCode === "pos_cashier" ? "Personal de caja" : "Supervisor"} en {cafeteria?.name}. Es la misma persona y el mismo inicio de sesión: entra con su usuario de siempre.{canAssign && registerId ? " La caja elegida quedó asignada si la cafetería la aceptó." : " La cafetería le asigna una caja desde Cajas."}</p></TaskOutcome> : <>
      <p className="text-sm text-slate-600">Se agrega un acceso a la misma persona conocida de este cliente. No se crea otra persona ni otro inicio de sesión, y su usuario no cambia. Solo cafeterías de este cliente.</p>
      <label className="block font-bold">Cafetería *<select className="field mt-1 w-full" value={cafeteriaId} disabled={locked} onChange={e => { setCafeteriaId(e.target.value); setRegisterId(""); }} data-autofocus><option value="">Seleccionar cafetería</option>{targets.map(c => <option key={c.id} value={c.id}>{c.name}{c.location ? ` · ${c.location}` : ""}</option>)}</select></label>
      <label className="block font-bold">Rol POS<select className="field mt-1 w-full" value={roleCode} disabled={locked} onChange={e => setRoleCode(e.target.value as "pos_cashier" | "pos_supervisor")}><option value="pos_cashier">Personal de caja</option><option value="pos_supervisor">Supervisor</option></select></label>
      {cafeteria && canAssign && (registers.length ? <fieldset className="space-y-2"><legend className="font-bold">Caja en {cafeteria.name}</legend>
        <label className="flex min-h-11 items-center gap-3"><input type="radio" name="add-pos-register" checked={registerId === ""} disabled={locked} onChange={() => setRegisterId("")} /><span>Asignar después</span></label>
        {registers.map(r => <label key={r.id} className="flex min-h-11 items-center gap-3"><input type="radio" name="add-pos-register" checked={registerId === r.id} disabled={locked} onChange={() => setRegisterId(r.id)} /><span>{r.name} <span className="text-slate-500">· {r.code}</span></span></label>)}</fieldset>
        : <p className="text-sm text-slate-600">{cafeteria.name} aún no tiene cajas activas; la cafetería asigna una desde Cajas.</p>)}
      {outcome && <Failure outcome={outcome} />}
    </>}
  </TaskWindow>;
}
