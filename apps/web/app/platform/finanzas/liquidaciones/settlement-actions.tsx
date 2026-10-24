'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionFetch } from '../../../../lib/auth/session-fetch';
import { money } from '../../../../lib/cafeteria/operations';
import { parseAmount, platformDirection, reviewReasonLabel, reviewReasons, settledByOthers, settlementMessage, settlementResultSchema, weekLabel,
  type SettlementDirection, type SettlementStatus } from '../../../../lib/platform/settlements';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from '../../../../components/task-window';

type Kind = 'run' | 'finalize' | 'payment' | 'review_open' | 'review_resolve';
// The exact request (key + body) is kept until PIKAS answers, so a retry can only replay it.
type Pending = { kind: Kind; key: string; body: Record<string, string | null> };
const journalKey = (actor: string, target: string) => `pikas:settlement:${actor}:${target}`;
function loadPending(actor: string, target: string): Pending | null {
  try { const raw = sessionStorage.getItem(journalKey(actor, target)); return raw ? JSON.parse(raw) as Pending : null; } catch { return null; }
}
type Target = { id: string; title: string; rows: [string, React.ReactNode][]; direction?: SettlementDirection; net?: string };

// Finalize every ended week (the same idempotent operation a scheduler can call later).
export function RunSettlements({ actor, count }: { actor: string; count: number }) {
  return <SettlementAction actor={actor} target={{ id: 'run', title: 'Liquidar semanas cerradas', rows: [['Semanas por liquidar', String(count)]] }} kinds={['run']} />;
}

export function FinalizeSettlement({ actor, cafeteriaId, cafeteria, weekStart, weekEnd, direction, net }: {
  actor: string; cafeteriaId: string; cafeteria: string; weekStart: string; weekEnd: string; direction: SettlementDirection; net: string;
}) {
  return <SettlementAction actor={actor} target={{ id: `${cafeteriaId}:${weekStart}`, title: weekLabel(weekStart, weekEnd),
    rows: [['Cafetería', cafeteria], ['Semana', weekLabel(weekStart, weekEnd)], ['Resultado', platformDirection[direction]], ['Neto', money(net)]], direction, net }}
    kinds={['finalize']} body={{ cafeteria_id: cafeteriaId, week_start: weekStart }} />;
}

export function SettlementActions({ actor, reference, cafeteria, week, status, direction, net }: {
  actor: string; reference: string; cafeteria: string; week: string; status: SettlementStatus; direction: SettlementDirection; net: string;
}) {
  if (status === 'settled') return <p className="card p-4 text-sm">Sin acciones pendientes. La liquidación y su historial se conservan.</p>;
  const kinds: Kind[] = status === 'due' ? ['payment', 'review_open'] : ['payment', 'review_resolve'];
  return <SettlementAction actor={actor} target={{ id: reference, title: reference, rows: [['Liquidación', reference], ['Cafetería', cafeteria], ['Semana', week], ['Resultado', platformDirection[direction]], ['Neto', money(net)]], direction, net }}
    kinds={kinds} body={{ reference }} />;
}

const label: Record<Kind, string> = { run: 'Liquidar semanas cerradas', finalize: 'Calcular liquidación', payment: 'Confirmar pago', review_open: 'Poner en revisión', review_resolve: 'Resolver revisión' };

