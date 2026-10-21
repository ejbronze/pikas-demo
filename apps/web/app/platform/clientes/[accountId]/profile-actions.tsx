"use client";
import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { sessionFetch } from "../../../../lib/auth/session-fetch";
import { profileMessages, profileRequestSchema, profileResultSchema, renameRequestSchema, renameResultSchema, type ProfileRequest, type RenameRequest } from "../../../../lib/platform/customer-profile";
import { DOMINICAN_REPUBLIC, dominicanProvinces } from "../../../../lib/platform/dominican-provinces";
import { TaskActions, TaskCancelButton, TaskOutcome, TaskWindow } from "../../../../components/task-window";

type Outcome = { kind: "success" | "failure" | "uncertain"; message?: string } | null;
const uncertain = "No pudimos confirmar el resultado. Reintenta la misma solicitud: no se aplicará dos veces.";

// One request identity per task, as in Agregar sede: an unconfirmed result is retried with exactly
// the same key and body; a definite rejection releases it so the operator can correct and resend.
export function useKeyedSend<B>(path: string, result: { safeParse(v: unknown): { success: boolean } }, messages: Record<string, string> = profileMessages) {
  const router = useRouter();
  const [request, setRequest] = useState<{ key: string; body: B } | null>(null), [busy, setBusy] = useState(false), [outcome, setOutcome] = useState<Outcome>(null);
  const inFlight = useRef(false);
  const send = async (body: B | null) => {
    if (inFlight.current) return;
    const current = request ?? (body ? { key: crypto.randomUUID(), body } : null);
    if (!current) return;
    inFlight.current = true; setRequest(current); setBusy(true); setOutcome(null);
    try {
      const response = await sessionFetch(path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": current.key }, body: JSON.stringify(current.body) });
      const json = await response.json().catch(() => ({}));
      if (response.ok && result.safeParse(json.result).success) { setOutcome({ kind: "success" }); router.refresh(); return; }
      if ([400, 403, 409, 422].includes(response.status)) {
        setRequest(null);
        setOutcome({ kind: "failure", message: messages[json.error] ?? (response.status === 403 ? "No tienes permiso para realizar esta acción." : response.status === 409 ? "La solicitud encontró un conflicto. Recarga y revisa el estado actual." : "Revisa los datos e inténtalo de nuevo.") });
        return;
      }
      setOutcome({ kind: "uncertain", message: uncertain });
    } catch { setOutcome({ kind: "uncertain", message: uncertain }); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return { send, busy, outcome, locked: !!request };
}

export type ProfileValues = { name: string; rnc: string | null; address: string | null; province: string | null };
export function EditProfileAction({ accountId, schoolId, current, renamesAccount, accountName }: { accountId: string; schoolId: string; current: ProfileValues; renamesAccount: boolean; accountName?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="btn-tertiary gap-1.5" aria-label={`Editar información de ${current.name}`} onClick={() => setOpen(true)}><Pencil aria-hidden className="size-4" />Editar</button>
    {open && <EditProfileTask accountId={accountId} schoolId={schoolId} current={current} renamesAccount={renamesAccount} accountName={accountName} onClose={() => setOpen(false)} />}
  </>;
}

function EditProfileTask({ accountId, schoolId, current, renamesAccount, accountName, onClose }: { accountId: string; schoolId: string; current: ProfileValues; renamesAccount: boolean; accountName?: string; onClose: () => void }) {
  const initial = { name: current.name, taxId: current.rnc ?? "", addressLine: current.address ?? "", provinceCode: current.province ?? "" };
  const [fields, setFields] = useState(initial);
  const body: ProfileRequest = { accountId, schoolId, expected: current, ...fields, countryCode: DOMINICAN_REPUBLIC.code, provinceCode: fields.provinceCode as ProfileRequest["provinceCode"] };
  const parsed = profileRequestSchema.safeParse(body);
  const { send, busy, outcome, locked } = useKeyedSend<ProfileRequest>("/api/platform/customer-profile", profileResultSchema);
  // A one-colegio customer named differently (e.g. after a person) is corrected by saving, even unchanged.
  const mismatch = renamesAccount && accountName !== undefined && accountName !== current.name;
  const done = outcome?.kind === "success", changed = JSON.stringify(fields) !== JSON.stringify(initial) || mismatch;
  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFields({ ...fields, [k]: e.target.value });
  const invalid = !parsed.success && changed;
  return <TaskWindow title="Editar información del colegio" context={current.name} busy={busy} dirty={changed && !done && !locked} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={busy || (!locked && (!parsed.success || !changed))} onClick={() => send(parsed.success ? body : null)}>{busy ? "Guardando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : "Guardar cambios"}</button></TaskActions>}>
    {done ? <TaskOutcome kind="success" title="Información actualizada"><p>Los cambios ya se muestran en el cliente.{renamesAccount && (fields.name !== initial.name || mismatch) ? " El nombre del cliente se actualizó junto con el del colegio." : ""}</p></TaskOutcome> : <>
      <fieldset className="space-y-3" disabled={locked}>
        <label className="block font-bold">Nombre *<input className="field mt-1 w-full" value={fields.name} onChange={set("name")} maxLength={200} required data-autofocus autoComplete="off" /></label>
        {renamesAccount && <p className="text-sm text-slate-600">Este cliente tiene un solo colegio: cambiar el nombre también actualiza el nombre del cliente.</p>}
        {mismatch && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">El cliente se llama «{accountName}», distinto del colegio. Al guardar, el cliente tomará el nombre del colegio.</p>}
        <label className="block font-bold">RNC<input className="field mt-1 w-full" value={fields.taxId} onChange={set("taxId")} maxLength={13} inputMode="numeric" autoComplete="off" /><span className="mt-1 block text-sm font-normal text-slate-600">9 dígitos (u 11 si es una cédula). Déjalo vacío si no está registrado.</span></label>
        <label className="block font-bold">Dirección<input className="field mt-1 w-full" value={fields.addressLine} onChange={set("addressLine")} maxLength={300} autoComplete="off" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block font-bold">País<input className="field mt-1 w-full bg-slate-100 text-slate-700" value={DOMINICAN_REPUBLIC.name} readOnly aria-readonly="true" /></label>
          <label className="block font-bold">Provincia<select className="field mt-1 w-full" value={fields.provinceCode} onChange={set("provinceCode")}><option value="">No registrado</option>{dominicanProvinces.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
        </div>
        <p className="text-sm text-slate-600">El código del colegio no cambia. Esta edición no afecta usuarios, cafeterías, ventas ni saldos.</p>
      </fieldset>
      {invalid && <p role="alert" className="text-sm text-red-800">Revisa el nombre y el RNC (9 u 11 dígitos).</p>}
      {outcome && <TaskOutcome kind={outcome.kind === "failure" ? "failure" : "uncertain"} title={outcome.kind === "failure" ? "No se guardaron los cambios" : "Resultado sin confirmar"}><p>{outcome.message}</p></TaskOutcome>}
    </>}
  </TaskWindow>;
}

export function RenameAction({ accountId, kind, targetId, currentName }: { accountId: string; kind: RenameRequest["kind"]; targetId: string; currentName: string }) {
  const [open, setOpen] = useState(false);
  const noun = kind === "location" ? "sede" : "cafetería";
  return <>
    <button type="button" className="btn-tertiary" aria-label={`Renombrar ${noun} ${currentName}`} onClick={() => setOpen(true)}>Renombrar</button>
    {open && <RenameTask accountId={accountId} kind={kind} targetId={targetId} currentName={currentName} noun={noun} onClose={() => setOpen(false)} />}
  </>;
}

function RenameTask({ accountId, kind, targetId, currentName, noun, onClose }: { accountId: string; kind: RenameRequest["kind"]; targetId: string; currentName: string; noun: string; onClose: () => void }) {
  const [name, setName] = useState(currentName);
  const parsed = renameRequestSchema.safeParse({ accountId, kind, targetId, expectedName: currentName, name });
  const { send, busy, outcome, locked } = useKeyedSend<RenameRequest>("/api/platform/customer-structure", renameResultSchema);
  const done = outcome?.kind === "success", changed = name.trim() !== currentName;
  return <TaskWindow title={`Renombrar ${noun}`} context={currentName} busy={busy} dirty={changed && !done && !locked} onClose={onClose}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={onClose}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" disabled={busy || (!locked && (!parsed.success || !changed))} onClick={() => send(parsed.success ? parsed.data : null)}>{busy ? "Guardando…" : outcome?.kind === "uncertain" ? "Reintentar la misma solicitud" : "Guardar nombre"}</button></TaskActions>}>
    {done ? <TaskOutcome kind="success" title="Nombre actualizado"><p>La {noun} ahora se llama «{name.trim()}». Su código no cambia.</p></TaskOutcome> : <>
      <label className="block font-bold">Nombre de la {noun} *<input className="field mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required disabled={locked} data-autofocus autoComplete="off" /></label>
      <p className="text-sm text-slate-600">Solo cambia el nombre visible. El código, el personal, las cajas y las ventas no cambian.</p>
      {outcome && <TaskOutcome kind={outcome.kind === "failure" ? "failure" : "uncertain"} title={outcome.kind === "failure" ? "No se cambió el nombre" : "Resultado sin confirmar"}><p>{outcome.message}</p></TaskOutcome>}
    </>}
  </TaskWindow>;
}
