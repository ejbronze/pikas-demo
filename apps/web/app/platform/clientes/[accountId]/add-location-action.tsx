"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sessionFetch } from "../../../../lib/auth/session-fetch";
import { addLocationMessages, addLocationRequestSchema, addLocationResultSchema, type AddLocationRequest } from "../../../../lib/platform/school-location";
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from "../../../../components/task-window";

// Platform "Agregar sede": one location (sede) + its cafeteria under an existing active customer
// school. No register, administrator, staff or products are created; those stay downstream.
export function AddLocationAction({ accountId, schoolId, schoolName }: { accountId: string; schoolId: string; schoolName: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Agregar sede</button>
    {open && <AddLocationTask accountId={accountId} schoolId={schoolId} schoolName={schoolName} onClose={() => setOpen(false)} />}
  </>;
}

type Fields = Pick<AddLocationRequest, "locationCode" | "locationName" | "cafeteriaCode" | "cafeteriaName">;
const empty: Fields = { locationCode: "", locationName: "", cafeteriaCode: "", cafeteriaName: "" };
const uncertain = "No pudimos confirmar el resultado. Reintenta la misma solicitud: no se creará dos veces.";

function AddLocationTask({ accountId, schoolId, schoolName, onClose }: { accountId: string; schoolId: string; schoolName: string; onClose: () => void }) {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>(empty), [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ kind: "success" | "failure" | "uncertain"; message?: string } | null>(null);
  // One request identity per task; an unconfirmed result is retried with exactly the same key and body.
  const [request, setRequest] = useState<{ key: string; body: AddLocationRequest } | null>(null);
  const inFlight = useRef(false);
  const parsed = addLocationRequestSchema.safeParse({ accountId, schoolId, ...fields });
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [k]: e.target.value });
  const send = async () => {
    if (inFlight.current) return;
    const current = request ?? (parsed.success ? { key: crypto.randomUUID(), body: parsed.data } : null);
    if (!current) return;
    inFlight.current = true; setRequest(current); setBusy(true); setOutcome(null);
    try {
      const response = await sessionFetch("/api/platform/school-locations", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": current.key }, body: JSON.stringify(current.body) });
      const body = await response.json().catch(() => ({}));
      if (response.ok && addLocationResultSchema.safeParse(body.result).success) { setOutcome({ kind: "success" }); router.refresh(); return; }
      if ([400, 403, 409, 422].includes(response.status)) {
        setRequest(null);
        setOutcome({ kind: "failure", message: addLocationMessages[body.error] ?? (response.status === 403 ? "No tienes permiso para agregar sedes." : "Revisa los datos e inténtalo de nuevo.") });
        return;
      }
      setOutcome({ kind: "uncertain", message: uncertain });
    } catch { setOutcome({ kind: "uncertain", message: uncertain }); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const done = outcome?.kind === "success", locked = !!request;
  const dirty = !done && !locked && Object.values(fields).some(Boolean);
  const input = (label: string, k: keyof Fields, max: number, autofocus = false) => <label className="block font-bold">{label} *
    <input className="field mt-1" value={fields[k]} onChange={set(k)} maxLength={max} required disabled={locked} data-autofocus={autofocus || undefined} autoComplete="off" /></label>;
  return <TaskWindow title="Agregar sede" context={schoolName} busy={busy} dirty={dirty} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={busy || (!locked && !parsed.success)} onClick={send}>{busy ? "Creando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : "Crear sede"}</button></TaskActions>}>
    {done && request ? <TaskOutcome kind="success" title="Sede creada">
      <TaskSummary rows={[["Sede", `${request.body.locationName} · ${request.body.locationCode}`], ["Cafetería", `${request.body.cafeteriaName} · ${request.body.cafeteriaCode}`]]} />
      <p className="text-sm">Ya aparece en la estructura del cliente. Las cajas, administradores, personal y productos se configuran después.</p>
    </TaskOutcome> : <>
      <p className="text-sm text-slate-600">Agrega una sede (ubicación o campus) a esta escuela. Crear la sede también crea su cafetería. No se crean cajas, usuarios ni productos.</p>
      <fieldset className="space-y-3"><legend className="font-black">Sede</legend>{input("Código", "locationCode", 64, true)}{input("Nombre", "locationName", 200)}</fieldset>
      <fieldset className="space-y-3"><legend className="font-black">Cafetería</legend>{input("Código", "cafeteriaCode", 64)}{input("Nombre", "cafeteriaName", 200)}</fieldset>
      {outcome && <TaskOutcome kind={outcome.kind === "failure" ? "failure" : "uncertain"} title={outcome.kind === "failure" ? "No se creó la sede" : "Resultado sin confirmar"}><p>{outcome.message}</p></TaskOutcome>}
    </>}
  </TaskWindow>;
}
