"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { customerDraftSchema, type CustomerDraft } from "../../../../lib/platform/customer-contracts";
import { CustomerJourney, journeyStorageKey, type CustomerJourneyState } from "../../../../lib/platform/customer-journey";
import { ConfirmAction } from "../../../../components/confirm-action";
import { TaskOutcome, TaskSummary } from "../../../../components/task-window";

const steps = ["Cliente", "Escuela", "Ubicación", "Cafetería", "Administrador inicial", "Revisar"];
const initialDraft: CustomerDraft = { accountName: "", accountCode: "", schoolName: "", schoolCode: "", businessTimezone: "America/Santo_Domingo",
  locationName: "", locationCode: "", cafeteriaName: "", cafeteriaCode: "", administratorName: "", administratorEmail: "" };
const stepFields: Array<Array<keyof CustomerDraft>> = [["accountName", "accountCode"], ["schoolName", "schoolCode", "businessTimezone"],
  ["locationName", "locationCode"], ["cafeteriaName", "cafeteriaCode"], ["administratorName", "administratorEmail"]];
const labels: Record<keyof CustomerDraft, string> = { accountName: "Nombre del cliente", accountCode: "Código del cliente", schoolName: "Nombre de la escuela",
  schoolCode: "Código de la escuela", businessTimezone: "Zona horaria", locationName: "Nombre de la ubicación", locationCode: "Código de la ubicación",
  cafeteriaName: "Nombre de la cafetería", cafeteriaCode: "Código de la cafetería", administratorName: "Nombre del administrador", administratorEmail: "Correo del administrador" };
const hints: Partial<Record<keyof CustomerDraft, string>> = { businessTimezone: "Identificador IANA, por ejemplo America/Santo_Domingo.", accountCode: "Identificador corto y único.",
  administratorEmail: "El correo por sí solo no concede acceso." };
const stepNotes = ["La organización que contrata PIKAS.", "Su primera escuela y la zona horaria de operación.", "Sede o campus de la escuela.", "La cafetería que operará en esa ubicación.",
  "Se preparará su acceso de administrador del cliente. Preparar no envía correo ni concede acceso: después generas su enlace privado de activación desde el cliente."];
// Browser-session draft (Wave D.3): typed values only, scoped to the real operator, never sent.
// Creating writes the existing provisioning journal instead, which then owns the request.
export const customerDraftKey = (actor: string) => `pikas:customer-draft:v1:${actor}`;

