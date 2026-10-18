'use client';
import { useRef, useState } from 'react';
import { closeResultSchema, historyRequestSchema, money, type CloseRequest, type SessionHistory } from '../lib/cafeteria/operations';
import { operationsRequest } from '../lib/cafeteria/operations-client';
import { parseCash } from '../lib/pos/contracts';
import { MoneyValue } from './money-value';
import { ReconciliationDifference } from './reconciliation-difference';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from './task-window';

export const registerCloseJournalKey = (actorId: string, cafeteriaId: string) => `pikas:register-close:${actorId}:${cafeteriaId}`;
const reasons = [['administrative_recovery', 'Recuperación administrativa'], ['operator_unavailable', 'Operador no disponible'], ['operator_suspended', 'Operador suspendido'], ['auth_access_lost', 'Acceso perdido'], ['other', 'Otro']] as const;
type Phase = 'details' | 'confirm' | 'pending' | 'success' | 'rejected' | 'uncertain';

// Phase 5A Cafeteria Admin exceptional close as a financial task (Wave D.2, owner Option A).
// Not a blind count: this role already sees authoritative expected cash on Cajas and Reportes.
// The reviewed expected amount is sent exactly as before, so cafeteria_operations_close keeps its
// stale-expected protection. Typed values stay in memory; only the existing exact-request journal
// is written, at the final action, and it is retried only by an explicit user action.
export function RegisterCloseTask({ session, cafeteriaId, actorId, onClose, onClosed }: {
  session: SessionHistory; cafeteriaId: string; actorId: string; onClose: () => void; onClosed: (confirmed: boolean) => void;
}) {
  const key = registerCloseJournalKey(actorId, cafeteriaId);
  const [request, setRequest] = useState<CloseRequest | null>(() => {
    try { const raw = sessionStorage.getItem(key); if (!raw) return null; const stored = historyRequestSchema.parse(JSON.parse(raw)); return stored.operation === 'close' && stored.cafeteria_id === cafeteriaId ? stored : null; } catch { return null; }
  });
  const [phase, setPhase] = useState<Phase>(request ? 'uncertain' : 'details');
  const [counted, setCounted] = useState(''), [reason, setReason] = useState<CloseRequest['reason']>('administrative_recovery'), [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [closed, setClosed] = useState<SessionHistory | null>(null);
  const inFlight = useRef(false);
  const countedMinor = parseCash(counted);
  // Same 5A semantics as the stored capture: difference = counted − expected (estimate before close).
  const estimate = countedMinor !== null ? (BigInt(countedMinor) - BigInt(session.summary.expected_minor)).toString() : null;
  const reasonLabel = (id: string) => reasons.find(([r]) => r === id)?.[1] ?? id;
  const review = () => {
    if (countedMinor === null) { setProblem('Ingresa el efectivo contado con hasta dos decimales.'); return; }
    if (reason === 'other' && !note.trim()) { setProblem('Explica el motivo en la nota.'); return; }
    setProblem(''); setPhase('confirm');
  };
  const commit = async () => {
    if (inFlight.current) return;
    const recovering = request !== null;
    let body: CloseRequest;
    try {
      body = request ?? historyRequestSchema.parse({ operation: 'close', cafeteria_id: cafeteriaId, session_id: session.id, version: session.version, counted_minor: countedMinor,
        expected_minor: session.summary.expected_minor, reason, note, request_key: crypto.randomUUID() }) as CloseRequest;
      sessionStorage.setItem(key, JSON.stringify(body));
    } catch { setProblem('No se pudo preparar el cierre. No se envió.'); return; }
    inFlight.current = true; setRequest(body); setPhase('pending');
    try {
      const result = closeResultSchema.parse(await operationsRequest(body));
      if (result.request_key !== body.request_key || result.session.id !== body.session_id || result.session.status !== 'closed') throw Error('mismatch');
      sessionStorage.removeItem(key); setClosed(result.session); setPhase('success');
    } catch (error) {
      // As in 5A: only a definite rejection of a fresh request clears it; recovery keeps the same request.
      if (!recovering && error instanceof Error && 'definite' in error && error.definite) { sessionStorage.removeItem(key); setRequest(null); setPhase('rejected'); }
      else setPhase('uncertain');
    } finally { inFlight.current = false; }
  };
  const dirty = (phase === 'details' && !!(counted || note)) || phase === 'confirm';
  const finish = () => { if (phase === 'success') onClosed(true); else if (phase === 'rejected') onClosed(false); else onClose(); };
  const shownCounted = request?.counted_minor ?? countedMinor;
  const footer = {
    details: <><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" onClick={review}>Continuar</button></>,
    confirm: <><button type="button" className="btn-secondary" onClick={() => setPhase('details')}>Atrás</button><button type="button" className="btn" onClick={() => void commit()}>Cerrar caja con {money(countedMinor ?? '0', session.currency)}</button></>,
    pending: <button type="button" className="btn" disabled>Cerrando caja…</button>,
    success: <button type="button" className="btn" data-autofocus onClick={finish}>Cerrar</button>,
    rejected: <button type="button" className="btn" data-autofocus onClick={finish}>Revisar la sesión actualizada</button>,
    uncertain: <><button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button><button type="button" className="btn" onClick={() => void commit()}>Reintentar el mismo cierre</button></>,
  }[phase];
  return <TaskWindow title={phase === 'success' ? 'Caja cerrada' : 'Cerrar caja'} context={`${session.register_name} · ${session.register_code} · Operador: ${session.operator_name}`}
    steps={phase === 'details' || phase === 'confirm' ? ['Conteo', 'Revisar'] : undefined} step={phase === 'confirm' ? 1 : 0}
    busy={phase === 'pending'} dirty={dirty} onClose={finish} footer={<TaskActions>{footer}</TaskActions>}>
    {phase === 'details' && <>
      <p className="text-sm">Cierre administrativo excepcional de la sesión de otro operador. Es permanente y conserva las ventas y la atribución originales.</p>
      <label className="block font-bold">Efectivo contado (RD$)<input data-autofocus className="field mt-1" inputMode="decimal" autoComplete="off" value={counted} onChange={e => setCounted(e.target.value)} /></label>
      <label className="block font-bold">Motivo<select className="field mt-1" value={reason} onChange={e => setReason(e.target.value as CloseRequest['reason'])}>{reasons.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="block font-bold">{reason === 'other' ? 'Nota (obligatoria)' : 'Nota (opcional)'}<textarea className="field mt-1" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
      {problem && <p role="alert" className="font-bold text-red-800">{problem}</p>}
    </>}
    {phase === 'confirm' && countedMinor !== null && estimate !== null && <>
      <p className="font-bold">Revisa el cierre antes de confirmarlo.</p>
      <TaskSummary rows={[['Caja', `${session.register_name} · ${session.register_code}`], ['Efectivo contado', <MoneyValue key="c" minor={countedMinor} intent="amount" />],
        ['Efectivo esperado actual', <MoneyValue key="e" minor={session.summary.expected_minor} intent="balance" />], ['Diferencia estimada', <ReconciliationDifference key="d" minor={estimate} />],
        ['Motivo', reasonLabel(reason)], ...(note.trim() ? [['Nota', note.trim()] as [string, string]] : [])]} />
      <p className="text-sm text-slate-600">Si el esperado cambia antes de confirmar, PIKAS rechaza el cierre y deberás revisar el conteo actualizado. La conciliación final la guarda PIKAS al cerrar.</p>
      <p className="text-sm font-semibold">El cierre es permanente: la sesión no puede reabrirse ni aceptar ventas.</p>
    </>}
    {phase === 'pending' && shownCounted && <TaskOutcome kind="pending" title="Cerrando la caja…"><p>No cierres esta ventana. Conteo de <MoneyValue minor={shownCounted} intent="amount" />.</p></TaskOutcome>}
    {phase === 'success' && closed && closed.counted_minor !== null && <TaskOutcome kind="success" title="Cierre registrado">
      <TaskSummary rows={[['Contado', <MoneyValue key="c" minor={closed.counted_minor} intent="amount" />], ['Esperado', <MoneyValue key="e" minor={closed.summary.expected_minor} intent="balance" />],
        ['Diferencia', <ReconciliationDifference key="d" minor={closed.difference_minor} />]]} />
      <p className="text-sm">{closed.register_name} quedó cerrada{closed.closed_by ? ` por ${closed.closed_by}` : ''}. Valores guardados por PIKAS al cerrar.</p>
    </TaskOutcome>}
    {phase === 'rejected' && <TaskOutcome kind="failure" title="No se cerró la caja"><p>PIKAS rechazó el cierre: el esperado o la sesión cambiaron, o los datos no son válidos. No se registró ningún cierre. Revisa la sesión actualizada antes de intentarlo de nuevo.</p></TaskOutcome>}
    {phase === 'uncertain' && request && <TaskOutcome kind="uncertain" title="Cierre pendiente de confirmar"><p>No sabemos si se registró el cierre con <MoneyValue minor={request.counted_minor} intent="amount" /> contado. Reintenta el mismo cierre: PIKAS no lo duplicará. No inicies otro.</p></TaskOutcome>}
  </TaskWindow>;
}
