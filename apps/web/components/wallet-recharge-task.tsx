'use client';
import { useRef, useState } from 'react';
import { load, prepare, send } from '../lib/wallet/command';
import { creditSchema, type Credit } from '../lib/wallet/contracts';
import { money } from '../lib/cafeteria/operations';
import { parseCash } from '../lib/pos/contracts';
import { MoneyValue } from './money-value';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from './task-window';

export const rechargeJournalKey = (actorId: string, schoolId: string, studentId: string) => `pikas:wallet:${actorId}:${schoolId}:${studentId}`;
type Phase = 'details' | 'confirm' | 'pending' | 'success' | 'rejected' | 'uncertain';

// Recarga as a focused task. Typed values live only in this component's memory. The only
// persisted state is the existing 5B recovery journal (exact key + payload), written at the
// explicit final action and cleared only by an authoritative outcome; it is never sent without
// an explicit user action ("Reintentar la misma recarga").
export function WalletRechargeTask({ schoolId, studentId, studentName, actorId, balanceMinor, onClose, onDone }: {
  schoolId: string; studentId: string; studentName: string; actorId: string; balanceMinor: string;
  onClose: () => void; onDone: (balanceAfterMinor: string) => void;
}) {
  const key = rechargeJournalKey(actorId, schoolId, studentId);
  const [recovery] = useState<Credit | null>(() => { try { return load(sessionStorage, key); } catch { return null; } });
  const [phase, setPhase] = useState<Phase>(recovery ? 'uncertain' : 'details');
  const [amount, setAmount] = useState(''), [reference, setReference] = useState(''), [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [request, setRequest] = useState<Credit | null>(recovery);
  const [balanceAfter, setBalanceAfter] = useState<string | null>(null);
  const inFlight = useRef(false);
  const amountMinor = parseCash(amount);
  const valid = amountMinor !== null && BigInt(amountMinor) > 0n && !!(reference.trim() || note.trim());
  const preview = amountMinor ? (BigInt(balanceMinor) + BigInt(amountMinor)).toString() : null;
  const review = () => {
    if (amountMinor === null || BigInt(amountMinor) <= 0n) { setProblem('Introduce un monto positivo con hasta dos decimales.'); return; }
    if (!reference.trim() && !note.trim()) { setProblem('Incluye la referencia de fondos verificados o una nota.'); return; }
    setProblem(''); setPhase('confirm');
  };
  const commit = async () => {
    if (inFlight.current) return;
    let command: Credit;
    const recovering = request !== null;
    try {
      command = request ?? prepare(sessionStorage, key, creditSchema.parse({ operation: 'replenish', school_id: schoolId, student_id: studentId,
        amount_minor: amountMinor, reference: reference.trim(), note: note.trim(), request_key: crypto.randomUUID() }));
    } catch { setProblem('No se pudo preparar la recarga. No se envió ninguna solicitud.'); return; }
    inFlight.current = true; setRequest(command); setPhase('pending');
    const result = await send(command);
    inFlight.current = false;
    if (result.outcome === 'success') { sessionStorage.removeItem(key); setBalanceAfter(result.result.balance_after_minor); setPhase('success'); return; }
    // A rejected first attempt is authoritative; a recovery attempt keeps the same request.
    if (result.outcome === 'rejected' && !recovering) { sessionStorage.removeItem(key); setRequest(null); setPhase('rejected'); return; }
    setPhase('uncertain');
  };
  const shown = request ? request.amount_minor : amountMinor;
  const dirty = phase === 'details' && !!(amount || reference || note) || phase === 'confirm' || phase === 'rejected';
  const close = () => { if (phase === 'success' && balanceAfter) onDone(balanceAfter); else onClose(); };
  return <TaskWindow title={phase === 'success' ? 'Recarga realizada' : 'Recargar PIKAS Cash'} context={studentName}
    steps={phase === 'details' || phase === 'confirm' ? ['Detalles', 'Confirmar'] : undefined} step={phase === 'confirm' ? 1 : 0}
    busy={phase === 'pending'} dirty={dirty} onClose={close}
    footer={<TaskActions>{{
      details: <><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" onClick={review}>Continuar</button></>,
      confirm: <><button type="button" className="btn-secondary" onClick={() => setPhase('details')}>Atrás</button><button type="button" className="btn" disabled={!valid} onClick={() => void commit()}>Recargar {money(amountMinor ?? '0')}</button></>,
      pending: <button type="button" className="btn" disabled>Registrando recarga…</button>,
      success: <button type="button" className="btn" data-autofocus onClick={close}>Cerrar</button>,
      rejected: <><TaskCancelButton>Cerrar</TaskCancelButton><button type="button" className="btn" onClick={() => setPhase('details')}>Revisar datos</button></>,
      uncertain: <><button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button><button type="button" className="btn" onClick={() => void commit()}>Reintentar la misma recarga</button></>,
    }[phase]}</TaskActions>}>
    {phase === 'details' && <>
      <p className="text-sm text-slate-600">Saldo actual <MoneyValue minor={balanceMinor} intent="balance" className="font-bold" /></p>
      <label className="block font-bold">Monto de la recarga (RD$)<input data-autofocus className="field mt-1" inputMode="decimal" autoComplete="off" maxLength={22} value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="block font-bold">Referencia de fondos verificados<input className="field mt-1" maxLength={160} value={reference} onChange={e => setReference(e.target.value)} /></label>
      <label className="block font-bold">Nota de verificación<textarea className="field mt-1" maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
      <p className="text-xs text-slate-600">Incluye la referencia o una nota. La recarga no registra efectivo en una caja ni amplía límites de gasto.</p>
      {problem && <p role="alert" className="font-bold text-red-800">{problem}</p>}
    </>}
    {phase === 'confirm' && amountMinor && preview && <>
      <p className="font-bold">Revisa la recarga antes de registrarla.</p>
      <TaskSummary rows={[['Estudiante', studentName], ['Recarga', <MoneyValue key="a" minor={amountMinor} intent="movement" />], ['Saldo actual', <MoneyValue key="b" minor={balanceMinor} intent="balance" />],
        ['Saldo resultante (estimado)', <MoneyValue key="c" minor={preview} intent="balance" />], ...(reference.trim() ? [['Referencia', reference.trim()] as [string, string]] : []), ...(note.trim() ? [['Nota', note.trim()] as [string, string]] : [])]} />
      <p className="text-sm text-slate-600">Se registra al pulsar «Recargar». El saldo final lo confirma PIKAS al registrar.</p>
      {problem && <p role="alert" className="font-bold text-red-800">{problem}</p>}
    </>}
    {phase === 'pending' && shown && <TaskOutcome kind="pending" title="Registrando la recarga…"><p>No cierres esta ventana. Recarga de <MoneyValue minor={shown} intent="movement" /> para {studentName}.</p></TaskOutcome>}
    {phase === 'success' && shown && balanceAfter && <TaskOutcome kind="success" title="Recarga registrada"><p className="text-2xl font-black"><MoneyValue minor={shown} intent="movement" /></p><p>Saldo actual de {studentName}: <MoneyValue minor={balanceAfter} intent="balance" className="font-bold" /></p></TaskOutcome>}
    {phase === 'rejected' && <TaskOutcome kind="failure" title="No se realizó la recarga"><p>PIKAS rechazó la solicitud. No se movió dinero. Revisa el monto, la inscripción, el estado de PIKAS Cash y tus permisos.</p></TaskOutcome>}
    {phase === 'uncertain' && request && <TaskOutcome kind="uncertain" title="Recarga pendiente de confirmar"><p>No sabemos si se registró la recarga de <MoneyValue minor={request.amount_minor} intent="movement" />. Reintenta la misma solicitud: PIKAS no la duplicará. No inicies otra recarga.</p>{request.reference && <p className="text-sm">Referencia: {request.reference}</p>}</TaskOutcome>}
  </TaskWindow>;
}
