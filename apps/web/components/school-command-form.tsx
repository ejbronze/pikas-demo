"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { commandSchema, type SchoolCommand } from "../lib/school/contracts";
import { loadCommand, prepareCommand, recoveryKey, sendCommand, type PendingCommand } from "../lib/school/command";
export function SchoolCommandForm({ actorId, schoolId, formId, operation, label, confirmation, children, makePayload }: { actorId: string; schoolId: string; formId: string; operation: SchoolCommand["operation"]; label: string; confirmation?: string; children?: React.ReactNode; makePayload: (data: FormData) => unknown }) {
  const router = useRouter();
  const storageKey = recoveryKey(actorId, schoolId, formId);
  const inFlight = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      try {
        const stored = loadCommand(sessionStorage, storageKey);
        if (stored && (stored.command.schoolId !== schoolId || (stored.command.operation !== operation && !( ["student_enroll", "student_transfer"].includes(operation) && ["student_enroll", "student_transfer"].includes(stored.command.operation))))) throw new Error("Invalid recovery");
        setPending(stored); setReady(true);
        if (stored) setMessage("Solicitud pendiente de confirmar. Reintenta la misma solicitud antes de editar.");
      } catch { setMessage("No se puede recuperar la solicitud. Las operaciones están bloqueadas."); }
    });
    return () => { alive = false; };
  }, [storageKey, schoolId, operation]);
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault();
    if (inFlight.current || !ready) return;
    const form = event.currentTarget;
    if (!pending && confirmation && !window.confirm(confirmation)) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const recovery = pending ?? loadCommand(sessionStorage, storageKey);
      const request = recovery ?? prepareCommand(sessionStorage, storageKey, commandSchema.parse({ schoolId, operation, payload: makePayload(new FormData(form)) }));
      setPending(request);
      const outcome = await sendCommand(request);
      // A rejected retry describes this attempt, not the original unresolved write.
      if (recovery && outcome !== "success") {
        setMessage("La operación anterior sigue sin confirmar. No podemos verificar su resultado con la sesión, permisos o estado actuales. Conservamos la misma solicitud; recupera el acceso y reintenta antes de editar.");
        return;
      }
      if (outcome === "uncertain") { setMessage("Resultado incierto. No crees otra solicitud: reintenta con la misma clave."); return; }
      sessionStorage.removeItem(storageKey); setPending(null);
      if (outcome === "success") { setMessage("Cambio confirmado."); form.reset(); router.refresh(); }
      else setMessage(outcome === "pending-identity" ? "Pendiente: la identidad debe registrarse y confirmar su correo antes de conceder acceso. No se ha otorgado autoridad." : "No se realizó el cambio. Revisa los datos, la matrícula, el estado y los permisos actuales.");
    } catch { setMessage("No se pudo preparar o recuperar la solicitud. No se ha enviado una nueva operación."); }
    finally { inFlight.current = false; setBusy(false); }
  }}><fieldset disabled={!ready || busy || pending !== null} className="space-y-3">{children}</fieldset><button type="submit" className="btn" disabled={!ready || busy}>{busy ? "Confirmando…" : pending ? "Confirmar solicitud pendiente" : label}</button>{message && <p className="text-sm text-slate-600" role="status">{message}</p>}</form>;
}
