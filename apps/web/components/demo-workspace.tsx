"use client";
import { useRef, useState } from "react";
import { hasDemoFinancialJournal } from "../lib/platform/demo-departure";
import { sessionFetch } from "../lib/auth/session-fetch";
import { demoExperiences, type DemoExperience } from "../lib/platform/demo-experiences";
import type { SandboxPovCode } from "../lib/platform/sandbox-pov";
import { DemoEnvironmentBar } from "./demo-environment-bar";
import type { SandboxLauncherState } from "../lib/platform/sandbox-launcher";
const groups = [{ label: "Administración", entries: demoExperiences.slice(0, 2) }, { label: "Operaciones", entries: demoExperiences.slice(2) }];
export function DemoWorkspace({ state, available }: { state: SandboxLauncherState; available: SandboxPovCode[] }) {
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const pending = useRef<{ experience: DemoExperience; key: string } | null>(null);
  const lock = useRef(false);
  async function enter(experience: DemoExperience) {
    if (lock.current) return;
    if (!pending.current && hasDemoFinancialJournal()) { setBlocked(true); return; }
    lock.current = true; setBusy(true); setFailed(false);
    pending.current ??= { experience, key: crypto.randomUUID() };
    const attempt = pending.current;
    try {
      const response = await sessionFetch("/api/platform/sandbox-pov/switch", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key }, body: JSON.stringify({ experience: attempt.experience }) });
      if (!response.ok) throw Error("unconfirmed");
      const { result } = await response.json();
      if (typeof result?.destination !== "string" || !/^\/(admin\/(escuela|cafeteria)\?|pos$)/.test(result.destination)) throw Error("invalid_destination");
      try { localStorage.setItem("pikas:demo:changed", result.session_id); } catch { /* optional notification */ }
      window.location.assign(result.destination);
    } catch { setBusy(false); setFailed(true); lock.current = false; }
  }
  if (state.kind === "hidden") return null;
  return <div className="space-y-5">
    {state.kind === "active" && <DemoEnvironmentBar pov={{ session_id: state.active.sessionId, pov_code: state.active.povCode }} />}
    {state.kind === "unavailable" && <p role="alert">No pudimos confirmar el entorno Demo. Actualiza la página.</p>}
    {blocked && <p role="alert">Hay una operación pendiente de confirmar en esta pestaña. <a className="underline" href="/platform/demostracion/continuar">Continuar en la experiencia actual para resolverla</a>.</p>}
    {failed && <p role="alert">No se pudo confirmar el cambio. <button className="btn-secondary" disabled={busy} onClick={() => pending.current && void enter(pending.current.experience)}>Reintentar la misma solicitud</button></p>}
    {groups.map(({ label: group, entries }) => <section key={group}><h2 className="mb-3 text-sm font-bold uppercase tracking-wide">{group}</h2><div className="grid gap-4 sm:grid-cols-2">{entries.map(e => <article className="card p-5" key={e.experience}><h3 className="text-xl font-bold">{e.label}</h3><p className="my-3 text-slate-600">{e.description}</p><button className="btn" disabled={busy || failed || !available.includes(e.code)} onClick={() => void enter(e.experience)}>Explorar {e.label}</button>{!available.includes(e.code) && <p className="mt-2 text-sm">No disponible en este entorno.</p>}</article>)}</div></section>)}
    <section><h2 className="mb-3 text-sm font-bold uppercase tracking-wide">Experiencias</h2><div className="grid gap-4 sm:grid-cols-2">{["Padre", "Estudiante"].map(label => <article className="rounded-xl border bg-slate-100 p-5 text-slate-600" key={label}><h3 className="text-xl font-bold">{label}</h3><p>Próximamente</p></article>)}</div></section>
  </div>;
}
