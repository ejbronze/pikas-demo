"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function AdminStatus({ label }: { label: string }) {
  return <span className="chip inline-flex">{label}</span>;
}

export function AdminDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close.current(); }} className="admin-dialog w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border bg-white p-0 text-slate-900 backdrop:bg-slate-950/50">
    <div className="flex max-h-[90dvh] flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 sm:px-6"><h2 id={titleId} className="min-w-0 break-words text-xl font-bold">{title}</h2><button type="button" className="btn-secondary shrink-0" onClick={onClose} autoFocus>Cerrar</button></header>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
    </div>
  </dialog>;
}
