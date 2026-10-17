'use client';
import { useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { money } from '../lib/cafeteria/operations';
import { reversalReasons, reversalResultSchema, reversalSchema, type Reversal } from '../lib/wallet/contracts';

export const reversalJournalKey = (actorId: string, schoolId: string, studentId: string) => `pikas:wallet-reversal:${actorId}:${schoolId}:${studentId}`;
export function loadPendingReversal(key: string): Reversal | null {
  const raw = sessionStorage.getItem(key);
  return raw === null ? null : reversalSchema.parse(JSON.parse(raw));
}
type Target = { replenishmentId: string; amountMinor: string; reference: string | null; note: string | null };

// Reverses the exact original replenishment once; a negative resulting balance warns but never blocks.
export function WalletReversalDialog({ schoolId, studentId, studentName, actorId, balanceMinor, target, onClose, onDone }:
  { schoolId: string; studentId: string; studentName: string; actorId: string; balanceMinor: string; target: Target; onClose: () => void; onDone: (message: string) => void }) {
  const key = reversalJournalKey(actorId, schoolId, studentId);
  const [pending, setPending] = useState<Reversal | null>(() => { try { const p = loadPendingReversal(key); return p && p.replenishment_id === target.replenishmentId ? p : null; } catch { return null; } });
  const [reason, setReason] = useState<string>(pending?.reason ?? '');
  const [note, setNote] = useState(pending?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(pending ? 'Hay una reversión pendiente de confirmar. Reintentar conserva la misma solicitud.' : '');
  const after = BigInt(balanceMinor) - BigInt(target.amountMinor);
  const ready = pending !== null || (reason !== '' && (reason !== 'other' || note.trim().length >= 3));
  const submit = async () => {
    if (busy || !ready) return;
    let request: Reversal;
    try {
      request = pending ?? reversalSchema.parse({ operation: 'reverse', school_id: schoolId, student_id: studentId, replenishment_id: target.replenishmentId,
        reason, note: note.trim(), request_key: crypto.randomUUID() });
      sessionStorage.setItem(key, JSON.stringify(request));
    } catch { setMessage('No se pudo preparar la reversión. No se envió.'); return; }
    setPending(request); setBusy(true); setMessage('');
    try {
      const response = await sessionFetch('/api/school/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.request_key }, body: JSON.stringify(request) });
      let payload: { result?: unknown; error?: string } = {};
      try { payload = await response.json(); } catch { /* uncertain */ }
      const parsed = reversalResultSchema.safeParse(payload.result);
      if (response.ok && parsed.success && parsed.data.replenishment_id === request.replenishment_id) {
        sessionStorage.removeItem(key);
        onDone(`Recarga revertida. Saldo resultante: ${money(parsed.data.balance_after_minor)}.`); return;
      }
      if (response.status === 409 || [400, 401, 403, 422].includes(response.status)) {
        sessionStorage.removeItem(key); setPending(null);
        setMessage(response.status === 409 ? 'Esta recarga ya fue revertida.' : 'No se realizó la reversión. Revisa el motivo y tus permisos.'); return;
      }
      setMessage('Resultado pendiente de confirmar. Reintenta la misma reversión; no inicies otra.');
    } catch { setMessage('Resultado pendiente de confirmar. Reintenta la misma reversión; no inicies otra.'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="reversal-title" className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
      <h2 id="reversal-title" className="text-2xl font-black">Revertir recarga</h2>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-slate-600">Estudiante</dt><dd className="break-words font-semibold">{studentName}</dd>
        <dt className="text-slate-600">Recarga original</dt><dd className="font-semibold">{money(target.amountMinor)}</dd>
        {target.reference && <><dt className="text-slate-600">Referencia</dt><dd className="break-words">{target.reference}</dd></>}
        {target.note && <><dt className="text-slate-600">Nota</dt><dd className="break-words">{target.note}</dd></>}
        <dt className="text-slate-600">Saldo actual</dt><dd>{money(balanceMinor)}</dd>
        <dt className="text-slate-600">Saldo resultante</dt><dd className="font-black">{money(after.toString())}</dd>
      </dl>
      {after < 0n && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-950">El saldo quedará negativo ({money(after.toString())}). El estudiante no podrá pagar con PIKAS Cash hasta que nuevas recargas cubran el saldo.</p>}
      <p className="text-sm">Se registra un movimiento negativo enlazado; la recarga original no se modifica. Solo puede revertirse una vez.</p>
      <label className="block font-bold">Motivo<select className="field mt-1 w-full" aria-label="Motivo de la reversión" value={reason} disabled={busy || pending !== null} onChange={e => setReason(e.target.value)}><option value="">Selecciona un motivo</option>{reversalReasons.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="block font-bold">{reason === 'other' ? 'Explica el motivo' : 'Nota administrativa (opcional)'}<textarea className="field mt-1 w-full" aria-label={reason === 'other' ? 'Explica el motivo' : 'Nota administrativa'} maxLength={500} value={note} disabled={busy || pending !== null} onChange={e => setNote(e.target.value)} /></label>
      <div className="flex flex-wrap gap-3"><button className="btn-destructive" disabled={busy || !ready} onClick={() => void submit()}>{busy ? 'Revirtiendo…' : pending ? 'Reintentar misma reversión' : `Confirmar reversión de ${money(target.amountMinor)}`}</button><button className="btn-secondary" disabled={busy} onClick={onClose}>Cancelar</button></div>
      {message && <p role="status">{message}</p>}
    </div>
  </div>;
}
