"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { customerDraftSchema, type CustomerDraft } from "../../../../lib/platform/customer-contracts";
import { CustomerJourney, journeyStorageKey, type CustomerJourneyState } from "../../../../lib/platform/customer-journey";

const steps = ["Cliente", "Escuela", "Ubicación", "Cafetería", "Administrador inicial", "Revisar"];
const initialDraft: CustomerDraft = { accountName: "", accountCode: "", schoolName: "", schoolCode: "", businessTimezone: "America/Santo_Domingo",
  locationName: "", locationCode: "", cafeteriaName: "", cafeteriaCode: "", administratorName: "", administratorEmail: "" };
const stepFields: Array<Array<keyof CustomerDraft>> = [["accountName", "accountCode"], ["schoolName", "schoolCode", "businessTimezone"],
  ["locationName", "locationCode"], ["cafeteriaName", "cafeteriaCode"], ["administratorName", "administratorEmail"]];
const labels: Record<keyof CustomerDraft, string> = { accountName: "Nombre del cliente", accountCode: "Código del cliente", schoolName: "Nombre de la escuela",
  schoolCode: "Código de la escuela", businessTimezone: "Zona horaria", locationName: "Nombre de la ubicación", locationCode: "Código de la ubicación",
  cafeteriaName: "Nombre de la cafetería", cafeteriaCode: "Código de la cafetería", administratorName: "Nombre del administrador", administratorEmail: "Correo del administrador" };

export function CustomerWizard({ actor }: { actor: string }) {
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<CustomerJourneyState | null>(null);
  const journey = useRef<CustomerJourney | null>(null);
  const pending = useRef(false);
  const storageKey = journeyStorageKey(actor);
  function recover() {
    try {
      const restored = CustomerJourney.restore(sessionStorage, storageKey);
      if (!restored) { setError("No hay una creación pendiente en este navegador."); return; }
      journey.current = restored; setLocked(true); setDraft(restored.state.draft); setState(restored.state); setStep(5); setError("");
    } catch { setError("No pudimos recuperar la solicitud. Consulta Clientes antes de iniciar otra creación."); }
  }
  async function create() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const parsed = customerDraftSchema.safeParse(draft);
      if (!parsed.success) { setError("Revisa los campos obligatorios, el correo y la zona horaria."); return; }
      journey.current ??= CustomerJourney.create(parsed.data, sessionStorage, storageKey);
      setLocked(true); setState({ ...journey.current.state });
      const completed = await journey.current.run(); setState({ ...completed });
    } catch (failure) {
      if (journey.current) setState({ ...journey.current.state });
      const reason = failure instanceof Error ? failure.message : "unavailable";
      setError(reason === "authorization" ? "Tu sesión no permite esta operación. Inicia sesión con un operador autorizado y recupera la solicitud." : reason === "conflict" ? "La solicitud encontró un conflicto. Consulta Clientes antes de intentar una nueva creación." : reason === "recovery_required" ? "Hay una creación pendiente. Usa Recuperar solicitud antes de continuar." : "No pudimos confirmar todos los pasos. Conservamos la solicitud: reintenta con los mismos datos o recupérala al volver. No inicies otra creación.");
    } finally { pending.current = false; setBusy(false); }
  }
  return <section className="card space-y-5 p-5">
    <p className="text-sm text-slate-600">{steps.join(" → ")}</p>
    {!locked && <button type="button" className="btn-outline" onClick={recover}>Recuperar solicitud pendiente</button>}
    <h2 className="text-xl font-bold">{steps[step]}</h2>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3">{error}</p>}
    {state?.tenant && <p role="status" className="rounded-lg bg-emerald-50 p-3">Cliente y estructura inicial creados.</p>}
    {state?.administrator ? <><p role="status">Solicitud de administrador preparada para {state.draft.administratorEmail}.</p>
      <p>No se ha enviado una invitación ni otorgado acceso. La identidad debe registrarse y confirmar su correo antes de completar el acceso.</p>
      <Link className="btn" href={`/platform/clientes/${state.tenant!.account_id}`} onClick={() => { try { journey.current?.finish(); } catch { /* Keep recovery available. */ } }}>Ver cliente y completar administrador</Link>
    </> : <>
      {step < 5 ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setError(""); setStep(step + 1); }}>
        {stepFields[step].map((field) => <label className="block" key={field}>{labels[field]}<input required className="field mt-1 w-full" type={field === "administratorEmail" ? "email" : "text"}
          maxLength={field.endsWith("Code") ? 64 : field === "administratorEmail" ? 254 : field === "businessTimezone" ? 100 : 200} value={draft[field]}
          onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} /></label>)}
        {step === 4 && <p className="text-sm text-slate-600">Se preparará acceso de administrador del cliente. El correo por sí solo no concede acceso; el registro y la confirmación todavía requieren configuración de invitaciones.</p>}
        <div className="flex gap-3">{step > 0 && <button type="button" className="btn-outline" onClick={() => setStep(step - 1)}>Anterior</button>}<button className="btn">Continuar</button></div>
      </form> : <><dl className="grid gap-3 sm:grid-cols-2">{Object.entries(labels).map(([field, label]) => <div key={field}><dt className="text-sm text-slate-600">{label}</dt><dd className="font-semibold">{draft[field as keyof CustomerDraft]}</dd></div>)}</dl>
        {state?.tenant && <p>El cliente ya existe. El siguiente intento solo recupera o prepara su administrador.</p>}
        <div className="flex flex-wrap gap-3">{!locked && <button className="btn-outline" onClick={() => setStep(4)}>Editar</button>}
          <button className="btn" disabled={busy} onClick={create}>{busy ? "Procesando…" : locked ? "Reintentar solicitud" : "Crear cliente"}</button>
          {state?.tenant && <Link className="btn-outline" href={`/platform/clientes/${state.tenant.account_id}`}>Consultar cliente</Link>}
        </div>
        {locked && <p className="text-sm text-slate-600">Los datos y la solicitud permanecen fijos para evitar duplicados.</p>}
      </>}
    </>}
  </section>;
}
