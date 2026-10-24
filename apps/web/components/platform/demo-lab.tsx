"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PikasMascot } from "@pikas/ui/mascot";
import { sessionFetch } from "../../lib/auth/session-fetch";
import { hasDemoFinancialJournal } from "../../lib/platform/demo-departure";
import { sandboxDestination } from "../../lib/platform/sandbox-pov";
import { firstName, personaRole, resetMessages, resetResultSchema, sandboxReadiness, statusWord, type DemoPersona, type DemoSandbox } from "../../lib/platform/demo-lab";
import type { ActiveDemo } from "../../lib/platform/demo-state";
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from "../task-window";
import { ExitDemoButton } from "../../app/platform/sandbox-launcher-actions";

// Demo Lab: sandbox customers as cards, their personas as cards, "Abrir como {persona}" (the existing POV
// enter, then the role's real destination) and "Restaurar escenario inicial" (sandbox-only, confirmed).
// Technical ids stay out of the page; the authoritative state is always the server's.
const when = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
const roleWord = (code: string) => ({ pos_cashier: "Personal de caja", pos_supervisor: "Supervisor", cafeteria_admin: "Administrador de cafetería", school_admin: "Administración escolar" })[code] ?? code;

export function DemoLab({ sandboxes, active, canReset, operatorName }: { sandboxes: DemoSandbox[]; active: ActiveDemo | null; canReset: boolean; operatorName: string }) {
  return <div className="space-y-6">
    {active && <ActiveDemoCard active={active} />}
    {sandboxes.length === 0 ? <p className="card p-5" role="status">Todavía no hay entornos de demostración.</p>
      : sandboxes.map(s => <SandboxCard key={s.account_id} sandbox={s} active={active} canReset={canReset} operatorName={operatorName} />)}
  </div>;
}

function ActiveDemoCard({ active }: { active: ActiveDemo }) {
  const [busy, setBusy] = useState(false); const router = useRouter();
  // A full navigation on purpose: the destination renders another shell (School, Cafetería or POS).
  const go = () => { if (hasDemoFinancialJournal()) { router.push("/platform/demostracion/continuar"); return; } setBusy(true); window.location.href = sandboxDestination(active.povCode, active.schoolId, active.cafeteriaId); };
  return <section aria-labelledby="demo-active-title" className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-5">
    <p role="status" className="inline-flex items-center gap-1 rounded-full bg-amber-300/70 px-2 py-0.5 text-xs font-bold text-amber-950"><span aria-hidden>●</span>Demo activo</p>
    <h2 id="demo-active-title" className="mt-2 text-xl font-black">Estás dentro como {active.personaName}</h2>
    <p className="text-slate-700">{personaRole[active.povCode].role} · {active.cafeteriaName} · {active.accountName}. Vence {when(active.expiresAt).replace(/\.$/, "")}.</p>
    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
      <button type="button" className="btn" disabled={busy} onClick={go}>{busy ? "Abriendo…" : `Continuar como ${firstName(active.personaName)}`}</button>
      <ExitDemoButton />
    </div>
  </section>;
}

