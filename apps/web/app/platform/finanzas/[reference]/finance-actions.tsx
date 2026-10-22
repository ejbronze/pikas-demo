'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionFetch } from '../../../../lib/auth/session-fetch';
import { money } from '../../../../lib/cafeteria/operations';
import { customerLine, decisionResultSchema, financeMessage, reversalReasonLabel, reversalReasons, reversalResultSchema, settledByOthers, type FinanceDetail } from '../../../../lib/platform/finance';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from '../../../../components/task-window';
import { AmountBreakdown } from '../finance-views';

type Kind = 'approve' | 'reject' | 'reverse';
// The exact request (key + body) is kept until PIKAS answers, so a retry can only replay it.
type Pending = { kind: Kind; key: string; body: Record<string, string> };
const journalKey = (actor: string, reference: string) => `pikas:finance:${actor}:${reference}`;
function loadPending(actor: string, reference: string): Pending | null {
  try { const raw = sessionStorage.getItem(journalKey(actor, reference)); if (!raw) return null; const p = JSON.parse(raw) as Pending; return p.body?.reference === reference ? p : null; } catch { return null; }
}

export function FinanceActions({ actor, detail, canVerify, canReverse }: { actor: string; detail: FinanceDetail; canVerify: boolean; canReverse: boolean }) {
  const router = useRouter();
  const [task, setTask] = useState<Kind | null>(null), [message, setMessage] = useState(''), [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => { let alive = true; queueMicrotask(() => { if (alive) setPending(loadPending(actor, detail.reference)); }); return () => { alive = false; }; }, [actor, detail.reference]);
  const done = (text: string) => { setTask(null); setPending(null); setMessage(text); router.refresh(); };
  const verify = detail.status === 'pending' && canVerify && detail.customer_activated, reverse = detail.status === 'posted' && canReverse;
  return <>
    {message && <p role="status" className="card p-4 font-bold">{message}</p>}
    {pending && !task && <section className="card space-y-3 border-amber-300 p-5" aria-label="Operación pendiente"><p className="font-bold">Hay una operación sin confirmar para esta solicitud.</p>
      <p className="text-sm">Reintenta la misma operación: PIKAS no la duplicará.</p><button type="button" className="btn" onClick={() => setTask(pending.kind)}>Revisar operación pendiente</button></section>}
    {verify && !pending && <section className="card space-y-3 p-5" aria-label="Decisión"><h2 className="text-lg font-bold">Decisión</h2>
      <p className="text-sm">Verifica solo si confirmaste el depósito en el banco. Al verificar, {detail.student} recibe {money(detail.net_minor)} en PIKAS Cash.</p>
      <div className="flex flex-col gap-2 sm:flex-row"><button type="button" className="btn" onClick={() => { setMessage(''); setTask('approve'); }}>Verificar transferencia</button>
        <button type="button" className="btn-secondary" onClick={() => { setMessage(''); setTask('reject'); }}>Rechazar</button></div></section>}
    {detail.status === 'pending' && !canVerify && <p className="card p-4 text-sm">Tu acceso permite consultar. Verificar o rechazar requiere el permiso de verificación financiera.</p>}
    {detail.status === 'posted' && detail.wallet && (canReverse || canVerify) && <section className="card space-y-3 p-5" aria-label="PIKAS Cash del estudiante"><h2 className="text-lg font-bold">PIKAS Cash del estudiante</h2>
      <dl className="tabular-nums"><div className="flex justify-between gap-4 py-1"><dt className="text-slate-600">Saldo actual</dt><dd className="font-bold">{money(detail.wallet.balance_minor)}</dd></div>
        <div className="flex justify-between gap-4 py-1"><dt className="text-slate-600">Crédito de esta recarga</dt><dd>{money(detail.net_minor)}</dd></div></dl>
      {!detail.wallet.covers_net && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Parte del crédito ya se utilizó. Una reversión automática probablemente no será posible.</p>}
      {detail.wallet.status === 'frozen' && <p className="text-sm">PIKAS Cash está congelado.</p>}
      {reverse && !pending && <button type="button" className="btn-destructive w-full sm:w-auto" onClick={() => { setMessage(''); setTask('reverse'); }}>Revertir transferencia</button>}</section>}
    {(detail.status === 'rejected' || detail.status === 'reversed') && <p className="card p-4 text-sm">Sin acciones pendientes. El registro original se conserva.</p>}
    {task && <FinanceTask kind={task} detail={detail} actor={actor} recovered={pending?.kind === task ? pending : null} onClose={() => { setTask(null); setPending(loadPending(actor, detail.reference)); }} onDone={done} />}
  </>;
}

