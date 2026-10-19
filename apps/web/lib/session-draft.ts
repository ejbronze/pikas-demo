'use client';
import { useState } from 'react';

// Browser-session drafts for NON-financial tasks (extracted unchanged from the Wave D.2 product task).
// - The key carries the scope: operator + tenant + task/entity. A null key disables drafts.
// - `base` is the saved version the draft started from; a different base discards the draft.
// - Values are written on every edit, never submitted automatically, and cleared by the caller on
//   successful save or explicit discard. Storage failures only disable the draft.
// Financial tasks must never use this.
export type RestoredDraft<V> = { values: V; note: string; recovered: boolean };

export function useSessionDraft<V extends object>(key: string | null, base: unknown, initial: V, staleNote: string) {
  const [restored] = useState<RestoredDraft<V> | null>(() => {
    if (!key) return null;
    try {
      const raw = sessionStorage.getItem(key); if (!raw) return null;
      const draft = JSON.parse(raw) as { base: unknown; values: V };
      if (JSON.stringify(draft.base ?? null) !== JSON.stringify(base ?? null)) { sessionStorage.removeItem(key); return { values: initial, note: staleNote, recovered: false }; }
      return { values: { ...initial, ...draft.values }, note: 'Recuperamos cambios sin guardar de esta sesión del navegador. Revísalos antes de guardar.', recovered: true };
    } catch { return null; }
  });
  const [values, setValues] = useState<V>(restored?.values ?? initial);
  const set = <K extends keyof V>(field: K, value: V[K]) => setValues(current => {
    const next = { ...current, [field]: value };
    if (key) try { sessionStorage.setItem(key, JSON.stringify({ base: base ?? null, values: next })); } catch { /* drafts are optional */ }
    return next;
  });
  const drop = () => { if (key) try { sessionStorage.removeItem(key); } catch { /* ignore */ } };
  const discard = () => { drop(); setValues(initial); };
  return { values, set, restored, drop, discard };
}

// Entity ids (last key segment) that currently have a draft under `prefix`.
export function listSessionDrafts(prefix: string): string[] {
  try { return Object.keys(sessionStorage).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)); } catch { return []; }
}
