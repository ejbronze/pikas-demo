"use client";
import { useState } from "react";
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from "../task-window";
import { useKeyedSend } from "../../app/platform/clientes/[accountId]/profile-actions";
import { lifecycleAccessMessages, statusWord, structureConsequences, structureNoun, structureStatusResultSchema, structureTransitions, type StructureKind, type StructureStatusRequest } from "../../lib/platform/lifecycle-access";

// Sede / cafetería lifecycle from the customer's Estructura (Platform only). The dialog names the
// exact change, lists what stops and what remains, asks for a reason and never offers deletion.
export function StructureStatusAction({ accountId, kind, targetId, name, status }: { accountId: string; kind: StructureKind; targetId: string; name: string; status: string }) {
  const [target, setTarget] = useState<"active" | "suspended" | "inactive" | null>(null);
  const noun = structureNoun(kind);
  return <>
    {structureTransitions(kind, status).map(t => <button key={t.status} type="button" className={t.status === "active" ? "btn-tertiary" : "btn-tertiary text-amber-900"} aria-label={`${t.label}: ${name}`} onClick={() => setTarget(t.status)}>{t.label}</button>)}
    {target && <StructureStatusTask accountId={accountId} kind={kind} targetId={targetId} name={name} status={status} next={target} noun={noun} onClose={() => setTarget(null)} />}
  </>;
}
function StructureStatusTask({ accountId, kind, targetId, name, status, next, noun, onClose }: { accountId: string; kind: StructureKind; targetId: string; name: string; status: string; next: "active" | "suspended" | "inactive"; noun: string; onClose: () => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false);
  const body: StructureStatusRequest = { accountId, kind, targetId, expectedStatus: status, status: next, reason: reason.trim() };
  const { send, busy, outcome, locked } = useKeyedSend<StructureStatusRequest>("/api/platform/customer-structure/status", structureStatusResultSchema, lifecycleAccessMessages);
  const done = outcome?.kind === "success", needsAck = next !== "active", ready = reason.trim().length >= 3 && reason.trim().length <= 500 && (!needsAck || ack);
  const label = structureTransitions(kind, status).find(t => t.status === next)?.label ?? "Cambiar estado";
  return <TaskWindow title={label} context={name} busy={busy} dirty={(!!reason || ack) && !done && !locked} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className={next === "active" ? "btn" : "btn-destructive"} disabled={busy || (!locked && !ready)} onClick={() => send(ready ? body : null)}>{busy ? "Guardando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : label}</button></TaskActions>}>
    {done ? <TaskOutcome kind="success" title={next === "active" ? `${noun === "sede" ? "Sede" : "Cafetería"} reactivada` : next === "suspended" ? "Cafetería suspendida" : `${noun === "sede" ? "Sede" : "Cafetería"} desactivada`}><p>{name}: ahora {statusWord[next].toLowerCase()}. Nada se eliminó; el historial sigue disponible.</p></TaskOutcome> : <>
      <TaskSummary rows={[[noun === "sede" ? "Sede" : "Cafetería", name], ["Estado actual", statusWord[status] ?? status], ["Nuevo estado", statusWord[next]]]} />
      <ul className="list-disc space-y-1 pl-5 text-sm">{structureConsequences(kind, name, next).map(p => <li key={p}>{p}</li>)}</ul>
      <label className="block font-bold">Motivo *<textarea className="field mt-1 min-h-20" value={reason} disabled={locked} maxLength={500} data-autofocus onChange={e => setReason(e.target.value)} aria-describedby="structure-reason-help" />
        <span id="structure-reason-help" className="mt-1 block text-sm font-normal text-slate-600">Queda en el historial de PIKAS. No lo ven los usuarios del cliente.</span></label>
      {needsAck && <label className="flex min-h-11 items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold"><input type="checkbox" className="mt-1 size-5 shrink-0" checked={ack} disabled={locked} onChange={e => setAck(e.target.checked)} />Entiendo que {name} deja de estar disponible para su personal y que nada se elimina.</label>}
      {outcome && <TaskOutcome kind={outcome.kind === "failure" ? "failure" : "uncertain"} title={outcome.kind === "failure" ? "No se realizó el cambio" : "Resultado sin confirmar"}><p>{outcome.message}</p></TaskOutcome>}
    </>}
  </TaskWindow>;
}
