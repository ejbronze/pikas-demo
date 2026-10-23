"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from "../task-window";
import { ProvisioningUsernameField, usernameProblem } from "../provisioning-username-field";
import { normalizeUsername } from "../../lib/identity/username";
import { sessionFetch } from "../../lib/auth/session-fetch";
import { isUsernameRejection, usernameRejectionMessage } from "../../lib/identity/provisioning";
import { staffAccessResponseSchema, suggestUsername, type StaffAccessResult } from "../../lib/identity/staff-access";
import { platformStaffAccessErrors } from "../../lib/platform/staff-access";

// UX 15: "Agregar personal POS" on the Platform — the same one-step workflow the Cafetería Admin has
// (UX 12B), reached from the customer's Personas y accesos. Person → cafetería and caja → review →
// create → one-time credential. Posts to the Platform route, which binds each step to the Platform's
// existing commands. Personal de caja only.
export type StaffCafeteria = { id: string; name: string; location: string; registers: { id: string; name: string; code: string }[] };
type Phase = 0 | 1 | "review" | "sending" | "success" | "rejected" | "uncertain";
const emailOk = (v: string) => !v.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

export function AddStaffAccessAction({ accountId, customerName, cafeterias }: { accountId: string; customerName: string; cafeterias: StaffCafeteria[] }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn" onClick={() => setOpen(true)}>Agregar personal POS</button>
    {open && <StaffAccessTask accountId={accountId} customerName={customerName} cafeterias={cafeterias} onClose={() => setOpen(false)} />}</>;
}

