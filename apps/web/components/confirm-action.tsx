'use client';
import { useState } from 'react';

// Wave D.3 in-app confirmation for a single administrative action (replaces window.confirm). The
// first press only asks; the action runs on the explicit second press. Not a modal and not used for
// financial tasks (those confirm inside their TaskWindow).
export function ConfirmAction({ label, question, onConfirm, className = 'btn', disabled = false, ask = true, before }: {
  label: string; question: string; onConfirm: () => void; className?: string; disabled?: boolean; ask?: boolean;
  // Optional gate before asking (for example native field validation); false keeps it closed.
  before?: () => boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (asking) return <div role="alertdialog" aria-label={label} className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
    <p className="font-bold">{question}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={() => setAsking(false)}>Cancelar</button><button type="button" className={className} disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>{label}</button></div>
  </div>;
  // No type attribute: callers may sit inside a form; the click never submits it.
  return <button className={className} disabled={disabled} onClick={event => { event.preventDefault(); if (before && !before()) return; if (ask) setAsking(true); else onConfirm(); }}>{label}</button>;
}
