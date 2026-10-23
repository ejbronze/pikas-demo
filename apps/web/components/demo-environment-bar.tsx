"use client";
import { useEffect, useRef, useState } from "react";
import { hasDemoFinancialJournal, requestDemoDeparture, type DemoDeparture } from "../lib/platform/demo-departure";
import { DemoPersonaSwitcher } from "./demo-persona-switcher";
import { experienceLabel, type SandboxPovCode } from "../lib/platform/sandbox-pov";
import type { DemoExperience } from "../lib/platform/demo-experiences";

export type DemoDepartureGuard = () => boolean;
// UX 11: the one persistent Demo indicator ("● Demo activo"), with the persona, the experience
// switcher and the global exit. It is the same bar in the Platform Demo shell, School Admin Demo,
// Cafetería Admin Demo and POS Demo. The same guarded action handles exit and switch. On uncertain
// transport, only the exact original key/body may be retried. Navigation always comes from the
// server; exit lands on the real Platform home.
export function DemoEnvironmentBar({ pov, context, persona, beforeLeave }: {
  pov: { session_id: string; pov_code: SandboxPovCode }; context?: string; persona?: string; beforeLeave?: DemoDepartureGuard;
}) {
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const pending = useRef<DemoDeparture | null>(null);
  const [stale, setStale] = useState(false);
  const staleDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (stale) staleDialog.current?.showModal(); }, [stale]);
  useEffect(() => {
    // A notification invalidates this tab; it never changes persona or replays work.
    const check = (event: StorageEvent) => { if (event.key === "pikas:demo:changed" && event.newValue !== pov.session_id) setStale(true); };
    window.addEventListener("storage", check);
    return () => window.removeEventListener("storage", check);
  }, [pov.session_id]);
  async function run(experience?: DemoExperience) {
    if (lock.current || stale) return;
    if (!pending.current) {
      if (beforeLeave) { if (!beforeLeave()) return; }
      else if (hasDemoFinancialJournal()) { setBlocked(true); return; }
    }
    lock.current = true; setBusy(true); setFailed(false);
    pending.current ??= { experience, key: crypto.randomUUID() };
    const attempt = pending.current;
    try {
      const { destination, sessionId } = await requestDemoDeparture(attempt);
      try { localStorage.setItem("pikas:demo:changed", sessionId ?? crypto.randomUUID()); } catch { /* server denial remains authoritative */ }
      window.location.assign(destination);
    } catch { setFailed(true); setBusy(false); lock.current = false; }
  }
  if (stale) return <dialog ref={staleDialog} onCancel={e => e.preventDefault()} className="m-auto max-w-[calc(100%-2rem)] rounded-xl p-0 backdrop:bg-slate-900/60" aria-labelledby="demo-changed-title"><div className="max-w-md rounded-xl border border-amber-400 bg-amber-50 p-6"><strong>DEMO</strong><h1 id="demo-changed-title" className="my-3 text-xl font-bold">La experiencia de demostración cambió en otra pestaña.</h1><p>Continúa para abrir la experiencia actual. No se recuperarán formularios ni operaciones de esta pestaña.</p><a className="btn mt-4" href="/platform/demostracion/continuar">Continuar</a></div></dialog>;
  return <aside aria-label="Entorno Demo" className="sticky top-0 z-40 border-b border-amber-300 bg-amber-100 text-sm text-amber-950">
    <div className="flex min-h-11 min-w-0 items-center gap-1 px-3">
      <span role="status" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-300/70 px-2 py-0.5 text-xs font-bold" title="Datos ficticios de demostración"><span aria-hidden>●</span>Demo activo</span>
      <span className="hidden min-w-0 truncate text-xs sm:inline">· {experienceLabel[pov.pov_code]}{persona ? ` · ${persona}` : ""}{context ? ` · ${context}` : ""}</span>
      <DemoPersonaSwitcher current={pov.pov_code} disabled={busy || failed} onSwitch={e => void run(e)} />
      <button className="ml-auto min-h-11 shrink-0 px-1 font-semibold underline disabled:opacity-50" disabled={busy || failed} onClick={() => void run()}>{busy ? "Saliendo…" : "Salir del Demo"}</button>
    </div>
    {blocked && <p role="alert" className="px-3 pb-3">Hay una operación pendiente de confirmar en esta pestaña. Resuélvela en Caja / POS antes de cambiar de experiencia o salir.</p>}
    {failed && <p role="alert" className="px-3 pb-3">No se pudo confirmar el cambio. <button className="min-h-11 underline" disabled={busy} onClick={() => void run()}>Reintentar la misma solicitud</button></p>}
  </aside>;
}
