"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { schoolOnboardingDraftSchema, type SchoolOnboardingDraft } from "../../../../lib/platform/customer-contracts";
import { CustomerJourney, journeyStorageKey, type CustomerJourneyState } from "../../../../lib/platform/customer-journey";
import { DOMINICAN_REPUBLIC, dominicanProvinces, provinceName } from "../../../../lib/platform/dominican-provinces";
import { ConfirmAction } from "../../../../components/confirm-action";
import { TaskOutcome, TaskSummary } from "../../../../components/task-window";
import { usernameRejectionMessage } from "../../../../lib/identity/provisioning";

type Draft = Omit<SchoolOnboardingDraft, "countryCode" | "provinceCode"> & { countryCode: typeof DOMINICAN_REPUBLIC.code; provinceCode: string };
type Field = Exclude<keyof Draft, "countryCode">;
const initialDraft: Draft = { schoolName: "", taxId: "", addressLine: "", countryCode: DOMINICAN_REPUBLIC.code, provinceCode: "",
  administratorName: "", administratorUsername: "", administratorEmail: "" };
const schoolFields: Field[] = ["schoolName", "taxId", "addressLine", "provinceCode"];
const adminFields: Field[] = ["administratorName", "administratorUsername", "administratorEmail"];
const labels: Record<Field, string> = { schoolName: "Nombre", taxId: "RNC", addressLine: "Dirección", provinceCode: "Provincia",
  administratorName: "Nombre del administrador", administratorUsername: "Usuario PIKAS del administrador", administratorEmail: "Correo del administrador" };
const hints: Partial<Record<Field, string>> = { taxId: "9 dígitos (u 11 si es una cédula). Puedes escribir guiones.",
  administratorEmail: "El correo por sí solo no concede acceso.",
  administratorUsername: "3 a 40 caracteres: minúsculas, números y . _ -. Queda reservado; al activar su acceso podrá entrar con el usuario o con su correo." };
const invalid: Partial<Record<Field, string>> = { taxId: "RNC no válido.", administratorEmail: "Correo no válido.", administratorUsername: "Usuario no válido.", provinceCode: "Selecciona una provincia." };
const maxLength: Partial<Record<Field, number>> = { schoolName: 200, taxId: 13, addressLine: 300, administratorName: 200, administratorUsername: 40, administratorEmail: 254 };
// Browser-session draft (Wave D.3): typed values only, scoped to the real operator, never sent.
// Creating writes the onboarding journal instead, which then owns the request.
export const customerDraftKey = (actor: string) => `pikas:school-onboarding-draft:v2:${actor}`;

