'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { commandSchema, type SchoolCommand } from '../lib/school/contracts';
import { loadCommand, prepareCommand, recoveryKey, sendCommand, type PendingCommand } from '../lib/school/command';
import type { CommandResult } from './command-task';

const placementOps = ['student_enroll', 'student_transfer'];

// The SchoolCommandForm exact-request journal (same key, validation and outcome rules) for
// CommandTask. One journal per actor, school and formId; an unconfirmed request is resent unchanged.
export function useSchoolCommand(actorId: string, schoolId: string, formId: string, operation: SchoolCommand['operation']) {
  const router = useRouter();
  const storageKey = recoveryKey(actorId, schoolId, formId);
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      try {
        const stored = loadCommand(sessionStorage, storageKey);
        if (stored && (stored.command.schoolId !== schoolId || (stored.command.operation !== operation && !(placementOps.includes(operation) && placementOps.includes(stored.command.operation))))) throw new Error('Invalid recovery');
        setPending(stored); setReady(true);
      } catch { setFailed(true); }
    });
    return () => { alive = false; };
  }, [storageKey, schoolId, operation]);
  const submit = async (payload: () => unknown): Promise<CommandResult> => {
    if (inFlight.current || !ready) return { kind: 'uncertain', message: 'Confirma la solicitud pendiente antes de continuar.' };
    inFlight.current = true;
    let request: PendingCommand | null = null;
    try {
      const recovery = pending ?? loadCommand(sessionStorage, storageKey);
      request = recovery ?? prepareCommand(sessionStorage, storageKey, commandSchema.parse({ schoolId, operation, payload: payload() }));
      setPending(request);
      const outcome = await sendCommand(request);
      // A rejected retry describes this attempt, not the original unresolved write.
      if (recovery && outcome !== 'success') return { kind: 'uncertain', message: 'La operación anterior sigue sin confirmar. No podemos verificar su resultado con la sesión, permisos o estado actuales. Conservamos la misma solicitud; recupera el acceso y reintenta antes de editar.' };
      if (outcome === 'uncertain') return { kind: 'uncertain', message: 'Resultado incierto. No crees otra solicitud: reintenta con la misma clave.' };
      sessionStorage.removeItem(storageKey); setPending(null);
      if (outcome === 'success') { router.refresh(); return { kind: 'success' }; }
      return { kind: 'rejected', message: outcome === 'pending-identity' ? 'Pendiente: la identidad debe registrarse y confirmar su correo antes de conceder acceso. No se ha otorgado autoridad.' : 'Revisa los datos, la matrícula, el estado y los permisos actuales.' };
    } catch {
      return request ? { kind: 'uncertain', message: 'No se pudo confirmar la solicitud. Reintenta la misma solicitud; no crees otra.' } : { kind: 'rejected', message: 'No se pudo preparar la solicitud. No se ha enviado ninguna operación. Revisa los datos.' };
    } finally { inFlight.current = false; }
  };
  return { loaded: ready || failed, pending, submit, blocked: failed ? 'No se puede recuperar la solicitud. Las operaciones están bloqueadas.' : !ready ? 'Preparando…' : undefined };
}