function SandboxCard({ sandbox, active, canReset, operatorName }: { sandbox: DemoSandbox; active: ActiveDemo | null; canReset: boolean; operatorName: string }) {
  const readiness = sandboxReadiness(sandbox);
  const cafeterias = sandbox.locations.flatMap(l => l.cafeterias.map(c => ({ ...c, location: l.name, locationStatus: l.status })));
  const purchases = cafeterias.reduce((n, c) => n + c.purchases, 0), openSessions = cafeterias.reduce((n, c) => n + c.open_sessions, 0);
  const thisActive = active?.accountId === sandbox.account_id;
  return <section aria-labelledby={`sandbox-${sandbox.account_id}`} className="card space-y-5 p-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Sandbox · Datos ficticios</p>
        <h2 id={`sandbox-${sandbox.account_id}`} className="text-xl font-black">{sandbox.name}</h2>
        <p className="mt-1 text-slate-700">Escenario <strong>Colegio Horizonte — Demo</strong>: un colegio con una sede y una cafetería lista para vender, cuatro estudiantes con PIKAS Cash, una caja asignada y un catálogo pequeño. Suficiente para demostrar el POS de inmediato.</p>
      </div>
      <div className="flex flex-wrap gap-1.5 text-sm">
        <span className={`chip ${readiness.ready ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950"}`}>{readiness.label}</span>
        <span className="chip bg-slate-100 text-slate-800">{statusWord(sandbox.status)}</span>
      </div>
    </header>
    <dl className="grid gap-3 text-sm sm:grid-cols-3">
      <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-600">Estructura</dt><dd className="font-bold">{sandbox.school?.name ?? "—"}</dd><dd className="text-slate-700">{cafeterias.map(c => `${c.location} · ${c.name}${c.status !== "active" ? ` (${statusWord(c.status).toLowerCase()})` : ""}`).join("; ")}</dd></div>
      <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-600">Datos</dt><dd className="font-bold">{sandbox.students} estudiantes · {sandbox.eligible_students} habilitados</dd><dd className="text-slate-700">{cafeterias.reduce((n, c) => n + c.products, 0)} productos · {cafeterias.reduce((n, c) => n + c.registers.filter(r => r.status === "active").length, 0)} cajas activas · {purchases} ventas{openSessions ? ` · ${openSessions} caja abierta` : ""}</dd></div>
      <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-600">Escenario inicial</dt><dd className="font-bold">{sandbox.last_reset ? `Restaurado ${when(sandbox.last_reset.at)}` : "Nunca restaurado"}</dd><dd className="text-slate-700">{sandbox.last_reset?.actor_name ? `por ${sandbox.last_reset.actor_name}` : sandbox.last_entered ? `Última entrada ${when(sandbox.last_entered)}` : "Datos del arranque"}</dd></div>
    </dl>
    <section aria-labelledby={`personas-${sandbox.account_id}`} className="space-y-3">
      <h3 id={`personas-${sandbox.account_id}`} className="font-black">Personas</h3>
      <ul className="grid gap-3 md:grid-cols-3">{sandbox.personas.map(p => <PersonaCard key={p.persona_id} persona={p} sandbox={sandbox} current={thisActive && active?.povCode === p.pov_code} />)}</ul>
      <p className="text-sm text-slate-600">Las personas no tienen inicio de sesión propio: se abren desde aquí con tu identidad de operador, que queda en la auditoría. En el Demo todo ocurre dentro de {sandbox.name}; los clientes reales no se tocan.</p>
    </section>
    {sandbox.sandbox_staff.length > 0 && <section aria-labelledby={`staff-${sandbox.account_id}`} className="space-y-2">
      <h3 id={`staff-${sandbox.account_id}`} className="font-black">Personal creado en el Demo <span className="font-normal text-slate-600">({sandbox.sandbox_staff.length})</span></h3>
      <ul className="divide-y rounded-xl border text-sm">{sandbox.sandbox_staff.map(s => <li key={s.person_id} className="flex flex-wrap items-center justify-between gap-2 p-3"><span className="font-bold">{s.display_name}</span><span className="text-slate-700">{roleWord(s.role_code)} · {s.cafeteria_name}{s.username ? ` · Usuario ${s.username}` : ""} · {statusWord(s.status)}</span></li>)}</ul>
      <p className="text-sm text-slate-600">Creado por el administrador de cafetería del Demo con el flujo normal de Personal POS (usuarios terminados en «.demo»). Entra con su usuario y la contraseña temporal que recibió. Restaurar el escenario lo retira.</p>
    </section>}
    {canReset && <ResetAction sandbox={sandbox} disabled={!!active} operatorName={operatorName} />}
  </section>;
}

