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
    <button type="button" className="btn" onClick={() => setOpen(true)}>Agregar sede</button>
    {open && <AddLocationTask accountId={accountId} schoolId={schoolId} schoolName={schoolName} onClose={() => setOpen(false)} />}
  </>;
}

type Fields = { locationName: string; cafeteriaName: string };
const empty: Fields = { locationName: "", cafeteriaName: "" };
const uncertain = "No pudimos confirmar el resultado. Reintenta la misma solicitud: no se creará dos veces.";
// The cafetería name follows the sede name ("Cafetería {sede}") until the operator edits it.
export const defaultCafeteriaName = (sede: string) => sede.trim() ? `Cafetería ${sede.trim().replace(/^sede\s+/i, "")}` : "";

function AddLocationTask({ accountId, schoolId, schoolName, onClose }: { accountId: string; schoolId: string; schoolName: string; onClose: () => void }) {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>(empty), [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ kind: "success" | "failure" | "uncertain"; message?: string } | null>(null);
  const [created, setCreated] = useState<{ location?: string; cafeteria?: string }>({});
  // One request identity per task; an unconfirmed result is retried with exactly the same key and body.
  const [request, setRequest] = useState<{ key: string; body: AddLocationRequest } | null>(null);
  const inFlight = useRef(false);
  const parsed = addLocationRequestSchema.safeParse({ accountId, schoolId, ...fields });
  const setSede = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFields(f => ({ locationName: value, cafeteriaName: f.cafeteriaName === defaultCafeteriaName(f.locationName) ? defaultCafeteriaName(value) : f.cafeteriaName }));
  };
  const send = async () => {
    if (inFlight.current) return;
    const current = request ?? (parsed.success ? { key: crypto.randomUUID(), body: parsed.data } : null);
    if (!current) return;
    inFlight.current = true; setRequest(current); setBusy(true); setOutcome(null);
    try {
      const response = await sessionFetch("/api/platform/school-locations", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": current.key }, body: JSON.stringify(current.body) });
      const body = await response.json().catch(() => ({}));
      const result = addLocationResultSchema.safeParse(body.result);
      if (response.ok && result.success) { setCreated({ location: result.data.location_code, cafeteria: result.data.cafeteria_code }); setOutcome({ kind: "success" }); router.refresh(); return; }
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
  return <TaskWindow title="Agregar sede" context={schoolName} busy={busy} dirty={dirty} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={busy || (!locked && !parsed.success)} onClick={send}>{busy ? "Creando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : "Crear sede"}</button></TaskActions>}>
    {done && request ? <TaskOutcome kind="success" title={`${/^sede\s/i.test(request.body.locationName) ? request.body.locationName : `Sede ${request.body.locationName}`} creada`}>
      <TaskSummary rows={[["Sede", `${request.body.locationName}${created.location ? ` · ${created.location}` : ""}`], ["Cafetería", `${request.body.cafeteriaName}${created.cafeteria ? ` · ${created.cafeteria}` : ""}`]]} />
      <p className="text-sm">PIKAS asignó los códigos. Ya aparece en la estructura del cliente. Las cajas, administradores, personal y productos se configuran después.</p>
    </TaskOutcome> : <>
      <p className="text-sm text-slate-600">Agrega una sede (ubicación o campus) a este colegio. Crear la sede también crea su cafetería. PIKAS asigna los códigos.</p>
      <label className="block font-bold">Nombre de la sede *<input className="field mt-1" value={fields.locationName} onChange={setSede} maxLength={200} required disabled={locked} data-autofocus autoComplete="off" /></label>
      <fieldset className="space-y-3"><legend className="font-black">Cafetería</legend>
        <label className="block font-bold">Nombre de la cafetería *<input className="field mt-1" value={fields.cafeteriaName} onChange={e => setFields({ ...fields, cafeteriaName: e.target.value })} maxLength={200} required disabled={locked} autoComplete="off" /></label></fieldset>
      {outcome && <TaskOutcome kind={outcome.kind === "failure" ? "failure" : "uncertain"} title={outcome.kind === "failure" ? "No se creó la sede" : "Resultado sin confirmar"}><p>{outcome.message}</p></TaskOutcome>}
    </>}
  </TaskWindow>;
}