export function CustomerWizard({ actor }: { actor: string }) {
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<CustomerJourneyState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof CustomerDraft, string>>>({});
  const [notice, setNotice] = useState<"" | "draft" | "journey">("");
  const journey = useRef<CustomerJourney | null>(null);
  const pending = useRef(false);
  const storageKey = journeyStorageKey(actor), draftKey = customerDraftKey(actor);
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      try {
        // Detection only: an existing creation is never resent without the explicit action below.
        if (sessionStorage.getItem(storageKey) !== null) { setNotice("journey"); return; }
        const saved = sessionStorage.getItem(draftKey);
        if (saved) {
          const values = JSON.parse(saved) as Record<string, unknown>;
          // Only known text fields; incomplete values are fine (validated when continuing).
          setDraft(Object.fromEntries(Object.keys(initialDraft).map(k => [k, typeof values[k] === "string" ? (values[k] as string).slice(0, 254) : initialDraft[k as keyof CustomerDraft]])) as CustomerDraft); setNotice("draft");
        }
      } catch { try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ } }
    });
    return () => { alive = false; };
  }, [storageKey, draftKey]);
  const edit = (field: keyof CustomerDraft, value: string) => {
    const next = { ...draft, [field]: value }; setDraft(next); setFieldErrors({ ...fieldErrors, [field]: undefined });
    try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* drafts are optional */ }
  };
  const dropDraft = () => { try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ } };
  const discard = () => { dropDraft(); setDraft(initialDraft); setStep(0); setFieldErrors({}); setNotice(""); setError(""); };
  function next() {
    const problems: Partial<Record<keyof CustomerDraft, string>> = {};
    for (const field of stepFields[step]) if (!customerDraftSchema.shape[field].safeParse(draft[field]).success) problems[field] = draft[field].trim() ? field === "administratorEmail" ? "Correo no válido." : field === "businessTimezone" ? "Zona horaria no reconocida." : "Revisa este campo." : "Obligatorio.";
    setFieldErrors(problems); if (Object.keys(problems).length) return;
    setError(""); setStep(step + 1);
  }
  function recover() {
    try {
      const restored = CustomerJourney.restore(sessionStorage, storageKey);
      if (!restored) { setError("No hay una creación pendiente en este navegador."); setNotice(""); return; }
      journey.current = restored; setLocked(true); setDraft(restored.state.draft); setState(restored.state); setStep(5); setError(""); setNotice("");
    } catch { setError("No pudimos recuperar la solicitud. Consulta Clientes antes de iniciar otra creación."); }
  }
  async function create() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const parsed = customerDraftSchema.safeParse(draft);
      if (!parsed.success) { setError("Revisa los campos obligatorios, el correo y la zona horaria."); return; }
      journey.current ??= CustomerJourney.create(parsed.data, sessionStorage, storageKey);
      dropDraft(); setLocked(true); setState({ ...journey.current.state });
      const completed = await journey.current.run(); setState({ ...completed });
    } catch (failure) {
      if (journey.current) setState({ ...journey.current.state });
      const reason = failure instanceof Error ? failure.message : "unavailable";
      setError(reason === "authorization" ? "Tu sesión no permite esta operación. Inicia sesión con un operador autorizado y recupera la solicitud." : reason === "conflict" ? "La solicitud encontró un conflicto. Consulta Clientes antes de intentar una nueva creación." : reason === "recovery_required" ? "Hay una creación pendiente. Usa Revisar solicitud pendiente antes de continuar." : "No pudimos confirmar todos los pasos. Conservamos la solicitud: reintenta con los mismos datos o recupérala al volver. No inicies otra creación.");
    } finally { pending.current = false; setBusy(false); }
  }
  const review = step === 5;
  const group = (index: number) => <section key={steps[index]} className="space-y-2"><div className="flex items-center justify-between gap-3"><h3 className="font-black">{steps[index]}</h3>{!locked && <button type="button" className="btn-tertiary" aria-label={`Editar ${steps[index]}`} onClick={() => setStep(index)}>Editar</button>}</div>
    <TaskSummary rows={stepFields[index].map(field => [labels[field], draft[field]] as [string, React.ReactNode])} /></section>;
  return <section className="card space-y-5 p-4 sm:p-6" aria-labelledby="provisioning-step">
    <nav aria-label="Pasos de creación"><p className="mb-2 text-sm font-bold text-slate-600">Paso {step + 1} de {steps.length}</p>
      <ol className="flex flex-wrap gap-2">{steps.map((label, index) => { const done = index < step || !!state?.administrator, current = index === step && !state?.administrator;
        return <li key={label}>{done && !locked && index < 5
          ? <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-sm font-bold text-emerald-900" onClick={() => setStep(index)}><span aria-hidden>✓</span>{label}<span className="sr-only"> (completado, editar)</span></button>
          : <span aria-current={current ? "step" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-bold ${current ? "border-slate-900 bg-slate-900 text-white" : done ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "text-slate-500"}`}><span aria-hidden>{done ? "✓" : index + 1}</span>{label}</span>}</li>; })}</ol></nav>
    {notice === "journey" && !locked && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="flex-1 basis-60 text-sm"><strong>Hay una creación de cliente pendiente de confirmar en este navegador.</strong> Revísala antes de iniciar otra; no se reenviará sola.</p><button type="button" className="btn-secondary" onClick={recover}>Revisar solicitud pendiente</button></div>}
    {notice === "draft" && !locked && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="flex-1 basis-60 text-sm">Recuperamos datos sin enviar de esta sesión del navegador. Nada se ha creado.</p><ConfirmAction className="btn-secondary" label="Descartar borrador" question="¿Descartar los datos escritos? No se ha creado nada." onConfirm={discard} /></div>}
    <h2 id="provisioning-step" className="text-xl font-bold">{state?.administrator ? "Cliente creado" : steps[step]}</h2>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3">{error}</p>}
    {state?.administrator ? <TaskOutcome kind="success" title="Cliente creado">
      <p className="font-bold">Cliente y estructura inicial creados.</p><ul className="list-disc space-y-1 pl-5 text-sm"><li>{state.draft.accountName}: cliente, escuela, ubicación y cafetería registrados.</li><li>Solicitud de administrador preparada para {state.draft.administratorEmail}.</li></ul>
      <p>No se ha enviado una invitación ni otorgado acceso. Desde el cliente, genera su enlace privado de activación. Después de que guarde su contraseña, completa el mismo acceso preparado.</p>
      <Link className="btn" href={`/platform/clientes/${state.tenant!.account_id}`} onClick={() => { try { journey.current?.finish(); } catch { /* Keep recovery available. */ } }}>Ver cliente y completar administrador</Link>
    </TaskOutcome> : <>
      {!review ? <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); next(); }}>
        <p className="text-sm text-slate-600">{stepNotes[step]}</p>
        {stepFields[step].map((field, index) => <label className="block font-bold" key={field}>{labels[field]} *<input required autoFocus={index === 0} className="field mt-1 w-full" type={field === "administratorEmail" ? "email" : "text"} aria-invalid={!!fieldErrors[field] || undefined}
          maxLength={field.endsWith("Code") ? 64 : field === "administratorEmail" ? 254 : field === "businessTimezone" ? 100 : 200} value={draft[field]}
          onChange={(event) => edit(field, event.target.value)} />{hints[field] && <span className="mt-1 block text-sm font-normal text-slate-600">{hints[field]}</span>}{fieldErrors[field] && <span role="alert" className="mt-1 block text-sm text-red-800">{fieldErrors[field]}</span>}</label>)}
        <div className="flex flex-wrap gap-3 border-t pt-4">{step > 0 ? <button type="button" className="btn-secondary" onClick={() => setStep(step - 1)}>Anterior</button> : <Link className="btn-secondary" href="/platform/clientes">Cancelar</Link>}<button className="btn">Continuar</button></div>
        <p className="text-xs text-slate-500">Lo que escribes se conserva solo en esta sesión del navegador hasta crear el cliente o descartarlo.</p>
      </form> : <>
        <div className="space-y-4">{[0, 1, 2, 3, 4].map(group)}</div>
        <div className="space-y-1 rounded-xl border p-3 text-sm"><p className="font-bold">Qué hará «Crear cliente»</p><p>1. Registra en una sola operación el cliente, su escuela, la ubicación y la cafetería.</p><p>2. Prepara la solicitud del administrador inicial. No envía correo ni concede acceso.</p></div>
        {state?.tenant && <TaskOutcome kind="uncertain" title="Creación incompleta"><p className="font-bold">Cliente y estructura inicial creados.</p><p>La solicitud del administrador inicial aún no está confirmada. El cliente ya existe. El siguiente intento solo recupera o prepara su administrador.</p></TaskOutcome>}
        <div className="flex flex-wrap gap-3 border-t pt-4">{!locked && <button className="btn-secondary" onClick={() => setStep(4)}>Anterior</button>}
          <button className="btn" disabled={busy} onClick={create}>{busy ? "Procesando…" : locked ? "Reintentar la misma solicitud" : "Crear cliente"}</button>
          {state?.tenant && <Link className="btn-secondary" href={`/platform/clientes/${state.tenant.account_id}`}>Consultar cliente</Link>}
        </div>
        {locked && <p className="text-sm text-slate-600">Los datos y la solicitud permanecen fijos para evitar duplicados.</p>}
      </>}
    </>}
  </section>;
}
