'use client';
import { useRef, useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { money } from '../lib/cafeteria/operations';
import { reversalReasons, reversalResultSchema, reversalSchema, type Reversal } from '../lib/wallet/contracts';
import { MoneyValue } from './money-value';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from './task-window';

export const reversalJournalKey = (actorId: string, schoolId: string, studentId: string) => `pikas:wallet-reversal:${actorId}:${schoolId}:${studentId}`;
export function loadPendingReversal(key: string): Reversal | null {
  const raw = sessionStorage.getItem(key);
  return raw === null ? null : reversalSchema.parse(JSON.parse(raw));
}
type Target = { replenishmentId: string; amountMinor: string; reference: string | null; note: string | null; occurredAt?: string };
type Phase = 'details' | 'confirm' | 'pending' | 'success' | 'rejected' | 'uncertain';

// Reverses the exact original recarga, in full and only once (Phase 5C.2), as a focused task.
// A negative resulting balance warns but never blocks. Typed values stay in memory; the existing
// recovery journal (exact key + payload) is written only at the explicit final action.
export function WalletReversalDialog({ schoolId, studentId, studentName, actorId, balanceMinor, target, onClose, onDone }:
  { schoolId: string; studentId: string; studentName: string; actorId: string; balanceMinor: string; target: Target; onClose: () => void; onDone: (message: string) => void }) {
  const key = reversalJournalKey(actorId, schoolId, studentId);
  const [request, setRequest] = useState<Reversal | null>(() => { try { const p = loadPendingReversal(key); return p && p.replenishment_id === target.replenishmentId ? p : null; } catch { return null; } });
  const [phase, setPhase] = useState<Phase>(request ? 'uncertain' : 'details');
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [rejection, setRejection] = useState('');
  const [after, setAfter] = useState<string | null>(null);
  const inFlight = useRef(false);
  const movement = `-${target.amountMinor}`;
  const preview = (BigInt(balanceMinor) - BigInt(target.amountMinor)).toString();
  const reasonLabel = (id: string) => reversalReasons.find(([r]) => r === id)?.[1] ?? id;
  const when = target.occurredAt ? new Date(target.occurredAt).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'medium', timeStyle: 'short' }) : null;
  const original: [string, React.ReactNode][] = [['Recarga original', <MoneyValue key="o" minor={target.amountMinor} intent="amount" />], ...(when ? [['Fecha', when] as [string, string]] : []),
    ...(target.reference ? [['Referencia', target.reference] as [string, string]] : []), ...(target.note ? [['Nota', target.note] as [string, string]] : [])];
  const review = () => {
    if (!reason) { setProblem('Selecciona el motivo de la reversión.'); return; }
    if (reason === 'other' && note.trim().length < 3) { setProblem('Explica el motivo (al menos 3 caracteres).'); return; }
    setProblem(''); setPhase('confirm');
  };
  const commit = async () => {
    if (inFlight.current) return;
    let outgoing: Reversal;
    try {
      outgoing = request ?? reversalSchema.parse({ operation: 'reverse', school_id: schoolId, student_id: studentId, replenishment_id: target.replenishmentId, reason, note: note.trim(), request_key: crypto.randomUUID() });
      sessionStorage.setItem(key, JSON.stringify(outgoing));
    } catch { setProblem('No se pudo preparar la reversión. No se envió.'); return; }
    inFlight.current = true; setRequest(outgoing); setPhase('pending');
    try {
      const response = await sessionFetch('/api/school/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': outgoing.request_key }, body: JSON.stringify(outgoing) });
      let payload: { result?: unknown; error?: string } = {};
      try { payload = await response.json(); } catch { /* uncertain */ }
      const parsed = reversalResultSchema.safeParse(payload.result);
      if (response.ok && parsed.success && parsed.data.replenishment_id === outgoing.replenishment_id) { sessionStorage.removeItem(key); setAfter(parsed.data.balance_after_minor); setPhase('success'); return; }
      if (response.status === 409 || [400, 401, 403, 422].includes(response.status)) {
        sessionStorage.removeItem(key); setRequest(null);
        setRejection(response.status === 409 ? 'Esta recarga ya fue revertida. Solo puede revertirse una vez.' : 'PIKAS rechazó la solicitud. No se movió dinero. Revisa el motivo y tus permisos.'); setPhase('rejected'); return;
      }
      setPhase('uncertain');
    } catch { setPhase('uncertain'); }
    finally { inFlight.current = false; }
  };
  const dirty = (phase === 'details' && !!(reason || note)) || phase === 'confirm';
  const close = () => { if (phase === 'success' && after) onDone(`Recarga revertida. Saldo resultante: ${money(after)}.`); else onClose(); };
  const footer = {
    details: <><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" onClick={review}>Continuar</button></>,
    confirm: <><button type="button" className="btn-secondary" onClick={() => setPhase('details')}>Atrás</button><button type="button" className="btn-destructive" onClick={() => void commit()}>Revertir recarga de {money(target.amountMinor)}</button></>,
    pending: <button type="button" className="btn" disabled>Revirtiendo recarga…</button>,
    success: <button type="button" className="btn" data-autofocus onClick={close}>Cerrar</button>,
    rejected: <button type="button" className="btn" data-autofocus onClick={onClose}>Cerrar</button>,
    uncertain: <><button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button><button type="button" className="btn" onClick={() => void commit()}>Reintentar la misma reversión</button></>,
  }[phase];
  return <TaskWindow title={phase === 'success' ? 'Recarga revertida' : 'Revertir recarga'} context={studentName}
    steps={phase === 'details' || phase === 'confirm' ? ['Detalles', 'Confirmar'] : undefined} step={phase === 'confirm' ? 1 : 0}
    busy={phase === 'pending'} dirty={dirty} onClose={close} footer={<TaskActions>{footer}</TaskActions>}>
    {(phase === 'details' || phase === 'confirm') && <TaskSummary rows={original} />}
    {phase === 'details' && <>
      <p className="text-sm">Se registra un movimiento negativo enlazado por el monto completo de esta recarga; la recarga original no se modifica. Solo puede revertirse una vez.</p>
      <label className="block font-bold">Motivo<select className="field mt-1" data-autofocus aria-label="Motivo de la reversión" value={reason} onChange={e => setReason(e.target.value)}><option value="">Selecciona un motivo</option>{reversalReasons.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="block font-bold">{reason === 'other' ? 'Explica el motivo' : 'Nota administrativa (opcional)'}<textarea className="field mt-1" aria-label={reason === 'other' ? 'Explica el motivo' : 'Nota administrativa'} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
      {problem && <p role="alert" className="font-bold text-red-800">{problem}</p>}
    </>}
    {phase === 'confirm' && <>
      <p className="font-bold">Revisa la reversión antes de registrarla.</p>
      <TaskSummary rows={[['Reversión', <MoneyValue key="r" minor={movement} intent="movement" />], ['Motivo', reasonLabel(reason)], ...(note.trim() ? [['Nota', note.trim()] as [string, string]] : []),
        ['Saldo actual', <MoneyValue key="b" minor={balanceMinor} intent="balance" />], ['Saldo resultante (estimado)', <MoneyValue key="c" minor={preview} intent="balance" />]]} />
      {BigInt(preview) < 0n && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-950">El saldo quedará negativo ({money(preview)}). El estudiante no podrá pagar con PIKAS Cash hasta que nuevas recargas cubran el saldo.</p>}
    </>}
    {phase === 'pending' && <TaskOutcome kind="pending" title="Revirtiendo la recarga…"><p>No cierres esta ventana. Reversión de <MoneyValue minor={movement} intent="movement" /> para {studentName}.</p></TaskOutcome>}
    {phase === 'success' && after && <TaskOutcome kind="success" title="Reversión registrada"><p className="text-2xl font-black"><MoneyValue minor={movement} intent="movement" /></p><p>Saldo actual de {studentName}: <MoneyValue minor={after} intent="balance" className="font-bold" /></p></TaskOutcome>}
    {phase === 'rejected' && <TaskOutcome kind="failure" title="No se realizó la reversión"><p>{rejection}</p></TaskOutcome>}
    {phase === 'uncertain' && request && <TaskOutcome kind="uncertain" title="Reversión pendiente de confirmar"><p>No sabemos si se registró la reversión de <MoneyValue minor={movement} intent="movement" />. Reintenta la misma reversión: PIKAS no la duplicará. No inicies otra.</p></TaskOutcome>}
  </TaskWindow>;
}