function SettlementAction({ actor, target, kinds, body = {} }: { actor: string; target: Target; kinds: Kind[]; body?: Record<string, string> }) {
  const router = useRouter();
  const [task, setTask] = useState<Kind | null>(null), [message, setMessage] = useState(''), [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => { let alive = true; queueMicrotask(() => { if (alive) setPending(loadPending(actor, target.id)); }); return () => { alive = false; }; }, [actor, target.id]);
  const done = (text: string, next?: string) => { setTask(null); setPending(null); setMessage(text); if (next) router.push(next); else router.refresh(); };
  const paymentLabel = target.direction === 'clearing_to_cafeteria' ? 'Confirmar pago a la cafetería' : 'Confirmar pago recibido';
  return <div className="space-y-3">
    {message && <p role="status" className="card p-4 font-bold">{message}</p>}
    {pending && !task ? <section className="card space-y-3 border-amber-300 p-5" aria-label="Operación pendiente"><p className="font-bold">Hay una operación sin confirmar.</p>
      <p className="text-sm">Reintenta la misma operación: PIKAS no la duplicará.</p><button type="button" className="btn" onClick={() => setTask(pending.kind)}>Revisar operación pendiente</button></section>
      : <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{kinds.map((k, i) => <button key={k} type="button" className={i === 0 ? 'btn' : 'btn-secondary'} onClick={() => { setMessage(''); setTask(k); }}>
        {k === 'payment' ? paymentLabel : label[k]}</button>)}</div>}
    {task && <SettlementTask kind={task} actor={actor} target={target} base={body} recovered={pending?.kind === task ? pending : null}
      onClose={() => { setTask(null); setPending(loadPending(actor, target.id)); }} onDone={done} />}
  </div>;
}

type Phase = 'details' | 'confirm' | 'pending' | 'success' | 'rejected' | 'uncertain';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });

function SettlementTask({ kind, actor, target, base, recovered, onClose, onDone }: {
  kind: Kind; actor: string; target: Target; base: Record<string, string>; recovered: Pending | null; onClose: () => void; onDone: (message: string, next?: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>(recovered ? 'uncertain' : kind === 'run' || kind === 'finalize' ? 'confirm' : 'details');
  const [amount, setAmount] = useState(''), [reference, setReference] = useState(''), [paidOn, setPaidOn] = useState(today()), [reason, setReason] = useState(''), [note, setNote] = useState('');
  const [problem, setProblem] = useState(''), [refusal, setRefusal] = useState({ text: '', settled: false }), [outcome, setOutcome] = useState(''), [next, setNext] = useState<string | undefined>();
  const inFlight = useRef(false);
  // Once sent, the exact request is the only one this task may send again.
  const sent = useRef<Pending | null>(recovered);
  const amountMinor = parseAmount(amount);
  const command = (): Record<string, string | null> => kind === 'run' ? { operation: 'run' } : kind === 'finalize' ? { operation: 'finalize', ...base }
    : kind === 'payment' ? { operation: 'payment', ...base, amount_minor: amountMinor, payment_reference: reference.trim(), paid_on: paidOn, note: note.trim() }
    : { operation: 'review', ...base, action: kind === 'review_open' ? 'open' : 'resolve', reason: kind === 'review_open' ? reason : null, note: note.trim() };
  const review = () => {
    if (kind === 'payment' && !amountMinor) { setProblem('Escribe el monto con hasta dos decimales.'); return; }
    if (kind === 'payment' && reference.trim().length < 3) { setProblem('Escribe la referencia del pago (al menos 3 caracteres).'); return; }
    if (kind === 'payment' && (!paidOn || paidOn > today())) { setProblem('La fecha del pago no puede ser futura.'); return; }
    if (kind === 'review_open' && !reason) { setProblem('Selecciona el motivo de la revisión.'); return; }
    if ((kind === 'review_resolve' || reason === 'other') && note.trim().length < 3) { setProblem('Escribe una nota (al menos 3 caracteres).'); return; }
    setProblem(''); setPhase('confirm');
  };
  const commit = async () => {
    if (inFlight.current) return;
    const outgoing: Pending = sent.current ?? { kind, key: crypto.randomUUID(), body: command() };
    sent.current = outgoing;
    try { sessionStorage.setItem(journalKey(actor, target.id), JSON.stringify(outgoing)); } catch { setProblem('No se pudo preparar la operación. No se envió.'); return; }
    inFlight.current = true; setPhase('pending');
    try {
      const response = await sessionFetch('/api/platform/finance/settlement', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': outgoing.key }, body: JSON.stringify(outgoing.body) });
      let payload: { result?: unknown; error?: string } = {};
      try { payload = await response.json(); } catch { /* uncertain */ }
      const parsed = settlementResultSchema.safeParse(payload.result);
      if (response.ok && parsed.success) {
        sessionStorage.removeItem(journalKey(actor, target.id));
        const r = parsed.data;
        if (kind === 'finalize' && 'reference' in r) setNext(`/platform/finanzas/liquidaciones/${r.reference}`);
        setOutcome('count' in r ? (r.count ? `Se calcularon ${r.count} liquidaciones.` : 'No había semanas nuevas por liquidar.')
          : r.status === 'settled' ? (r.net_direction === 'none' ? `${r.reference}: sin saldo pendiente, liquidada.` : `${r.reference} quedó liquidada.`)
          : r.status === 'in_review' ? (kind === 'payment' ? `El monto no coincide con ${money(r.net_amount_minor)}. El pago quedó registrado y ${r.reference} pasó a revisión.` : `${r.reference} quedó en revisión.`)
          : `${r.reference}: ${platformDirection[r.net_direction].toLowerCase()} ${money(r.net_amount_minor)}.`);
        setPhase('success'); return;
      }
      if ([400, 401, 403, 409, 422].includes(response.status)) {
        sessionStorage.removeItem(journalKey(actor, target.id));
        setRefusal({ text: settlementMessage(payload.error), settled: settledByOthers.has(payload.error ?? '') }); setPhase('rejected'); return;
      }
      setPhase('uncertain');
    } catch { setPhase('uncertain'); }
    finally { inFlight.current = false; }
  };
  const isPayout = target.direction === 'clearing_to_cafeteria';
  const title = kind === 'payment' ? (isPayout ? 'Confirmar pago a la cafetería' : 'Confirmar pago recibido') : label[kind];
  const footer = {
    details: <><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" onClick={review}>Continuar</button></>,
    confirm: <>{kind === 'run' || kind === 'finalize' ? <TaskCancelButton>Cancelar</TaskCancelButton> : <button type="button" className="btn-secondary" onClick={() => setPhase('details')}>Atrás</button>}
      <button type="button" className="btn" onClick={() => void commit()}>{kind === 'payment' ? `Confirmar ${money(amountMinor ?? '0')}` : label[kind]}</button></>,
    pending: <button type="button" className="btn" disabled>Procesando…</button>,
    success: <button type="button" className="btn" data-autofocus onClick={() => onDone(outcome, next)}>{next ? 'Abrir liquidación' : 'Cerrar'}</button>,
    rejected: <button type="button" className="btn" data-autofocus onClick={() => refusal.settled ? onDone(refusal.text) : onClose()}>{refusal.settled ? 'Ver estado actual' : 'Cerrar'}</button>,
    uncertain: <><button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button><button type="button" className="btn" onClick={() => void commit()}>Reintentar la misma operación</button></>,
  }[phase];
  const mismatch = kind === 'payment' && amountMinor && target.net && amountMinor !== target.net;
  return <TaskWindow title={phase === 'success' ? 'Operación registrada' : title} context={target.title}
    steps={kind !== 'run' && kind !== 'finalize' && (phase === 'details' || phase === 'confirm') ? ['Detalles', 'Confirmar'] : undefined} step={phase === 'confirm' ? 1 : 0}
    busy={phase === 'pending'} dirty={(phase === 'details' && !!(amount || reference || reason || note)) || (phase === 'confirm' && kind !== 'run' && kind !== 'finalize')} onClose={onClose}
    footer={<TaskActions>{footer}</TaskActions>}>
    {(phase === 'details' || phase === 'confirm') && <TaskSummary rows={target.rows} />}
    {phase === 'details' && kind === 'payment' && <>
      <p className="text-sm">{isPayout ? 'Registra el pago que PIKAS hizo a la cafetería fuera de PIKAS (transferencia o depósito).' : 'Registra el pago que la cafetería envió a PIKAS. Confírmalo solo después de comprobarlo en el banco.'} PIKAS no mueve dinero: solo registra la confirmación.</p>
      <label className="block font-bold">Monto (RD$)<input className="field mt-1" data-autofocus inputMode="decimal" autoComplete="off" aria-label="Monto del pago" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="block font-bold">Referencia del pago<input className="field mt-1" maxLength={120} autoComplete="off" aria-label="Referencia del pago" value={reference} onChange={e => setReference(e.target.value)} /></label>
      <label className="block font-bold">Fecha del pago<input className="field mt-1" type="date" max={today()} aria-label="Fecha del pago" value={paidOn} onChange={e => setPaidOn(e.target.value)} /></label>
      <label className="block font-bold">Nota (opcional)<textarea className="field mt-1" maxLength={500} aria-label="Nota" value={note} onChange={e => setNote(e.target.value)} /></label>
      {mismatch && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">El monto no coincide con el neto de {money(target.net!)}. Se registrará el pago y la liquidación pasará a revisión; no se liquida parcialmente.</p>}
    </>}
    {phase === 'details' && kind === 'review_open' && <>
      <p className="text-sm">La revisión no cambia los totales. Las correcciones se registran como movimientos nuevos que entran en una liquidación posterior.</p>
      <label className="block font-bold">Motivo<select className="field mt-1" data-autofocus aria-label="Motivo de la revisión" value={reason} onChange={e => setReason(e.target.value)}><option value="">Selecciona un motivo</option>{reviewReasons.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
      <label className="block font-bold">{reason === 'other' ? 'Explica el motivo' : 'Nota (opcional)'}<textarea className="field mt-1" maxLength={500} aria-label={reason === 'other' ? 'Explica el motivo' : 'Nota'} value={note} onChange={e => setNote(e.target.value)} /></label>
    </>}
    {phase === 'details' && kind === 'review_resolve' && <>
      <p className="text-sm">Al resolver, la liquidación vuelve a quedar pendiente de pago con los mismos totales.</p>
      <label className="block font-bold">Resolución<textarea className="field mt-1" data-autofocus maxLength={500} aria-label="Resolución" value={note} onChange={e => setNote(e.target.value)} /></label>
    </>}
    {problem && <p role="alert" className="font-bold text-red-800">{problem}</p>}
    {phase === 'confirm' && <p className="font-bold">{kind === 'run' ? 'Se calcula la liquidación de cada semana cerrada. Repetirlo no duplica nada.'
      : kind === 'finalize' ? 'La liquidación queda fija: los movimientos que lleguen después entran en la siguiente semana.'
      : kind === 'payment' ? `${money(amountMinor ?? '0')} · ${reference.trim()} · ${paidOn}${mismatch ? ' · pasará a revisión' : ''}`
      : kind === 'review_open' ? `Motivo: ${reviewReasonLabel(reason)}${note.trim() ? ` · ${note.trim()}` : ''}` : `Resolución: ${note.trim()}`}</p>}
    {phase === 'pending' && <TaskOutcome kind="pending" title="Procesando…"><p>No cierres esta ventana.</p></TaskOutcome>}
    {phase === 'success' && <TaskOutcome kind="success" title="Operación registrada"><p>{outcome}</p></TaskOutcome>}
    {phase === 'rejected' && <TaskOutcome kind="failure" title={refusal.settled ? 'Sin cambios' : 'No se realizó la operación'}><p>{refusal.text}</p></TaskOutcome>}
    {phase === 'uncertain' && <TaskOutcome kind="uncertain" title="Operación pendiente de confirmar"><p>No sabemos si PIKAS registró la operación. Reintenta la misma operación: no se duplicará. No inicies otra.</p></TaskOutcome>}
  </TaskWindow>;
}