export function StaffAccessTask({ accountId, customerName, cafeterias, onClose }: { accountId: string; customerName: string; cafeterias: StaffCafeteria[]; onClose: () => void }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [username, setUsername] = useState(""), [touched, setTouched] = useState(false);
  const [cafeteriaId, setCafeteriaId] = useState(cafeterias.length === 1 ? cafeterias[0].id : ""), [registerId, setRegisterId] = useState("");
  const [phase, setPhase] = useState<Phase>(0), [problem, setProblem] = useState(""), [message, setMessage] = useState(""), [outcome, setOutcome] = useState<{ result: StaffAccessResult; temporary?: string } | null>(null), [copied, setCopied] = useState("");
  const sending = useRef(false);
  const cafeteria = cafeterias.find(c => c.id === cafeteriaId) ?? null, registers = cafeteria?.registers ?? [];
  const suggested = suggestUsername(name), effectiveUsername = normalizeUsername(touched ? username : suggested);
  const validate = (): string | null => !name.trim() ? "Escribe el nombre completo." : usernameProblem(effectiveUsername) ?? (!emailOk(email) ? "Ese correo no es válido. Déjalo vacío si no tiene." : null);
  const send = async () => {
    if (sending.current || !cafeteria) return;
    sending.current = true; setPhase("sending"); setMessage("");
    try {
      const response = await sessionFetch("/api/platform/customer-access/staff-access", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ accountId, cafeteriaId: cafeteria.id, display_name: name.trim(), email: email.trim() ? email.trim().toLowerCase() : null, username: effectiveUsername, register_id: registerId || null }) });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        const parsed = staffAccessResponseSchema.safeParse(payload);
        if (!parsed.success) { setMessage(platformStaffAccessErrors.operation_uncertain); setPhase("uncertain"); return; }
        setOutcome({ result: parsed.data.result, temporary: parsed.data.temporary_password }); setPhase("success"); return;
      }
      const code = typeof payload.error === "string" ? payload.error : "";
      if (isUsernameRejection(code)) { setProblem(usernameRejectionMessage(code)); setTouched(true); setUsername(effectiveUsername); setPhase(0); return; }
      if (response.status >= 500 || code === "operation_uncertain" || code === "authorization_unavailable") { setMessage(platformStaffAccessErrors.operation_uncertain); setPhase("uncertain"); return; }
      setMessage(platformStaffAccessErrors[code] ?? "No se pudo crear el acceso. Revisa los datos."); setPhase("rejected");
    } catch { setMessage(platformStaffAccessErrors.operation_uncertain); setPhase("uncertain"); }
    finally { sending.current = false; }
  };
  const next = (index: 0 | 1) => { if (index === 0) { const issue = validate(); if (issue) { setProblem(issue); return; } } if (index === 1 && !cafeteria) { setProblem("Elige la cafetería."); return; } setProblem(""); setPhase(index === 0 ? 1 : "review"); };
  const close = () => { const done = phase === "success"; setOutcome(null); onClose(); if (done) router.refresh(); };
  const registerName = (id: string | null | undefined) => registers.find(r => r.id === id)?.name ?? "";
  const editing = typeof phase === "number" || phase === "review";
  const footer = typeof phase === "number"
    ? <>{phase > 0 ? <button type="button" className="btn-secondary" onClick={() => setPhase(0)}>Atrás</button> : <TaskCancelButton>Cancelar</TaskCancelButton>}<button type="button" className="btn" onClick={() => next(phase)}>Continuar</button></>
    : {
      review: <><button type="button" className="btn-secondary" onClick={() => setPhase(1)}>Atrás</button><button type="button" className="btn" onClick={() => void send()}>Crear acceso</button></>,
      sending: <button type="button" className="btn" disabled>Creando acceso…</button>,
      success: <button type="button" className="btn" data-autofocus onClick={close}>Cerrar</button>,
      rejected: <><button type="button" className="btn-secondary" onClick={close}>Cerrar</button><button type="button" className="btn" onClick={() => setPhase(0)}>Revisar datos</button></>,
      uncertain: <><button type="button" className="btn-secondary" onClick={close}>Cerrar</button><button type="button" className="btn" onClick={() => void send()}>Reintentar la misma solicitud</button></>,
    }[phase];
  const r = outcome?.result;
  return <TaskWindow title="Agregar personal POS" context={customerName} steps={editing ? ["Persona", "Cafetería y caja", "Revisar"] : undefined} step={typeof phase === "number" ? phase : 2}
    busy={phase === "sending"} dirty={editing && (!!name || !!email || touched || !!registerId)} onClose={close} footer={<TaskActions>{footer}</TaskActions>}>
    <section hidden={phase !== 0} className="space-y-4">
      <p className="text-sm text-slate-600">Se crea el acceso en un paso: PIKAS sugiere el usuario, genera una contraseña temporal de un solo uso y concede el rol Personal de caja en la cafetería elegida. No se envía correo. Es el mismo flujo que usa el administrador de la cafetería.</p>
      <label className="block font-bold">Nombre completo *<input className="field mt-1 w-full" data-autofocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
      <ProvisioningUsernameField value={touched ? username : suggested} onChange={value => { setTouched(true); setUsername(value); }} />
      {!touched && suggested && <p className="text-sm text-slate-600">Sugerido por PIKAS a partir del nombre; puedes cambiarlo antes de confirmar.</p>}
      <label className="block font-bold">Correo (opcional)<input className="field mt-1 w-full" type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} autoCapitalize="none" autoComplete="off" />
        <span className="mt-1 block text-sm font-normal text-slate-600">Sin correo, la persona entra solo con su usuario y no podrá recuperar la contraseña por correo; PIKAS o la cafetería pueden emitirle una temporal desde Credenciales.</span></label>
    </section>
    <section hidden={phase !== 1} className="space-y-4">
      <label className="block font-bold">Cafetería *<select className="field mt-1 w-full" value={cafeteriaId} onChange={e => { setCafeteriaId(e.target.value); setRegisterId(""); }} required><option value="">Seleccionar cafetería</option>{cafeterias.map(c => <option key={c.id} value={c.id}>{c.name} · {c.location}</option>)}</select></label>
      {cafeteria && (registers.length ? <fieldset className="space-y-2"><legend className="font-bold">Caja en {cafeteria.name}</legend><p className="text-sm text-slate-600">La persona solo podrá abrir las cajas que tenga asignadas. La cafetería puede cambiarlo después en Cajas.</p>
        <label className="flex min-h-11 items-center gap-3"><input type="radio" name="platform-staff-register" checked={registerId === ""} onChange={() => setRegisterId("")} /><span>Asignar después</span></label>
        {registers.map(reg => <label key={reg.id} className="flex min-h-11 items-center gap-3"><input type="radio" name="platform-staff-register" checked={registerId === reg.id} onChange={() => setRegisterId(reg.id)} /><span>{reg.name} <span className="text-slate-500">· {reg.code}</span></span></label>)}</fieldset>
        : <p className="text-sm text-slate-600">{cafeteria.name} aún no tiene cajas activas. El administrador de la cafetería (o PIKAS desde Operación → Cajas) crea una y asigna a la persona desde allí.</p>)}
    </section>
    {problem && typeof phase === "number" && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-800">{problem}</p>}
    {phase === "review" && cafeteria && <><TaskSummary rows={[["Nombre", name.trim()], ["Rol POS", "Personal de caja"], ["Usuario", effectiveUsername], ["Correo", email.trim() ? email.trim().toLowerCase() : "Sin correo · entra solo con su usuario"], ["Cliente", customerName], ["Cafetería", `${cafeteria.name} · ${cafeteria.location}`], ["Caja", registerId ? registerName(registerId) : "Asignar después"]]} />
      <p className="text-sm text-slate-600">Al confirmar se crea el inicio de sesión y verás una contraseña temporal una sola vez. La persona deberá crear su propia contraseña al entrar.</p></>}
    {phase === "sending" && <TaskOutcome kind="pending" title="Creando acceso…"><p>No cierres esta ventana.</p></TaskOutcome>}
    {phase === "success" && r && cafeteria && <TaskOutcome kind="success" title="Listo para iniciar sesión">
      <TaskSummary rows={[["Nombre", r.display_name], ["Usuario", r.username ?? effectiveUsername], ["Rol POS", "Personal de caja"], ["Cafetería", cafeteria.name],
        ["Caja", r.register ? (r.register.assigned ? registerName(r.register.register_id) : `No se pudo asignar ${registerName(r.register.register_id)}: la cafetería la asigna en Cajas.`) : "Sin caja asignada todavía: la cafetería la asigna en Cajas."],
        ["Correo", r.email_kind === "real" ? email.trim().toLowerCase() : "Sin correo · entra solo con su usuario"]]} />
      {outcome?.temporary ? <>
        <p className="font-bold">Contraseña temporal (una sola vez)</p>
        <p className="rounded-lg border bg-white p-3 text-center font-mono text-xl font-black tracking-wider" aria-label="Contraseña temporal">{outcome.temporary}</p>
        <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(outcome.temporary ?? ""); setCopied("Contraseña copiada."); } catch { setCopied("No se pudo copiar; selecciónala y cópiala a mano."); } }}>Copiar contraseña</button>{copied && <span role="status" className="text-sm">{copied}</span>}</div>
        <p className="text-sm font-bold">Cópiala ahora: PIKAS no la guarda y no se volverá a mostrar. Vale 15 minutos si no se usa. Entrégala por un canal seguro.</p>
        <p className="text-sm">Cómo entra: en la pantalla de inicio de sesión escribe su usuario «{r.username ?? effectiveUsername}» y esta contraseña; PIKAS le pedirá crear una contraseña personal y luego podrá abrir su caja en el POS.</p>
      </> : <p>Esta persona ya tenía acceso a PIKAS y conserva su contraseña: solo se le concedió el rol en esta cafetería.</p>}
    </TaskOutcome>}
    {phase === "rejected" && <TaskOutcome kind="failure" title="No se creó el acceso">{message && <p>{message}</p>}</TaskOutcome>}
    {phase === "uncertain" && <TaskOutcome kind="uncertain" title="Pendiente de confirmar"><p>{message}</p><p className="text-sm">Si cierras sin confirmar, cualquier acceso preparado aparecerá en Pendientes.</p></TaskOutcome>}
  </TaskWindow>;
}
