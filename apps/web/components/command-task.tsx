'use client';
import { useRef, useState } from 'react';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskWindow } from './task-window';

// Wave D.3 non-financial administrative task on the D.1 TaskWindow: detail page(s) → Revisar →
// explicit final action → authoritative outcome. It owns no request identity: `submit` delegates to
// the existing exact-request journal (school command, cafeteria command), which keeps an
// unconfirmed request and resends exactly it on an explicit retry. Nothing is sent automatically.
export type CommandResult = { kind: 'success' } | { kind: 'rejected'; message: string } | { kind: 'uncertain'; message: string };
type Phase = number | 'review' | 'sending' | 'success' | 'rejected' | 'uncertain' | 'recover';

export function CommandTask({ title, context, pages, validate, review, finalLabel, sendingLabel = 'Guardando…', destructive = false, submit, recovery, blocked, dirty = false, onKeepDraft, onDiscard, onSucceeded, success, onClose }: {
  title: string; context?: React.ReactNode;
  pages: { label: string; content: React.ReactNode }[];
  // Called on Continuar from page `index`; returns a readable problem or null.
  validate?: (index: number) => string | null;
  review: React.ReactNode; finalLabel: string; sendingLabel?: string; destructive?: boolean;
  submit: () => Promise<CommandResult>;
  // An existing unconfirmed request for this task: shown first, retried only on explicit action.
  recovery?: React.ReactNode | null;
  blocked?: string;
  dirty?: boolean; onKeepDraft?: () => void; onDiscard?: () => void; onSucceeded?: () => void;
  success: { title: string; body?: React.ReactNode; actions?: React.ReactNode; closeMessage?: string };
  onClose: (message?: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>(recovery ? 'recover' : 0);
  const [problem, setProblem] = useState(''), [message, setMessage] = useState('');
  const sending = useRef(false), body = useRef<HTMLDivElement>(null);
  const last = pages.length - 1;
  const next = (index: number) => {
    const fields = [...(body.current?.children[index]?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea') ?? [])];
    if (!fields.every(field => field.reportValidity())) return;
    const issue = validate?.(index) ?? null;
    if (issue) { setProblem(issue); return; }
    setProblem(''); setPhase(index === last ? 'review' : index + 1);
  };
  const send = async () => {
    if (sending.current || blocked) return;
    sending.current = true; setPhase('sending');
    try {
      const result = await submit();
      if (result.kind === 'success') { onSucceeded?.(); setPhase('success'); }
      else { setMessage(result.message); setPhase(result.kind); }
    } catch { setMessage('No pudimos confirmar el resultado. Reintenta la misma solicitud; no crees otra.'); setPhase('uncertain'); }
    finally { sending.current = false; }
  };
  const editing = typeof phase === 'number' || phase === 'review';
  const step = typeof phase === 'number' ? phase : pages.length;
  const footer = typeof phase === 'number'
    ? <>{phase > 0 ? <button type="button" className="btn-secondary" onClick={() => setPhase(phase - 1)}>Atrás</button> : <TaskCancelButton>Cancelar</TaskCancelButton>}<button type="button" className="btn" onClick={() => next(phase)}>Continuar</button></>
    : {
      review: <><button type="button" className="btn-secondary" onClick={() => setPhase(last)}>Atrás</button><button type="button" className={destructive ? 'btn-destructive' : 'btn'} disabled={!!blocked} onClick={() => void send()}>{finalLabel}</button></>,
      sending: <button type="button" className="btn" disabled>{sendingLabel}</button>,
      success: <>{success.actions}<button type="button" className="btn" data-autofocus onClick={() => onClose(success.closeMessage)}>Cerrar</button></>,
      rejected: <><button type="button" className="btn-secondary" onClick={() => onClose()}>Cerrar</button><button type="button" className="btn" onClick={() => setPhase(0)}>Revisar datos</button></>,
      uncertain: <><button type="button" className="btn-secondary" onClick={() => onClose()}>Cerrar</button><button type="button" className="btn" disabled={!!blocked} onClick={() => void send()}>Reintentar la misma solicitud</button></>,
      recover: <><button type="button" className="btn-secondary" onClick={() => onClose()}>Cerrar</button><button type="button" className="btn" disabled={!!blocked} onClick={() => void send()}>Confirmar solicitud pendiente</button></>,
    }[phase];
  return <TaskWindow title={title} context={context} steps={editing ? [...pages.map(p => p.label), 'Revisar'] : undefined} step={step}
    busy={phase === 'sending'} dirty={editing && dirty} onClose={() => { onDiscard?.(); onClose(); }} onKeepDraft={onKeepDraft} footer={<TaskActions>{footer}</TaskActions>}>
    <div ref={body} className="space-y-4">
      {pages.map((page, index) => <section key={page.label} hidden={phase !== index} className="space-y-4">{page.content}</section>)}
    </div>
    {problem && typeof phase === 'number' && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-800">{problem}</p>}
    {phase === 'review' && review}
    {blocked && (phase === 'review' || phase === 'uncertain' || phase === 'recover') && <p role="alert" className="text-sm font-bold text-red-800">{blocked}</p>}
    {phase === 'sending' && <TaskOutcome kind="pending" title={sendingLabel}><p>No cierres esta ventana.</p></TaskOutcome>}
    {phase === 'success' && <TaskOutcome kind="success" title={success.title}>{success.body}</TaskOutcome>}
    {phase === 'rejected' && <TaskOutcome kind="failure" title="No se realizó el cambio">{message && <p>{message}</p>}</TaskOutcome>}
    {phase === 'uncertain' && <TaskOutcome kind="uncertain" title="Pendiente de confirmar"><p>{message}</p></TaskOutcome>}
    {phase === 'recover' && <><TaskOutcome kind="uncertain" title="Hay una solicitud pendiente de confirmar"><p>Una solicitud anterior no se confirmó. Reintenta exactamente la misma solicitud antes de hacer otro cambio.</p></TaskOutcome>{recovery}</>}
  </TaskWindow>;
}