function PersonaCard({ persona, sandbox, current }: { persona: DemoPersona; sandbox: DemoSandbox; current: boolean }) {
  const words = personaRole[persona.pov_code];
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState<string | null>(null), [blocked, setBlocked] = useState(false);
  const pending = useRef<string | null>(null);
  const open = async () => {
    if (busy) return;
    if (hasDemoFinancialJournal()) { setBlocked(true); return; }
    setBusy(true); setFailed(null);
    pending.current ??= crypto.randomUUID();
    try {
      const response = await sessionFetch("/api/platform/sandbox-pov/enter", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json", "Idempotency-Key": pending.current },
        body: JSON.stringify({ accountId: sandbox.account_id, cafeteriaId: persona.cafeteria_id, povCode: persona.pov_code }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setFailed(payload?.error === "demo_mode_active" ? "Ya hay un Demo activo en otra pestaña. Actualiza la página." : "No se pudo abrir el Demo. Inténtalo de nuevo."); setBusy(false); return; }
      try { localStorage.setItem("pikas:demo:changed", String(payload?.result?.session_id ?? crypto.randomUUID())); } catch { /* optional notification */ }
      window.location.href = sandboxDestination(persona.pov_code, persona.school_id ?? "", persona.cafeteria_id);
    } catch { setFailed("No se pudo abrir el Demo. Inténtalo de nuevo."); setBusy(false); }
  };
  const unavailable = !persona.valid || sandbox.status !== "active";
  return <li className={`flex flex-col gap-3 rounded-xl border p-4 ${current ? "border-amber-400 bg-amber-50" : "bg-white"}`}>
    <div className="min-w-0">
      <p className="text-lg font-black">{persona.display_name}</p>
      <p className="text-slate-700">{words.role}</p>
      <p className="mt-1 text-sm text-slate-700">{persona.pov_code === "school_admin" ? sandbox.school?.name ?? persona.cafeteria_name : persona.cafeteria_name}{persona.pov_code !== "school_admin" ? ` · ${persona.location_name}` : ""}</p>
      {persona.pov_code === "cashier" && <p className="text-sm text-slate-700">{persona.registers.length ? `Caja: ${persona.registers.join(", ")}` : "Sin caja asignada"}</p>}
      <p className="mt-1 text-sm text-slate-600">{words.verb}</p>
      <p className="mt-1 text-sm">{current ? <span className="chip bg-amber-200 text-amber-950">Demo activo con esta persona</span> : unavailable ? <span className="chip bg-slate-200 text-slate-900">No disponible{persona.membership_status && persona.membership_status !== "active" ? ` · acceso ${statusWord(persona.membership_status).toLowerCase()}` : ""}</span> : <span className="chip bg-emerald-100 text-emerald-900">Acceso {statusWord(persona.membership_status ?? "active").toLowerCase()}</span>}</p>
    </div>
    <div className="mt-auto space-y-2">
      <button type="button" className="btn w-full" disabled={busy || unavailable} onClick={() => void open()} aria-label={`Abrir como ${persona.display_name}`}>{busy ? "Abriendo…" : `Abrir como ${firstName(persona.display_name)}`}</button>
      {blocked && <p role="alert" className="text-sm">Hay una operación pendiente de confirmar en esta pestaña. <a className="underline" href="/platform/demostracion/continuar">Continúa en la experiencia actual para resolverla</a>.</p>}
      {failed && <p role="alert" className="text-sm text-red-700">{failed}</p>}
    </div>
  </li>;
}

function ResetAction({ sandbox, disabled, operatorName }: { sandbox: DemoSandbox; disabled: boolean; operatorName: string }) {
  const [open, setOpen] = useState(false);
  return <section aria-labelledby={`reset-${sandbox.account_id}`} className="rounded-xl border border-amber-300 bg-amber-50/60 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-64"><h3 id={`reset-${sandbox.account_id}`} className="font-black">Restaurar escenario inicial</h3>
        <p className="text-sm text-slate-700">Devuelve {sandbox.name} al escenario Colegio Horizonte — Demo: elimina ventas, sesiones de caja, movimientos de PIKAS Cash, productos, cajas, estudiantes y personal creados en el Demo, y vuelve a crear la línea base. Solo afecta este sandbox.</p></div>
      <button type="button" className="btn-secondary border-amber-400 text-amber-950" disabled={disabled} onClick={() => setOpen(true)}>Restaurar escenario inicial</button>
    </div>
    {disabled && <p className="mt-2 text-sm text-slate-700">Sal del Demo para restaurar: la restauración termina todas las sesiones Demo de este sandbox.</p>}
    {open && <ResetTask sandbox={sandbox} operatorName={operatorName} onClose={() => setOpen(false)} />}
  </section>;
}

type Outcome = { kind: "success"; result: Record<string, unknown> } | { kind: "failure" | "uncertain"; message: string };
function ResetTask({ sandbox, operatorName, onClose }: { sandbox: DemoSandbox; operatorName: string; onClose: () => void }) {
  const [typed, setTyped] = useState(""), [busy, setBusy] = useState(false), [outcome, setOutcome] = useState<Outcome | null>(null);
  const pending = useRef<string | null>(null);
  const ready = typed.trim().toUpperCase() === "RESTAURAR", done = outcome?.kind === "success", locked = outcome?.kind === "uncertain";
  const cafeterias = sandbox.locations.flatMap(l => l.cafeterias);
  const run = async () => {
    if (busy || (!locked && !ready)) return;
    setBusy(true); pending.current ??= crypto.randomUUID();
    try {
      const response = await sessionFetch("/api/platform/sandbox/reset", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(60000), headers: { "Content-Type": "application/json", "Idempotency-Key": pending.current }, body: JSON.stringify({ accountId: sandbox.account_id }) });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) { const parsed = resetResultSchema.safeParse(payload?.result); if (parsed.success) { setOutcome({ kind: "success", result: parsed.data }); setBusy(false); return; } }
      const code = typeof payload?.error === "string" ? payload.error : "";
      if (response.status >= 500 || code === "operation_uncertain" || code === "authorization_unavailable") setOutcome({ kind: "uncertain", message: "No pudimos confirmar la restauración. Reintenta la misma solicitud; no crees otra." });
      else setOutcome({ kind: "failure", message: resetMessages[code] ?? "No se pudo restaurar el escenario." });
    } catch { setOutcome({ kind: "uncertain", message: "No pudimos confirmar la restauración. Reintenta la misma solicitud; no crees otra." }); }
    setBusy(false);
  };
  const deleted = done ? (outcome.result.deleted as Record<string, number>) : null;
  const close = () => { onClose(); if (done) window.location.reload(); };
  return <TaskWindow title="Restaurar escenario inicial" context={sandbox.name} busy={busy} dirty={!!typed && !done && !locked} onClose={close}
    footer={done ? <TaskActions><button type="button" className="btn" onClick={close}>Listo</button></TaskActions>
      : <TaskActions><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn-destructive" disabled={busy || (!locked && !ready)} onClick={() => void run()}>{busy ? "Restaurando…" : locked ? "Reintentar la misma solicitud" : "Restaurar escenario inicial"}</button></TaskActions>}>
    {done ? <TaskOutcome kind="success" title="Escenario inicial restaurado"><p>{sandbox.name} volvió a la línea base Colegio Horizonte — Demo. Se eliminaron {deleted?.purchases ?? 0} ventas, {deleted?.register_sessions ?? 0} sesiones de caja, {deleted?.products ?? 0} productos, {deleted?.registers ?? 0} cajas y {deleted?.students ?? 0} estudiantes del estado anterior; {deleted?.people_retired ?? 0} personas creadas en el Demo fueron retiradas. Las personas del Demo y la auditoría se conservan.</p></TaskOutcome> : <>
      <TaskSummary rows={[["Sandbox", sandbox.name], ["Estado actual", `${sandbox.students} estudiantes · ${cafeterias.reduce((n, c) => n + c.products, 0)} productos · ${cafeterias.reduce((n, c) => n + c.purchases, 0)} ventas · ${sandbox.sandbox_staff.length} personal creado en el Demo`], ["Resultado", "Colegio Horizonte — Demo (línea base)"], ["Operador", operatorName]]} />
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li><strong>Se elimina</strong> dentro de este sandbox: ventas, sesiones y cierres de caja, movimientos y saldos de PIKAS Cash, estudiantes, productos, menús, cajas, asignaciones y el personal creado en el Demo (sus inicios de sesión se retiran).</li>
        <li><strong>Se conserva</strong>: el colegio, la sede y la cafetería, las tres personas del Demo, la auditoría y el historial de sesiones Demo.</li>
        <li>Toda sesión Demo abierta sobre este sandbox termina. Ningún cliente real se toca: la base de datos solo acepta esta acción para un sandbox.</li>
        <li>Es destructiva dentro del Demo y no se deshace; el escenario inicial vuelve a crearse de inmediato.</li>
      </ul>
      <label className="block font-bold">Escribe RESTAURAR para confirmar<input className="field mt-1 w-full" value={typed} disabled={busy || locked} autoCapitalize="characters" data-autofocus onChange={e => setTyped(e.target.value)} aria-describedby="reset-confirm-help" />
        <span id="reset-confirm-help" className="mt-1 block text-sm font-normal text-slate-600">Confirmación deliberada: la acción no se deshace.</span></label>
      {outcome && <TaskOutcome kind={outcome.kind} title={outcome.kind === "failure" ? "No se restauró el escenario" : "Resultado sin confirmar"}><p>{outcome.message}</p></TaskOutcome>}
    </>}
  </TaskWindow>;
}

export function DemoLabIntro() {
  // Rendered inside the page header's description paragraph: inline elements only.
  return <span className="flex flex-wrap items-center gap-4">
    <PikasMascot id="DEM-01" size={88} className="shrink-0" />
    <span className="min-w-0 flex-1 basis-64 text-slate-700">Explora PIKAS con clientes y datos ficticios sin afectar operaciones reales. Cada persona entra a la aplicación real con tu identidad de operador detrás; «Demo activo» se mantiene visible hasta que salgas.</span>
  </span>;
}
