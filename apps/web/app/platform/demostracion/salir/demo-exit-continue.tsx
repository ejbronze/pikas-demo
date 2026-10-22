"use client";
import { useRef, useState } from "react";
import { hasDemoFinancialJournal, requestDemoDeparture, type DemoDeparture } from "../../../../lib/platform/demo-departure";

// "Salir del Demo y continuar": the existing Demo exit, then the route the operator asked for. The
// server already validated `next`; the browser never chooses a destination of its own.
export function DemoExitContinue({ next }: { next: string }) {
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [blocked, setBlocked] = useState(false);
  const pending = useRef<DemoDeparture | null>(null), lock = useRef(false);
  async function run() {
    if (lock.current) return;
    if (!pending.current && hasDemoFinancialJournal()) { setBlocked(true); return; }
    lock.current = true; setBusy(true); setFailed(false);
    pending.current ??= { key: crypto.randomUUID() };
    try {
      const { sessionId } = await requestDemoDeparture(pending.current);
      try { localStorage.setItem("pikas:demo:changed", sessionId ?? pending.current.key); } catch { /* server state is authoritative */ }
      window.location.assign(next);
    } catch { setFailed(true); setBusy(false); lock.current = false; }
  }
  return <div className="space-y-2">
    <button type="button" className="btn w-full sm:w-auto" disabled={busy} onClick={() => void run()}>{busy ? "Saliendo del Demo…" : failed ? "Reintentar la misma solicitud" : "Salir del Demo y continuar"}</button>
    {blocked && <p role="alert" className="text-sm">Hay una operación pendiente de confirmar en esta pestaña. <a className="underline" href="/platform/demostracion/continuar">Resuélvela en la experiencia actual</a> antes de salir.</p>}
    {failed && <p role="alert" className="text-sm">No se pudo confirmar la salida del Demo. Sigues en modo Demo.</p>}
  </div>;
}
