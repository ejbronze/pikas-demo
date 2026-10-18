'use client';
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const RequestClose = createContext<() => void>(() => {});

// Wave D.1 focused task surface. A native modal <dialog> (top layer: the shell, its mobile
// navigation and the page behind are inert). Closing goes through one gate:
// - busy (a mutation is unresolved): close, Escape and backdrop are ignored;
// - dirty (typed input not yet committed): an in-app discard prompt, never window.confirm;
// - otherwise it closes, and focus returns to the control that opened it.
// It holds no data: tasks keep typed values in component memory only.
export function TaskWindow({ title, context, steps, step, busy = false, dirty = false, onClose, children, footer }: {
  title: string; context?: React.ReactNode; steps?: string[]; step?: number;
  busy?: boolean; dirty?: boolean; onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [discarding, setDiscarding] = useState(false);
  const [busyHint, setBusyHint] = useState(false);
  const state = useRef({ busy, dirty, onClose });
  useEffect(() => { state.current = { busy, dirty, onClose }; if (!busy) setBusyHint(false); }, [busy, dirty, onClose]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    (element?.querySelector<HTMLElement>('[data-autofocus]') ?? element?.querySelector<HTMLElement>('h2'))?.focus();
    return () => { element?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  const requestClose = () => {
    if (state.current.busy) { setBusyHint(true); return; }
    if (state.current.dirty) { setDiscarding(true); return; }
    state.current.onClose();
  };
  useEffect(() => { if (discarding) dialog.current?.querySelector<HTMLElement>('[data-keep-editing]')?.focus(); }, [discarding]);
  // Portalled to <body> so no parent layout (spacing, overflow, stacking) can shift the task surface.
  const surface = <dialog ref={dialog} aria-labelledby={titleId} aria-busy={busy || undefined}
    onCancel={event => { event.preventDefault(); requestClose(); }}
    onKeyDown={event => {
      // Keep Tab inside the task (a modal dialog alone lets focus leave to the browser chrome).
      if (event.key !== 'Tab') return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(e => e.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (event.shiftKey && (active === first || !items.includes(active as HTMLElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !items.includes(active as HTMLElement))) { event.preventDefault(); first.focus(); }
    }}
    onClick={event => { if (event.target === dialog.current) requestClose(); }}
    className="task-window m-0 h-[100dvh] max-h-none w-full max-w-none overflow-hidden bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 sm:m-auto sm:h-fit sm:max-h-[90dvh] sm:max-w-lg sm:rounded-2xl sm:border">
    <div className="flex h-full max-h-[inherit] flex-col sm:max-h-[90dvh]">
      <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} tabIndex={-1} className="break-words text-xl font-black outline-none">{title}</h2>
          {context && <div className="mt-0.5 break-words text-sm text-slate-600">{context}</div>}
          {steps && step !== undefined && <ol className="mt-2 flex flex-wrap gap-x-2 text-xs font-bold uppercase tracking-wide text-slate-400" aria-label="Pasos">
            {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} className={index === step ? 'text-slate-900' : ''}>{index > 0 && <span aria-hidden className="mr-2">›</span>}{label}</li>)}
          </ol>}
        </div>
        <button type="button" aria-label="Cerrar tarea" className="grid size-11 shrink-0 place-items-center rounded-xl text-2xl leading-none text-slate-600 hover:bg-slate-100 disabled:opacity-40" disabled={busy} onClick={requestClose}><span aria-hidden>×</span></button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">{children}</div>
      <footer className="shrink-0 border-t bg-white px-4 py-3 sm:px-6" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}><RequestClose.Provider value={requestClose}>
        {busyHint && <p role="status" className="mb-2 text-sm font-semibold">La operación está en curso. Espera la confirmación antes de cerrar.</p>}
        {discarding
          ? <div role="alertdialog" aria-label="Descartar datos" className="space-y-2"><p className="font-bold">¿Descartar los datos ingresados?</p><p className="text-sm text-slate-600">No se ha registrado ninguna operación. Lo que escribiste se perderá.</p>
            <TaskActions><button type="button" className="btn-secondary" data-keep-editing onClick={() => setDiscarding(false)}>Seguir editando</button><button type="button" className="btn" onClick={() => state.current.onClose()}>Descartar</button></TaskActions></div>
          : footer}
      </RequestClose.Provider></footer>
    </div>
  </dialog>;
  return typeof document === 'undefined' ? surface : createPortal(surface, document.body);
}

// Cancel/close inside a task goes through the same gate as ×, Escape and the backdrop.
export function TaskCancelButton({ children }: { children: React.ReactNode }) {
  const requestClose = useContext(RequestClose);
  return <button type="button" className="btn-secondary" onClick={requestClose}>{children}</button>;
}

// Secondary actions first in reading order; on mobile the primary (last) action sits at the bottom.
export function TaskActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">{children}</div>;
}

// Label/value review rows for the confirmation step.
export function TaskSummary({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="divide-y rounded-xl border">{rows.map(([label, value]) => <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"><dt className="text-sm text-slate-600">{label}</dt><dd className="break-words text-right font-bold">{value}</dd></div>)}</dl>;
}

// Unmistakable outcome block. "uncertain" never claims success or failure.
export function TaskOutcome({ kind, title, children }: { kind: 'pending' | 'success' | 'failure' | 'uncertain'; title: string; children?: React.ReactNode }) {
  const tone = { pending: 'border-slate-200 bg-slate-50', success: 'border-emerald-200 bg-emerald-50', failure: 'border-red-200 bg-red-50', uncertain: 'border-amber-300 bg-amber-50' }[kind];
  const mark = { pending: '…', success: '✓', failure: '✕', uncertain: '!' }[kind];
  return <div role={kind === 'failure' || kind === 'uncertain' ? 'alert' : 'status'} className={`space-y-2 rounded-xl border p-4 ${tone}`}>
    <p className="flex items-center gap-2 text-lg font-black"><span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-base">{mark}</span>{title}</p>
    {children}
  </div>;
}
