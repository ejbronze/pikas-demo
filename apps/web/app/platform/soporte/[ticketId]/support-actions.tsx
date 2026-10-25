'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionFetch } from '../../../../lib/auth/session-fetch';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskWindow } from '../../../../components/task-window';
import { actionLabel, bodyRequired, looksLikeSecret, platformResultSchema, statusLabel, supportMessage, type PlatformAction } from '../../../../lib/support/contracts';

// The exact request (key + body) is kept until PIKAS answers, so a retry can only replay it.
type Pending = { key: string; body: { ticket_id: string; action: PlatformAction; body: string | null } };
const journalKey = (actor: string, ticket: string) => `pikas:support-platform:${actor}:${ticket}`;
const loadPending = (actor: string, ticket: string): Pending | null => { try { const raw = sessionStorage.getItem(journalKey(actor, ticket)); return raw ? JSON.parse(raw) as Pending : null; } catch { return null; } };
const help: Record<PlatformAction, string> = {
  reply: 'El cliente verá tu respuesta en «Mis reportes».', note: 'Solo PIKAS la ve. No cambia el estado.',
  request_info: 'El ticket pasa a «Necesitamos información» y el cliente verá tu pregunta.', review: 'El ticket pasa a «En revisión».',
  resolve: 'El cliente verá la resolución. El ticket pasa a «Resuelto»; si el cliente responde, vuelve a revisión.',
  close: 'El ticket pasa a «Cerrado» y no admite más respuestas del cliente. El mensaje es opcional y visible para el cliente.',
  reopen: 'El ticket vuelve a «En revisión». El motivo queda como nota interna.',
};

export function SupportActions({ actor, ticketId, reference, actions }: { actor: string; ticketId: string; reference: string; actions: PlatformAction[] }) {
  const router = useRouter();
  const [task, setTask] = useState<PlatformAction | null>(null), [message, setMessage] = useState(''), [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => { let alive = true; queueMicrotask(() => { if (alive) setPending(loadPending(actor, ticketId)); }); return () => { alive = false; }; }, [actor, ticketId]);
  return <div className="space-y-3">
    {message && <p role="status" className="card p-4 font-bold">{message}</p>}
    {pending && !task ? <section className="card space-y-3 border-amber-300 p-5" aria-label="Operación pendiente"><p className="font-bold">Hay una operación sin confirmar.</p>
      <p className="text-sm">Reintenta la misma operación: PIKAS no la duplicará.</p><button type="button" className="btn" onClick={() => setTask(pending.body.action)}>Revisar operación pendiente</button></section>
      : <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{actions.map((a, i) => <button key={a} type="button" className={i === 0 ? 'btn' : 'btn-secondary'} onClick={() => { setMessage(''); setTask(a); }}>{actionLabel[a]}</button>)}</div>}
    {task && <SupportTask action={task} actor={actor} ticketId={ticketId} reference={reference} recovered={pending?.body.action === task ? pending : null}
      onClose={() => { setTask(null); setPending(loadPending(actor, ticketId)); }} onDone={text => { setTask(null); setPending(null); setMessage(text); router.refresh(); }} />}
  </div>;
}

type Phase = 'details' | 'pending' | 'success' | 'rejected' | 'uncertain';
function SupportTask({ action, actor, ticketId, reference, recovered, onClose, onDone }: {
  action: PlatformAction; actor: string; ticketId: string; reference: string; recovered: Pending | null; onClose: () => void; onDone: (message: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>(recovered ? 'uncertain' : 'details');
  const [body, setBody] = useState(''), [problem, setProblem] = useState(''), [outcome, setOutcome] = useState(''), [refusal, setRefusal] = useState('');
  const inFlight = useRef(false), sent = useRef<Pending | null>(recovered);
  const commit = async () => {
    if (inFlight.current) return;
    if (!sent.current) {
      if (bodyRequired(action) && !body.trim()) { setProblem('Escribe un mensaje.'); return; }
      if (looksLikeSecret(body)) { setProblem(supportMessage('support_secret_detected')); return; }
    }
    const outgoing: Pending = sent.current ?? { key: crypto.randomUUID(), body: { ticket_id: ticketId, action, body: body.trim() || null } };
    sent.current = outgoing;
    try { sessionStorage.setItem(journalKey(actor, ticketId), JSON.stringify(outgoing)); } catch { setProblem('No se pudo preparar la operación. No se envió.'); return; }
    inFlight.current = true; setProblem(''); setPhase('pending');
    try {
      const response = await sessionFetch('/api/platform/support', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': outgoing.key }, body: JSON.stringify(outgoing.body) });
      let payload: { result?: unknown; error?: string } = {};
      try { payload = await response.json(); } catch { /* uncertain */ }
      const parsed = platformResultSchema.safeParse(payload.result);
      if (response.ok && parsed.success && parsed.data.id === ticketId) {
        sessionStorage.removeItem(journalKey(actor, ticketId));
        setOutcome(`${reference}: ${actionLabel[outgoing.body.action].toLowerCase()} registrado. Estado: ${statusLabel[parsed.data.status]}.`); setPhase('success'); return;
      }
      if ([400, 401, 403, 409, 422].includes(response.status)) { sessionStorage.removeItem(journalKey(actor, ticketId)); setRefusal(supportMessage(payload.error)); setPhase('rejected'); return; }
      setPhase('uncertain');
    } catch { setPhase('uncertain'); }
    finally { inFlight.current = false; }
  };
  const footer = {
    details: <><TaskCancelButton>Cancelar</TaskCancelButton><button type="button" className="btn" onClick={() => void commit()}>{actionLabel[action]}</button></>,
    pending: <button type="button" className="btn" disabled>Procesando…</button>,
    success: <button type="button" className="btn" data-autofocus onClick={() => onDone(outcome)}>Cerrar</button>,
    rejected: <button type="button" className="btn" data-autofocus onClick={onClose}>Cerrar</button>,
    uncertain: <><button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button><button type="button" className="btn" onClick={() => void commit()}>Reintentar la misma operación</button></>,
  }[phase];
  return <TaskWindow title={actionLabel[action]} context={reference} busy={phase === 'pending'} dirty={phase === 'details' && !!body} onClose={onClose} footer={<TaskActions>{footer}</TaskActions>}>
    {phase === 'details' && <>
      <p className="text-sm">{help[action]}</p>
      {action !== 'review' && <label className="block font-bold">{action === 'note' || action === 'reopen' ? 'Nota interna' : bodyRequired(action) ? 'Mensaje para el cliente' : 'Mensaje para el cliente (opcional)'}
        <textarea className="field mt-1 min-h-28 w-full" data-autofocus maxLength={4000} autoComplete="off" value={body} onChange={e => setBody(e.target.value)} /></label>}
      <p className="text-xs text-slate-500">Nunca pidas ni escribas contraseñas o tokens.</p>
      {problem && <p role="alert" className="text-sm font-bold text-red-800">{problem}</p>}
    </>}
    {phase === 'pending' && <TaskOutcome kind="pending" title="Registrando…" />}
    {phase === 'success' && <TaskOutcome kind="success" title="Listo">{outcome}</TaskOutcome>}
    {phase === 'rejected' && <TaskOutcome kind="failure" title="No se registró">{refusal}</TaskOutcome>}
    {phase === 'uncertain' && <TaskOutcome kind="uncertain" title="No sabemos si se registró">Reintenta la misma operación: PIKAS no la duplicará.</TaskOutcome>}
  </TaskWindow>;
}