export function CustomerWizard({ actor }: { actor: string }) {
  const [draft, setDraft] = useState(initialDraft);
  const [review, setReview] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<CustomerJourneyState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
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
          setDraft({ ...initialDraft, ...Object.fromEntries([...schoolFields, ...adminFields].map(k => [k, typeof values[k] === "string" ? (values[k] as string).slice(0, 300) : initialDraft[k]])) }); setNotice("draft");
        }
      } catch { try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ } }
    });
    return () => { alive = false; };
  }, [storageKey, draftKey]);
  const edit = (field: Field, value: string) => {
    const next = { ...draft, [field]: value }; setDraft(next); setFieldErrors({ ...fieldErrors, [field]: undefined });
    try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* drafts are optional */ }
  };
  const dropDraft = () => { try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ } };
  const discard = () => { dropDraft(); setDraft(initialDraft); setReview(false); setFieldErrors({}); setNotice(""); setError(""); };
  function next() {
    const problems: Partial<Record<Field, string>> = {};
    for (const field of [...schoolFields, ...adminFields]) if (!schoolOnboardingDraftSchema.shape[field].safeParse(draft[field]).success) problems[field] = draft[field].trim() ? invalid[field] ?? "Revisa este campo." : "Obligatorio.";
    setFieldErrors(problems); if (Object.keys(problems).length) return;
    setError(""); setReview(true);
  }
  function recover() {
    try {
      const restored = CustomerJourney.restore(sessionStorage, storageKey);
      if (!restored) { setError("No hay una creación pendiente en este navegador."); setNotice(""); return; }
      journey.current = restored; setLocked(true); setDraft(restored.state.draft); setState(restored.state); setReview(true); setError(""); setNotice("");
    } catch { setError("No pudimos recuperar la solicitud. Consulta Clientes antes de iniciar otra creación."); }
  }
  async function create() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const parsed = schoolOnboardingDraftSchema.safeParse(draft);
      if (!parsed.success) { setError("Revisa los campos obligatorios, el RNC, la provincia y el correo."); return; }
      journey.current ??= CustomerJourney.create(parsed.data, sessionStorage, storageKey);
      dropDraft(); setLocked(true); setState({ ...journey.current.state });
      const completed = await journey.current.run(); setState({ ...completed });
    } catch (failure) {
      if (journey.current) setState({ ...journey.current.state });
      const reason = failure instanceof Error ? failure.message : "unavailable";
      if (reason.startsWith("username:") && journey.current?.state.tenant) {
        // A definite username rejection: the colegio exists; prepare its administrator from its page.
        try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
        setError(`El colegio se creó, pero su administrador no se preparó: ${usernameRejectionMessage(reason.slice(9))} Prepáralo desde el colegio con otro usuario.`); return;
      }
      setError(reason === "authorization" ? "Tu sesión no permite esta operación. Inicia sesión con un operador autorizado y recupera la solicitud." : reason === "conflict" ? "La solicitud encontró un conflicto. Consulta Clientes antes de intentar una nueva creación." : reason === "recovery_required" ? "Hay una creación pendiente. Usa Revisar solicitud pendiente antes de continuar." : "No pudimos confirmar todos los pasos. Conservamos la solicitud: reintenta con los mismos datos o recupérala al volver. No inicies otra creación.");
    } finally { pending.current = false; setBusy(false); }
  }
  const shown = (field: Field) => field === "provinceCode" ? provinceName(draft.provinceCode) : field === "taxId" ? draft.taxId.replace(/[\s-]/g, "") : draft[field];
  const summary = (title: string, fields: Field[], extra: [string, React.ReactNode][] = []) => <section className="space-y-2"><div className="flex items-center justify-between gap-3"><h3 className="font-black">{title}</h3>{!locked && <button type="button" className="btn-tertiary" aria-label={`Editar ${title}`} onClick={() => setReview(false)}>Editar</button>}</div>
    <TaskSummary rows={[...fields.map(field => [labels[field], shown(field)] as [string, React.ReactNode]), ...extra]} /></section>;
  const input = (field: Field, autoFocus = false) => <label className="block font-bold" key={field}>{labels[field]} *
    {field === "provinceCode"
      ? <select required className="field mt-1 w-full" aria-invalid={!!fieldErrors[field] || undefined} value={draft.provinceCode} onChange={(event) => edit(field, event.target.value)}><option value="">Seleccionar provincia</option>{dominicanProvinces.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
      : <input required autoFocus={autoFocus} className="field mt-1 w-full" type={field === "administratorEmail" ? "email" : "text"} inputMode={field === "taxId" ? "numeric" : undefined}
        {...(field === "administratorUsername" ? { autoCapitalize: "none", spellCheck: false, autoComplete: "off" } : {})} aria-invalid={!!fieldErrors[field] || undefined}
        maxLength={maxLength[field]} value={draft[field]} onChange={(event) => edit(field, event.target.value)} />}
    {hints[field] && <span className="mt-1 block text-sm font-normal text-slate-600">{hints[field]}</span>}{fieldErrors[field] && <span role="alert" className="mt-1 block text-sm text-red-800">{fieldErrors[field]}</span>}</label>;
  return <section className="card space-y-5 p-4 sm:p-6" aria-labelledby="onboarding-title">
    {notice === "journey" && !locked && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="flex-1 basis-60 text-sm"><strong>Hay un colegio pendiente de confirmar en este navegador.</strong> Revísalo antes de iniciar otro; no se reenviará solo.</p><button type="button" className="btn-secondary" onClick={recover}>Revisar solicitud pendiente</button></div>}
    {notice === "draft" && !locked && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="flex-1 basis-60 text-sm">Recuperamos datos sin enviar de esta sesión del navegador. Nada se ha creado.</p><ConfirmAction className="btn-secondary" label="Descartar borrador" question="¿Descartar los datos escritos? No se ha creado nada." onConfirm={discard} /></div>}
    <h2 id="onboarding-title" className="text-xl font-bold">{state?.administrator ? "Colegio agregado" : review ? "Revisar y agregar" : "Datos del colegio"}</h2>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3">{error}</p>}
    {state?.administrator && state.tenant ? <TaskOutcome kind="success" title="Colegio agregado">
      <p className="font-bold">{state.draft.schoolName} quedó registrado.</p>
      <TaskSummary rows={[["Código de referencia", state.tenant.school_code], ["Provincia", provinceName(state.draft.provinceCode)], ["Administrador", `${state.draft.administratorName} · ${state.draft.administratorEmail}`], ["Usuario reservado", state.draft.administratorUsername]]} />
      <p>Se creó su primera sede y cafetería. No se ha enviado una invitación ni otorgado acceso: desde el colegio, genera el enlace privado de activación del administrador. Después de que guarde su contraseña, completa el mismo acceso preparado.</p>
      <Link className="btn" href={`/platform/clientes/${state.tenant.account_id}`} onClick={() => { try { journey.current?.finish(); } catch { /* Keep recovery available. */ } }}>Ver colegio y completar administrador</Link>
    </TaskOutcome> : !review ? <form className="space-y-6" noValidate onSubmit={(event) => { event.preventDefault(); next(); }}>
      <fieldset className="space-y-4"><legend className="text-lg font-black">Colegio</legend>
        {input("schoolName", true)}{input("taxId")}{input("addressLine")}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block font-bold">País<input className="field mt-1 w-full bg-slate-100 text-slate-700" value={DOMINICAN_REPUBLIC.name} readOnly aria-readonly="true" /><span className="mt-1 block text-sm font-normal text-slate-600">Por ahora PIKAS opera en República Dominicana.</span></label>
          {input("provinceCode")}
        </div>
        <p className="text-sm text-slate-600">PIKAS genera el código del colegio. También se crean su sede principal y su cafetería principal.</p>
      </fieldset>
      <fieldset className="space-y-4 border-t pt-5"><legend className="sr-only">Administrador del colegio</legend><h3 aria-hidden="true" className="text-lg font-black">Administrador del colegio</h3>
        <p className="text-sm text-slate-600">Administrará estudiantes, padres y personal del colegio. Preparar su acceso no envía correo ni concede acceso.</p>
        {adminFields.map(field => input(field))}
      </fieldset>
      <div className="flex flex-wrap gap-3 border-t pt-4"><Link className="btn-secondary" href="/platform/clientes">Cancelar</Link><button className="btn">Revisar</button></div>
      <p className="text-xs text-slate-500">Lo que escribes se conserva solo en esta sesión del navegador hasta agregar el colegio o descartarlo.</p>
    </form> : <>
      <div className="space-y-4">{summary("Colegio", schoolFields.slice(0, 3), [["País", DOMINICAN_REPUBLIC.name], [labels.provinceCode, shown("provinceCode")]])}{summary("Administrador del colegio", adminFields)}</div>
      <div className="space-y-1 rounded-xl border p-3 text-sm"><p className="font-bold">Qué hará «Agregar colegio»</p><p>1. Registra en una sola operación el colegio con su código generado por PIKAS, su sede principal y su cafetería principal.</p><p>2. Prepara la solicitud de su administrador. No envía correo ni concede acceso.</p></div>
      {state?.tenant && <TaskOutcome kind="uncertain" title="Creación incompleta"><p className="font-bold">Colegio registrado ({state.tenant.school_code}).</p><p>La solicitud de su administrador aún no está confirmada. El colegio ya existe. El siguiente intento solo recupera o prepara su administrador.</p></TaskOutcome>}
      <div className="flex flex-wrap gap-3 border-t pt-4">{!locked && <button className="btn-secondary" onClick={() => setReview(false)}>Anterior</button>}
        <button className="btn" disabled={busy} onClick={create}>{busy ? "Procesando…" : locked ? "Reintentar la misma solicitud" : "Agregar colegio"}</button>
        {state?.tenant && <Link className="btn-secondary" href={`/platform/clientes/${state.tenant.account_id}`}>Consultar colegio</Link>}
      </div>
      {locked && <p className="text-sm text-slate-600">Los datos y la solicitud permanecen fijos para evitar duplicados.</p>}
    </>}
  </section>;
}
