'use client';
import { useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { money } from '../lib/cafeteria/operations';
import { parseCash } from '../lib/pos/contracts';
import { adjustmentReasons, adjustResultSchema } from '../lib/wallet/contracts';

// Positive/additive amounts green, negative/deductive red; signs and labels always shown.
export const signedTone = (minor: string) => BigInt(minor) < 0n ? 'text-red-700' : BigInt(minor) > 0n ? 'text-emerald-700' : '';
export const signed = (minor: string) => `${BigInt(minor) > 0n ? '+' : ''}${money(minor)}`;
type Scope = { kind: 'school'; schoolId: string } | { kind: 'cafeteria'; cafeteriaId: string };
type Pending = Record<string, string>;

// Exceptional balance corrections only: purchases use Reembolso, wrong replenishments use Revertir recarga.
export function WalletAdjustmentDialog({ scope, studentId, studentName, actorId, balanceMinor, onClose, onDone }:
  { scope: Scope; studentId: string; studentName: string; actorId: string; balanceMinor: string; onClose: () => void; onDone: (message: string, balanceAfter: string) => void }) {
  const scopeId = scope.kind === 'school' ? scope.schoolId : scope.cafeteriaId;
  const key = `pikas:wallet-adjustment:${actorId}:${scope.kind}:${scopeId}:${studentId}`;
  const [pending, setPending] = useState<Pending | null>(() => { try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as Pending : null; } catch { return null; } });
  const [step, setStep] = useState<'purpose' | 'purchase' | 'reversal' | 'form'>(pending ? 'form' : 'purpose');
  const [direction, setDirection] = useState<'credit' | 'debit'>(pending?.amount_minor?.startsWith('-') ? 'debit' : 'credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(pending?.reason ?? '');
  const [explanation, setExplanation] = useState(pending?.explanation ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(pending ? 'Hay un ajuste pendiente de confirmar. Reintentar conserva la misma solicitud.' : '');
  const parsedAmount = parseCash(amount);
  const signedAmount = pending?.amount_minor ?? (parsedAmount && BigInt(parsedAmount) > 0n ? (direction === 'debit' ? `-${parsedAmount}` : parsedAmount) : null);
  const after = signedAmount ? (BigInt(balanceMinor) + BigInt(signedAmount)).toString() : null;
  const reasons = adjustmentReasons.filter(([, , d]) => d === 'any' || d === direction);
  const ready = pending !== null || (signedAmount !== null && reason !== '' && explanation.trim().length >= 5);
  const submit = async () => {
    if (busy || !ready || !signedAmount) return;
    const request: Pending = pending ?? { operation: 'adjust', ...(scope.kind === 'school' ? { school_id: scope.schoolId } : { cafeteria_id: scope.cafeteriaId }),
      student_id: studentId, amount_minor: signedAmount, reason, explanation: explanation.trim(), request_key: crypto.randomUUID() };
    try { sessionStorage.setItem(key, JSON.stringify(request)); } catch { setMessage('No se pudo preparar el ajuste. No se envió.'); return; }
    setPending(request); setBusy(true); setMessage('');
    try {
      const response = await sessionFetch(scope.kind === 'school' ? '/api/school/wallet' : '/api/cafeteria/wallet', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.request_key }, body: JSON.stringify(request) });
      let payload: { result?: unknown } = {};
      try { payload = await response.json(); } catch { /* uncertain */ }
      const parsed = adjustResultSchema.safeParse(payload.result);
      if (response.ok && parsed.success && parsed.data.student_id === studentId && parsed.data.amount_minor === request.amount_minor) {
        sessionStorage.removeItem(key);
        onDone(`Ajuste registrado: ${signed(parsed.data.amount_minor)}. Saldo resultante: ${money(parsed.data.balance_after_minor)}.`, parsed.data.balance_after_minor); return;
      }
      if ([400, 401, 403, 422].includes(response.status)) {
        sessionStorage.removeItem(key); setPending(null);
        setMessage('No se registró el ajuste. Revisa los datos, el motivo y tus permisos.'); return;
      }
      setMessage('Resultado pendiente de confirmar. Reintenta el mismo ajuste; no inicies otro.');
    } catch { setMessage('Resultado pendiente de confirmar. Reintenta el mismo ajuste; no inicies otro.'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="adjustment-title" className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
      <h2 id="adjustment-title" className="text-2xl font-black">Corregir saldo</h2>
      <p className="break-words text-sm"><span className="font-semibold">{studentName}</span> · Saldo actual <span className={`font-bold ${BigInt(balanceMinor) < 0n ? 'text-red-700' : ''}`}>{money(balanceMinor)}</span></p>
      {step === 'purpose' && <fieldset className="space-y-2"><legend className="font-bold">¿Qué necesitas corregir?</legend>
        <button type="button" className="btn-secondary w-full justify-start" onClick={() => setStep('purchase')}>Una compra</button>
        <button type="button" className="btn-secondary w-full justify-start" onClick={() => setStep('reversal')}>Una recarga incorrecta</button>
        <button type="button" className="btn w-full justify-start" onClick={() => setStep('form')}>Otra corrección excepcional de saldo</button>
      </fieldset>}
      {step === 'purchase' && <div role="status" className="space-y-2 rounded-xl bg-slate-100 p-3"><p className="font-bold">Usa Reembolso</p><p className="text-sm">Las compras se corrigen con un reembolso desde el POS (pestaña Reembolsos, con el número de recibo). Así el recibo y el dinero quedan enlazados.</p></div>}
      {step === 'reversal' && <div role="status" className="space-y-2 rounded-xl bg-slate-100 p-3"><p className="font-bold">Usa Revertir recarga</p><p className="text-sm">{scope.kind === 'school' ? 'Busca la recarga en el historial del monedero y usa "Revertir recarga".' : 'La administración escolar puede revertir la recarga desde el historial del monedero.'}</p></div>}
      {step === 'form' && <div className="space-y-3">
        <p className="text-sm">Solo para correcciones excepcionales que no son un reembolso ni una reversión de recarga.</p>
        <fieldset className="flex flex-wrap gap-4" disabled={busy || pending !== null}><legend className="mb-1 font-bold">Tipo de ajuste</legend>
          <label className="flex items-center gap-2"><input type="radio" name="direction" checked={direction === 'credit'} onChange={() => { setDirection('credit'); setReason(''); }} /> <span className="font-semibold text-emerald-700">+ Aumentar saldo</span></label>
          <label className="flex items-center gap-2"><input type="radio" name="direction" checked={direction === 'debit'} onChange={() => { setDirection('debit'); setReason(''); }} /> <span className="font-semibold text-red-700">− Disminuir saldo</span></label>
        </fieldset>
        {pending ? <p className="font-bold">Monto: {signed(pending.amount_minor)}</p> : <label className="block font-bold">Monto (RD$)<input className="field mt-1 w-full" aria-label="Monto del ajuste" inputMode="decimal" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} /></label>}
        <label className="block font-bold">Motivo<select className="field mt-1 w-full" aria-label="Motivo del ajuste" value={reason} disabled={busy || pending !== null} onChange={e => setReason(e.target.value)}><option value="">Selecciona un motivo</option>{reasons.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="block font-bold">Explicación (obligatoria)<textarea className="field mt-1 w-full" aria-label="Explicación del ajuste" maxLength={500} value={explanation} disabled={busy || pending !== null} onChange={e => setExplanation(e.target.value)} /></label>
        {signedAmount && after && <dl className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-3 text-sm">
          <dt>Saldo actual</dt><dd className={BigInt(balanceMinor) < 0n ? 'text-red-700' : ''}>{money(balanceMinor)}</dd>
          <dt>Ajuste</dt><dd className={`font-bold ${signedTone(signedAmount)}`}>{signed(signedAmount)}</dd>
          <dt>Saldo resultante</dt><dd className={`font-black ${BigInt(after) < 0n ? 'text-red-700' : ''}`}>{money(after)}</dd>
        </dl>}
        {after && BigInt(after) < 0n && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-950">El saldo quedará negativo ({money(after)}). El estudiante no podrá pagar con PIKAS Cash hasta que nuevas recargas cubran el saldo.</p>}
        <p className="text-sm font-semibold">Esto crea un registro financiero permanente con tu nombre y rol. No se puede editar ni borrar; una corrección posterior requiere otro ajuste.</p>
        <button className={signedAmount?.startsWith('-') ? 'btn-destructive' : 'btn'} disabled={busy || !ready} onClick={() => void submit()}>{busy ? 'Registrando…' : pending ? 'Reintentar mismo ajuste' : signedAmount ? `Registrar ajuste permanente de ${signed(signedAmount)}` : 'Registrar ajuste permanente'}</button>
      </div>}
      <div className="flex flex-wrap gap-3">{step !== 'purpose' && !pending && <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStep('purpose')}>Volver</button>}<button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cerrar</button></div>
      {message && <p role="status">{message}</p>}
    </div>
  </div>;
}
