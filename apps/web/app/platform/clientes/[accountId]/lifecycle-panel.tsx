"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sessionFetch } from "../../../../lib/auth/session-fetch";
import { actionLabels, actionsFor, eventLabels, lifecycleErrorMessages, lifecycleResultSchema, type LifecycleAction } from "../../../../lib/platform/customer-lifecycle";
import { statusLabel } from "../../../../lib/platform/customer-contracts";
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from "../../../../components/task-window";
import { EmptyState } from "../../../../components/state-panels";
import { LifecycleBadge } from "../../console-views";

type HistoryEvent = { occurred_at: string; action: string; from: string | null; to: string | null; reason: string | null; actor_name: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santo_Domingo" });

// Platform customer lifecycle: status, allowed transitions and history. Lifecycle controls tenant
// ACCESS only; it never deletes, anonymizes, settles or changes balances, people or memberships.
export function CustomerLifecyclePanel({ accountId, name, status, canManage, history }: { accountId: string; name: string; status: string; canManage: boolean; history: HistoryEvent[] | null }) {
  const [action, setAction] = useState<LifecycleAction | null>(null);
  const actions = canManage ? actionsFor(status) : [];
  return <section aria-labelledby="lifecycle-title" className="card space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="lifecycle-title" className="text-lg font-bold">Estado del cliente</h2><LifecycleBadge status={status} /></div>
    <p className="text-sm text-slate-600">{status === "active" ? "Opera normalmente: los usuarios del cliente acceden según sus permisos." : status === "suspended" ? "Acceso del cliente bloqueado temporalmente. Sus datos, personas, accesos e historial se conservan." : status === "closed" ? "La relación con el cliente terminó. Su acceso está bloqueado; todos sus datos e historial se conservan." : "Estado registrado."}</p>
    {actions.length > 0 && <div className="flex flex-wrap gap-2">{actions.map(a => <button key={a} type="button" className={a === "close" ? "btn-secondary border-red-300 text-red-800" : "btn-secondary"} onClick={() => setAction(a)}>{actionLabels[a]}</button>)}</div>}
    <div><h3 className="font-bold">Historial del ciclo de vida</h3>
      {history === null ? <p className="text-sm text-slate-600">No se pudo cargar el historial.</p> : history.length === 0 ? <EmptyState title="Sin cambios de estado registrados." />
        : <ol className="mt-2 divide-y rounded-xl border text-sm">{history.map((e, i) => <li key={i} className="px-4 py-3"><p className="font-bold">{eventLabels[e.action] ?? e.action}{e.from && e.to ? ` · ${statusLabel[e.from] ?? e.from} → ${statusLabel[e.to] ?? e.to}` : ""}</p>
          <p className="text-slate-600">{when(e.occurred_at)} · {e.actor_name ?? "Operador de PIKAS"}</p>{e.reason && <p className="mt-1 break-words">Motivo: {e.reason}</p>}</li>)}</ol>}
    </div>
    {action && <LifecycleTask key={action} accountId={accountId} name={name} status={status} action={action} onClose={() => setAction(null)} />}
  </section>;
}

const copy: Record<LifecycleAction, { title: string; points: string[]; confirm?: string; final: string; done: string }> = {
  suspend: { title: "Suspender cliente", final: "Suspender", done: "Cliente suspendido",
    points: ["El acceso de los usuarios del cliente quedará bloqueado temporalmente, incluidas las sesiones abiertas.", "Se conservan escuelas, cafeterías, personas, accesos, cajas, transacciones, saldos de PIKAS Cash e historial.", "Puedes reactivarlo cuando corresponda."] },
  reactivate: { title: "Reactivar cliente", final: "Reactivar", done: "Cliente reactivado",
    points: ["Los usuarios del cliente recuperarán su acceso con los mismos permisos que tenían.", "No se recrea nada: es el mismo cliente con sus mismos datos."] },
  close: { title: "Cerrar cliente", final: "Cerrar cliente", done: "Cliente cerrado", confirm: "Entiendo que el cliente quedará cerrado y sin acceso operativo, y que solo podrá reabrirse desde la gestión de clientes de PIKAS.",
    points: ["El acceso de los usuarios del cliente quedará bloqueado.", "La relación con el cliente quedará marcada como cerrada.", "No se elimina ningún dato ni historial.", "No se modifican saldos de PIKAS Cash ni transacciones.", "No realiza liquidación financiera ni reembolsos.", "Solo podrá reabrirse desde la gestión de ciclo de vida de PIKAS."] },
  reopen: { title: "Reabrir cliente", final: "Reabrir cliente", done: "Cliente reabierto", confirm: "Confirmo que este mismo cliente debe volver a estar activo.",
    points: ["El mismo cliente vuelve a estar Activo, con su estructura, personas, accesos e historial.", "No se crea un cliente nuevo."] },
};

function LifecycleTask({ accountId, name, status, action, onClose }: { accountId: string; name: string; status: string; action: LifecycleAction; onClose: () => void }) {
  const router = useRouter();
  const c = copy[action];
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false), [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ kind: "success" | "failure" | "uncertain"; message?: string } | null>(null);
  // One request identity per task; an uncertain result is retried with exactly the same key and payload.
  const [request, setRequest] = useState<{ key: string; body: Record<string, string> } | null>(null);
  const ready = reason.trim().length >= 3 && reason.trim().length <= 500 && (!c.confirm || ack);
  const send = async () => {
    const current = request ?? { key: crypto.randomUUID(), body: { accountId, expectedStatus: status, action, reason: reason.trim() } };
    setRequest(current); setBusy(true); setOutcome(null);
    try {
      const response = await sessionFetch("/api/platform/customer-lifecycle", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": current.key }, body: JSON.stringify(current.body) });
      const body = await response.json().catch(() => ({}));
      if (response.ok && lifecycleResultSchema.safeParse(body.result).success) { setOutcome({ kind: "success" }); router.refresh(); return; }
      if (response.status === 422 || response.status === 403 || response.status === 400) { setRequest(null);
        setOutcome({ kind: "failure", message: lifecycleErrorMessages[body.error] ?? (response.status === 403 ? "No tienes permiso para cambiar el estado de clientes." : "Revisa los datos e inténtalo de nuevo.") }); return; }
      setOutcome({ kind: "uncertain", message: "No pudimos confirmar el resultado. Reintenta la misma solicitud; no se aplicará dos veces." });
    } catch { setOutcome({ kind: "uncertain", message: "No pudimos confirmar el resultado. Reintenta la misma solicitud; no se aplicará dos veces." }); }
    finally { setBusy(false); }
  };
  const done = outcome?.kind === "success";
  return <TaskWindow title={c.title} context={name} busy={busy} dirty={!done && !request && (!!reason || ack)} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className={action === "close" ? "btn-destructive" : "btn"} disabled={busy || (!request && !ready)} onClick={send}>{busy ? "Guardando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : c.final}</button></TaskActions>}>
    {done ? <TaskOutcome kind="success" title={c.done}><p>{action === "suspend" || action === "close" ? "El acceso del cliente quedó bloqueado. Sus datos e historial se conservan." : "El cliente vuelve a operar con los mismos datos y accesos."}</p></TaskOutcome> : <>
      <TaskSummary rows={[["Cliente", name], ["Estado actual", statusLabel[status] ?? status], ["Nuevo estado", action === "suspend" ? "Suspendido" : action === "close" ? "Cerrado" : "Activo"]]} />
      <ul className="list-disc space-y-1 pl-5 text-sm">{c.points.map(p => <li key={p}>{p}</li>)}</ul>
      <label className="block font-bold">Motivo *<textarea className="field mt-1 min-h-24" value={reason} disabled={!!request} maxLength={500} data-autofocus onChange={e => setReason(e.target.value)} aria-describedby="lifecycle-reason-help" />
        <span id="lifecycle-reason-help" className="mt-1 block text-sm font-normal text-slate-600">Queda en el historial de PIKAS. No lo ven los usuarios del cliente. No incluyas contraseñas ni datos sensibles.</span></label>
      {c.confirm && <label className="flex min-h-11 items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold"><input type="checkbox" className="mt-1 size-5 shrink-0" checked={ack} disabled={!!request} onChange={e => setAck(e.target.checked)} />{c.confirm}</label>}
      {outcome && <TaskOutcome kind={outcome.kind} title={outcome.kind === "failure" ? "No se realizó el cambio" : "Resultado sin confirmar"}><p>{outcome.message}</p></TaskOutcome>}
    </>}
  </TaskWindow>;
}