type Phase = 'details' | 'confirm' | 'pending' | 'success' | 'rejected' | 'uncertain';
function FinanceTask({ kind, detail, actor, recovered, onClose, onDone }: {
  kind: Kind; detail: FinanceDetail; actor: string; recovered: Pending | null; onClose: () => void; onDone: (message: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>(recovered ? 'uncertain' : kind === 'approve' ? 'confirm' : 'details');
  const [reason, setReason] = useState(''), [note, setNote] = useState(''), [problem, setProblem] = useState(''), [refusal, setRefusal] = useState({ text: '', settled: false });
  const inFlight = useRef(false);
  const title = { approve: 'Verificar transferencia', reject: 'Rechazar transferencia', reverse: 'Revertir transferencia' }[kind];
  const review = () => {
    if (kind === 'reject' && reason.trim().length < 3) { setProblem('Escribe el motivo del rechazo (al menos 3 caracteres).'); return; }
    if (kind === 'reverse' && !reason) { setProblem('Selecciona el motivo de la reversión.'); return; }
    if (kind === 'reverse' && reason === 'other' && note.trim().length < 3) { setProblem('Explica el motivo (al menos 3 caracteres).'); return; }
    setProblem(''); setPhase('confirm');
  };
  const commit = async () => {
    if (inFlight.current) return;
    const outgoing: Pending = recovered ?? { kind, key: crypto.randomUUID(), body: kind === 'reverse' ? { reference: detail.reference, reason, note: note.trim() }
      : kind === 'reject' ? { reference: detail.reference, decision: 'reject', reason: reason.trim() } : { reference: detail.reference, decision: 'approve' } };
    try { sessionStorage.setItem(journalKey(actor, detail.reference), JSON.stringify(outgoing)); } catch { setProblem('No se pudo preparar la operación. No se envió.'); return; }
    inFlight.current = true; setPhase('pending');
    try {
      const response = await sessionFetch(kind === 'reverse' ? '/api/platform/finance/reversal' : '/api/platform/finance/decision',
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': outgoing.key }, body: JSON.stringify(outgoing.body) });
      let payload: { result?: unknown; error?: string } = {};
      try { payload = await response.json(); } catch { /* uncertain */ }
      const parsed = (kind === 'reverse' ? reversalResultSchema : decisionResultSchema).safeParse(payload.result);
      if (response.ok && parsed.success && parsed.data.reference === detail.reference) { sessionStorage.removeItem(journalKey(actor, detail.reference)); setPhase('success'); return; }
      if ([400, 401, 403, 409, 422].includes(response.status)) {
        sessionStorage.removeItem(journalKey(actor, detail.reference));
        setRefusal({ text: financeMessage(payload.error), settled: settledByOthers.has(payload.error ?? '') }); setPhase('rejected'); return;
      }
      setPhase('uncertain');
    } catch { setPhase('uncertain'); }
    finally { inFlight.current = false; }
  };
  const successText = { approve: `Transferencia verificada. ${detail.student} recibió ${money(detail.net_minor)} en PIKAS Cash.`, reject: 'Transferencia rechazada. No se acreditó dinero.',
    reverse: `Transferencia revertida. Se retiraron ${money(detail.net_minor)} de PIKAS Cash y se revirtió el cargo de ${money(detail.fee_minor)}.` }[kind];
  const finalLabel = { approve: `Verificar y acreditar ${money(detail.net_minor)}`, reject: 'Rechazar transferencia', reverse: `Revertir ${money(detail.net_minor)}` }[kind];
  const footer = {
    details: <><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" onClick={review}>Continuar</button></>,
    confirm: <>{kind === 'approve' ? <TaskCancelButton>Cancelar</TaskCancelButton> : <button type="button" className="btn-secondary" onClick={() => setPhase('details')}>Atrás</button>}
      <button type="button" className={kind === 'approve' ? 'btn' : 'btn-destructive'} onClick={() => void commit()}>{finalLabel}</button></>,
    pending: <button type="button" className="btn" disabled>Procesando…</button>,
    success: <button type="button" className="btn" data-autofocus onClick={() => onDone(successText)}>Cerrar</button>,
    rejected: <button type="button" className="btn" data-autofocus onClick={() => refusal.settled ? onDone(refusal.text) : onClose()}>{refusal.settled ? 'Ver estado actual' : 'Cerrar'}</button>,
    uncertain: <><button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button><button type="button" className="btn" onClick={() => void commit()}>Reintentar la misma operación</button></>,
  }[phase];
  const who: [string, React.ReactNode][] = [['Referencia', detail.reference], ['Estudiante', `${detail.student}${detail.student_code ? ` · ${detail.student_code}` : ''}`], ['Colegio', customerLine(detail.customer, detail.school)]];
  return <TaskWindow title={phase === 'success' ? { approve: 'Transferencia verificada', reject: 'Transferencia rechazada', reverse: 'Transferencia revertida' }[kind] : title}
    context={detail.reference} steps={kind !== 'approve' && (phase === 'details' || phase === 'confirm') ? ['Detalles', 'Confirmar'] : undefined} step={phase === 'confirm' ? 1 : 0}
    busy={phase === 'pending'} dirty={(phase === 'details' && !!(reason || note)) || (phase === 'confirm' && kind !== 'approve')} onClose={onClose} footer={<TaskActions>{footer}</TaskActions>}>
    {(phase === 'details' || phase === 'confirm') && <TaskSummary rows={who} />}
    {(phase === 'details' || phase === 'confirm') && <div className="rounded-xl border px-4 py-2"><AmountBreakdown gross={detail.gross_minor} fee={detail.fee_minor} net={detail.net_minor} feeBps={detail.fee_bps} compact credited={kind === 'reverse'} /></div>}
    {phase === 'details' && kind === 'reject' && <>
      <p className="text-sm">El rechazo es definitivo: la solicitud no podrá verificarse después. No se acredita dinero ni se cobra cargo.</p>
      <label className="block font-bold">Motivo del rechazo<textarea className={`field mt-1 ${problem ? 'border-red-700' : ''}`} data-autofocus aria-label="Motivo del rechazo" aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'finance-reject-problem' : undefined} maxLength={500} value={reason}
        onChange={e => { setReason(e.target.value); if (e.target.value.trim().length >= 3) setProblem(''); }} /></label>
      {problem && <p id="finance-reject-problem" role="alert" className="font-bold text-red-800">{problem}</p>}</>}
    {phase === 'details' && kind === 'reverse' && <>
      <p className="text-sm">Se retira el crédito de {money(detail.net_minor)} de PIKAS Cash y se revierte el cargo PIKAS. La recarga original se conserva. Solo puede revertirse una vez, y solo si el crédito sigue disponible.</p>
      <label className="block font-bold">Motivo<select className="field mt-1" data-autofocus aria-label="Motivo de la reversión" value={reason} onChange={e => setReason(e.target.value)}><option value="">Selecciona un motivo</option>{reversalReasons.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="block font-bold">{reason === 'other' ? 'Explica el motivo' : 'Nota (opcional)'}<textarea className="field mt-1" aria-label={reason === 'other' ? 'Explica el motivo' : 'Nota'} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
      {problem && <p role="alert" className="font-bold text-red-800">{problem}</p>}</>}
    {phase === 'confirm' && <p className="font-bold">{kind === 'approve' ? 'Confirma que verificaste el depósito en el banco. Esta acción acredita PIKAS Cash de inmediato.'
      : kind === 'reject' ? `Motivo: ${reason.trim()}` : `Motivo: ${reversalReasonLabel(reason)}${note.trim() ? ` · ${note.trim()}` : ''}`}</p>}
    {problem && phase === 'confirm' && <p role="alert" className="font-bold text-red-800">{problem}</p>}
    {phase === 'pending' && <TaskOutcome kind="pending" title="Procesando…"><p>No cierres esta ventana.</p></TaskOutcome>}
    {phase === 'success' && <TaskOutcome kind="success" title="Operación registrada"><p>{successText}</p></TaskOutcome>}
    {phase === 'rejected' && <TaskOutcome kind="failure" title={refusal.settled ? 'Sin cambios' : 'No se realizó la operación'}><p>{refusal.text}</p></TaskOutcome>}
    {phase === 'uncertain' && <TaskOutcome kind="uncertain" title="Operación pendiente de confirmar"><p>No sabemos si PIKAS registró la operación. Reintenta la misma operación: no se duplicará. No inicies otra.</p></TaskOutcome>}
  </TaskWindow>;
}
