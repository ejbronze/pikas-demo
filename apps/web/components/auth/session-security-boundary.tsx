"use client";

import { bindApplicationSession } from "../../lib/auth/session-fetch";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { applicationSessionSchema, protectedSurface, remainingSessionMs, type ApplicationSession } from "@/lib/auth/application-session";

type Snapshot = { session: ApplicationSession; observed: number; remaining: number };
type Message = { session_id: string; event: "activity" | "ended" };
const warningMs = 120_000;

export function SessionSecurityBoundary({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const surface = enabled ? protectedSurface(path) : null;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [masked, setMasked] = useState(true);
  const [ended, setEnded] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const current = useRef<Snapshot | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const lastTouch = useRef(-Infinity);
  const generation = useRef(0);
  const terminated = useRef(false);
  const warning = !!snapshot && !masked && remaining <= warningMs;

  const mask = useCallback((terminal = true) => { setMasked(true); if (terminal) { terminated.current = true; generation.current++; setEnded(true); } }, []);
  const logout = useCallback(async () => {
    const sid = current.current?.session.session_id;
    generation.current++; mask();
    if (!sid) return;
    channel.current?.postMessage({ session_id: sid, event: "ended" } satisfies Message);
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid }), signal: AbortSignal.timeout(10_000) });
      // No storage.clear(): unresolved journals survive same-tab reauthentication.
    } catch { /* The UI remains masked; the database deadline still denies protected requests. */ }
    finally { setBusy(false); }
  }, [mask]);

  const reconcile = useCallback(async (action: "status" | "activity", initial = false) => {
    if (!surface || inFlight.current || terminated.current) return;
    inFlight.current = true;
    const issued = generation.current;
    const started = performance.now();
    try {
      const response = await fetch("/api/auth/session", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ action, surface, ...(!initial && current.current ? { session_id: current.current.session.session_id } : {}) }) });
      if (issued !== generation.current) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 409) void logout();
        else mask(false);
        return;
      }
      const parsed = applicationSessionSchema.parse((await response.json()).session);
      if (issued !== generation.current) return;
      // Subtract the whole request duration conservatively. Browser wall-clock changes are irrelevant.
      const value = { session: parsed, observed: performance.now(), remaining: Math.max(0, remainingSessionMs(parsed) - (performance.now() - started)) };
      if (!initial && current.current && parsed.session_id !== current.current.session.session_id) { mask(); return; }
      bindApplicationSession(parsed.session_id);
      current.current = value; setSnapshot(value); setRemaining(value.remaining);
      if (value.remaining <= 0) { mask(); return; }
      setMasked(false); setEnded(false);
      if (action === "activity") channel.current?.postMessage({ session_id: parsed.session_id, event: "activity" } satisfies Message);
    } catch { if (issued === generation.current) mask(false); }
    finally { inFlight.current = false; }
  }, [surface, mask, logout]);

  useEffect(() => {
    if (!surface) return;
    void reconcile("status", !current.current);
    const bus = new BroadcastChannel("pikas:application-session:v1"); channel.current = bus;
    bus.onmessage = ({ data }: MessageEvent<Message>) => {
      if (data?.session_id !== current.current?.session.session_id) return;
      if (data.event === "ended") { generation.current++; mask(); }
      else if (data.event === "activity") void reconcile("status");
    };
    const resume = () => { if (document.visibilityState === "visible" && !ended) { mask(false); void reconcile("status"); } };
    const activity = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== "visible" || masked || ended || warning || performance.now() - lastTouch.current < 30_000) return;
      lastTouch.current = performance.now(); void reconcile("activity");
    };
    const submit = (event: Event) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && new URL(form.action).pathname === "/api/auth/logout") { event.preventDefault(); void logout(); }
    };
    const poll = setInterval(() => { if (!ended && document.visibilityState === "visible") void reconcile("status"); }, 60_000);
    document.addEventListener("visibilitychange", resume); window.addEventListener("focus", resume);
    document.addEventListener("pointerdown", activity, true); document.addEventListener("keydown", activity, true);
    document.addEventListener("submit", submit, true);
    return () => {
      clearInterval(poll); bus.close(); channel.current = null;
      document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", resume);
      document.removeEventListener("pointerdown", activity, true); document.removeEventListener("keydown", activity, true); document.removeEventListener("submit", submit, true);
    };
  }, [surface, reconcile, mask, logout, ended, masked, warning]);

  useEffect(() => {
    if (!surface || !snapshot || ended) return;
    const tick = () => {
      const left = Math.max(0, snapshot.remaining - (performance.now() - snapshot.observed)); setRemaining(left);
      if (left <= 0) void logout();
    };
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [surface, snapshot, ended, logout]);

  useEffect(() => {
    if (warning && !dialog.current?.open) { dialog.current?.showModal(); continueButton.current?.focus(); }
    else if (!warning) dialog.current?.close();
  }, [warning]);

  if (!surface) return children;
  return <>
    {/* Temporary reconciliation hides/inerts the workspace without losing an idle cart or draft.
        Terminal expiry unmounts it; durable recovery journals remain untouched. */}
    {!ended && snapshot && <div hidden={masked} inert={masked}>{children}</div>}
    {masked && <main className="p-8" aria-live="polite"><h1>{ended ? "Tu sesión se cerró" : "Verificando tu sesión"}</h1>
      <p>{ended ? "Vuelve a iniciar sesión para continuar. Las operaciones pendientes conservan su información de recuperación." : "Se requiere una sesión válida para mostrar la aplicación."}</p>
      <Link href="/login">Iniciar sesión</Link><p className="mt-3"><Link href="/backoffice/login">Acceso de Plataforma</Link></p></main>}
    <dialog ref={dialog} aria-labelledby="session-warning-title" aria-describedby="session-warning-description" onCancel={event => event.preventDefault()} className="max-w-md rounded-xl bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/40">
      <h2 id="session-warning-title">Tu sesión está por vencer</h2>
      <p id="session-warning-description">Por seguridad, tu sesión se cerrará en 2 minutos por inactividad.</p>
      <p aria-live="off">Tiempo restante: {Math.ceil(remaining / 1000)} segundos.</p>
      <div className="mt-4 flex gap-3"><button ref={continueButton} className="btn" type="button" disabled={busy} onClick={async () => { setBusy(true); await reconcile("activity"); setBusy(false); }}>Continuar sesión</button>
        <button className="btn-secondary" type="button" disabled={busy} onClick={() => void logout()}>Cerrar sesión</button></div>
    </dialog>
  </>;
}
