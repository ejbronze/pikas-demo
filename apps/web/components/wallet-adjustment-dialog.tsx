'use client';
import { useRef, useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { money } from '../lib/cafeteria/operations';
import { parseCash } from '../lib/pos/contracts';
import { adjustmentReasons, adjustResultSchema } from '../lib/wallet/contracts';
import { moneyText, moneyTone, moneyToneClass } from '../lib/money-semantics';
import { MoneyValue } from './money-value';
import { TaskActions, TaskCancelButton, TaskOutcome, TaskSummary, TaskWindow } from './task-window';

// Movement semantics from the shared money convention: additive "+" green, deductive "−" red.
export const signedTone = (minor: string) => moneyToneClass[moneyTone(minor, 'movement')];
export const signed = (minor: string) => moneyText(minor, 'movement');
type Scope = { kind: 'school'; schoolId: string } | { kind: 'cafeteria'; cafeteriaId: string };
type Pending = Record<string, string>;
// Whether a positive correction may be offered. After financial activation, positive value is clearing-funded and only
// PIKAS finance may create it (the database refuses tenants with finance_adjustment_authority_required); 'unknown' fails closed.
export type CreditPolicy = 'allowed' | 'activated' | 'unknown';
type Phase = 'purpose' | 'purchase' | 'reversal' | 'details' | 'confirm' | 'pending' | 'success' | 'rejected' | 'uncertain';

// Phase 5C.3 exceptional balance corrections, as a focused task (Wave D.1). Purchases use Reembolso,
// wrong recargas use Revertir recarga. Typed values stay in memory; the existing recovery journal
// (exact key + payload) is written only at the explicit final action and retried only by the user.
export function WalletAdjustmentDialog({ scope, studentId, studentName, actorId, balanceMinor, credit = 'allowed', onClose, onDone }:
  { scope: Scope; studentId: string; studentName: string; actorId: string; balanceMinor: string; credit?: CreditPolicy; onClose: () => void; onDone: (message: string, balanceAfter: string) => void }) {
  const scopeId = scope.kind === 'school' ? scope.schoolId : scope.cafeteriaId;
  const key = `pikas:wallet-adjustment:${actorId}:${scope.kind}:${scopeId}:${studentId}`;
  const [request, setRequest] = useState<Pending | null>(() => { try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as Pending : null; } catch { return null; } });
  const [phase, setPhase] = useState<Phase>(request ? 'uncertain' : 'purpose');
  const [chosen, setDirection] = useState<'credit' | 'debit'>('credit');
  const direction = credit === 'allowed' ? chosen : 'debit';
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [problem, setProblem] = useState('');
  const [result, setResult] = useState<{ amount: string; after: string } | null>(null);
  const inFlight = useRef(false);
  const parsedAmount = parseCash(amount);
  const signedAmount = parsedAmount && BigInt(parsedAmount) > 0n ? (direction === 'debit' ? `-${parsedAmount}` : parsedAmount) : null;
  const preview = signedAmount ? (BigInt(balanceMinor) + BigInt(signedAmount)).toString() : null;
  const reasons = adjustmentReasons.filter(([, , d]) => d === 'any' || d === direction);
  const reasonLabel = (id: string) => adjustmentReasons.find(([r]) => r === id)?.[1] ?? id;
  const review = () => {
    if (!signedAmount) { setProblem(credit === 'allowed' ? 'Introduce un monto positivo con hasta dos decimales y elige si aumenta o disminuye el saldo.' : 'Introduce un monto positivo con hasta dos decimales.'); return; }
    if (!reason) { setProblem('Selecciona un motivo.'); return; }
    if (explanation.trim().length < 5) { setProblem('Escribe una explicación de al menos 5 caracteres.'); return; }
    setProblem(''); setPhase('confirm');
  };
  const commit = async () => {
    if (inFlight.current) return;
    const outgoing: Pending = request ?? { operation: 'adjust', ...(scope.kind === 'school' ? { school_id: scope.schoolId } : { cafeteria_id: scope.cafeteriaId }),
      student_id: studentId, amount_minor: signedAmount!, reason, explanation: explanation.trim(), request_key: crypto.randomUUID() };
    try { sessionStorage.setItem(key, JSON.stringify(outgoing)); } catch { setProblem('No se pudo preparar el ajuste. No se envió.'); return; }
    inFlight.current = true; setRequest(outgoing); setPhase('pending');
    try {
      const response = await sessionFetch(scope.kind === 'school' ? '/api/school/wallet' : '/api/cafeteria/wallet', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': outgoing.request_key }, body: JSON.stringify(outgoing) });
      let payload: { result?: unknown } = {};
      try { payload = await response.json(); } catch { /* uncertain */ }
      const parsed = adjustResultSchema.safeParse(payload.result);
      if (response.ok && parsed.success && parsed.data.student_id === studentId && parsed.data.amount_minor === outgoing.amount_minor) {
        sessionStorage.removeItem(key); setResult({ amount: parsed.data.amount_minor, after: parsed.data.balance_after_minor }); setPhase('success'); return;
      }
      if ([400, 401, 403, 422].includes(response.status)) { sessionStorage.removeItem(key); setRequest(null); setPhase('rejected'); return; }
      setPhase('uncertain');
    } catch { setPhase('uncertain'); }
    finally { inFlight.current = false; }
  };
  const shown = request?.amount_minor ?? signedAmount;
  // Typed values survive Atrás, so every pre-commit step counts them.
  const dirty = (['purpose', 'purchase', 'reversal', 'details'].includes(phase) && !!(amount || reason || explanation)) || phase === 'confirm' || phase === 'rejected';
  const close = () => { if (phase === 'success' && result) onDone(`Ajuste registrado: ${signed(result.amount)}. Saldo resultante: ${money(result.after)}.`, result.after); else onClose(); };
  const steps = ['Propósito', 'Detalles', 'Confirmar'], step = phase === 'confirm' ? 2 : phase === 'details' ? 1 : 0;
  const footer = {
    purpose: <TaskCancelButton>Cancelar</TaskCancelButton>,
    purchase: <><button type="button" className="btn-secondary" onClick={() => setPhase('purpose')}>Atrás</button><button type="button" className="btn" onClick={close}>Entendido</button></>,
    reversal: <><button type="button" className="btn-secondary" onClick={() => setPhase('purpose')}>Atrás</button><button type="button" className="btn" onClick={close}>Entendido</button></>,
    details: <><button type="button" className="btn-secondary" onClick={() => setPhase('purpose')}>Atrás</button><button type="button" className="btn" onClick={review}>Continuar</button></>,
    confirm: <><button type="button" className="btn-secondary" onClick={() => setPhase('details')}>Atrás</button><button type="button" className={signedAmount?.startsWith('-') ? 'btn-destructive' : 'btn'} onClick={() => void commit()}>Aplicar ajuste {signed(signedAmount ?? '0')}</button></>,
    pending: <button type="button" className="btn" disabled>Registrando ajuste…</button>,
    success: <button type="button" className="btn" data-autofocus onClick={close}>Cerrar</button>,
    rejected: <><TaskCancelButton>Cerrar</TaskCancelButton><button type="button" className="btn" onClick={() => setPhase('details')}>Revisar datos</button></>,
    uncertain: <><button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button><button type="button" className="btn" onClick={() => void commit()}>Reintentar el mismo ajuste</button></>,
  }[phase];
  return <TaskWindow title={phase === 'success' ? 'Ajuste registrado' : 'Corregir saldo'} context={<>{studentName} · Saldo actual <MoneyValue minor={balanceMinor} intent="balance" className="font-bold" /></>}
    steps={['purpose', 'details', 'confirm'].includes(phase) ? steps : undefined} step={step} busy={phase === 'pending'} dirty={dirty} onClose={close} footer={<TaskActions>{footer}</TaskActions>}>
    {phase === 'purpose' && <fieldset className="space-y-2"><legend className="mb-2 font-bold">¿Qué necesitas corregir?</legend>
      {([['purchase', 'Una compra', 'Se corrige con un reembolso desde el POS.'], ['reversal', 'Una recarga incorrecta', 'Se corrige revirtiendo esa recarga.'], ['details', 'Otra corrección excepcional de saldo', 'Ajuste administrativo con motivo y explicación.']] as const)
        .map(([next, label, help], index) => <button key={next} type="button" data-autofocus={index === 0 ? true : undefined} className="flex min-h-14 w-full flex-col items-start justify-center rounded-xl border px-4 py-2 text-left hover:bg-slate-50" onClick={() => { setProblem(''); setPhase(next); }}><span className="font-bold">{label}</span><span className="text-sm text-slate-600">{help}</span></button>)}
    </fieldset>}
    {phase === 'purchase' && <div className="space-y-2 rounded-xl bg-slate-100 p-3"><p className="font-bold">Usa Reembolso</p><p className="text-sm">Las compras se corrigen con un reembolso desde el POS (pestaña Reembolsos, con el número de recibo). Así el recibo y el dinero quedan enlazados.</p></div>}
    {phase === 'reversal' && <div className="space-y-2 rounded-xl bg-slate-100 p-3"><p className="font-bold">Usa Revertir recarga</p><p className="text-sm">{scope.kind === 'school' ? 'Busca la recarga en Movimientos de PIKAS Cash y usa "Revertir recarga".' : 'La administración escolar puede revertir la recarga desde los movimientos de PIKAS Cash.'}</p>
      {credit === 'activated' && <p className="text-sm">Las recargas en efectivo y por transferencia solo las revierte PIKAS: comparte con PIKAS su referencia (REC-…).</p>}</div>}
    {phase === 'details' && <>
      <p className="text-sm">Un ajuste administrativo <strong>no es una recarga</strong>: corrige el saldo de forma excepcional y queda registrado con tu nombre y rol.</p>
      {credit === 'allowed' ? <fieldset className="grid grid-cols-2 gap-2"><legend className="mb-1 font-bold">Tipo de ajuste</legend>
        {([['credit', '+ Aumentar saldo', 'text-emerald-800'], ['debit', '− Disminuir saldo', 'text-red-800']] as const).map(([value, label, tone]) =>
          <label key={value} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 font-bold ${tone} ${direction === value ? 'border-slate-900 bg-slate-50' : ''}`}><input type="radio" name="direction" data-autofocus={value === 'credit' ? true : undefined} checked={direction === value} onChange={() => { setDirection(value); setReason(''); }} />{label}</label>)}
      </fieldset> : <div className="space-y-1 rounded-xl bg-slate-100 p-3"><p className="font-bold"><span className="text-slate-700">Tipo de ajuste:</span> <span className="text-red-800">− Disminuir saldo</span></p>
        <p className="text-sm">{credit === 'activated'
          ? `Aquí solo se puede disminuir el saldo. Con el cargo por recarga PIKAS activo, el saldo aumenta solo con ${scope.kind === 'school' ? 'una recarga en efectivo en la cafetería' : '«Recibir efectivo»'} o una transferencia verificada por PIKAS; un aumento excepcional lo realiza PIKAS.`
          : 'No pudimos confirmar si este cliente admite aumentos de saldo. Por ahora solo puedes disminuirlo; vuelve a consultar el saldo para intentarlo de nuevo.'}</p></div>}
      <label className="block font-bold">Monto (RD$)<input className="field mt-1" aria-label="Monto del ajuste" inputMode="decimal" autoComplete="off" data-autofocus={credit === 'allowed' ? undefined : true} value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="block font-bold">Motivo<select className="field mt-1" aria-label="Motivo del ajuste" value={reason} onChange={e => setReason(e.target.value)}><option value="">Selecciona un motivo</option>{reasons.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="block font-bold">Explicación (obligatoria)<textarea className="field mt-1" aria-label="Explicación del ajuste" maxLength={500} value={explanation} onChange={e => setExplanation(e.target.value)} /></label>
      {problem && <p role="alert" className="font-bold text-red-800">{problem}</p>}
    </>}
    {phase === 'confirm' && signedAmount && preview && <>
      <p className="font-bold">Revisa el ajuste administrativo antes de aplicarlo.</p>
      <TaskSummary rows={[['Estudiante', studentName], ['Ajuste', <MoneyValue key="a" minor={signedAmount} intent="movement" />], ['Dirección', signedAmount.startsWith('-') ? 'Disminuye el saldo' : 'Aumenta el saldo'],
        ['Motivo', reasonLabel(reason)], ['Saldo actual', <MoneyValue key="b" minor={balanceMinor} intent="balance" />], ['Saldo resultante (estimado)', <MoneyValue key="c" minor={preview} intent="balance" />]]} />
      <p className="break-words rounded-xl bg-slate-50 p-3 text-sm"><span className="font-semibold">Explicación:</span> {explanation.trim()}</p>
      {BigInt(preview) < 0n && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-950">El saldo quedará negativo ({money(preview)}). El estudiante no podrá pagar con PIKAS Cash hasta que nuevas recargas cubran el saldo.</p>}
      <p className="text-sm font-semibold">Esto crea un registro financiero permanente con tu nombre y rol. No se puede editar ni borrar; una corrección posterior requiere otro ajuste.</p>
    </>}
    {phase === 'pending' && shown && <TaskOutcome kind="pending" title="Registrando el ajuste…"><p>No cierres esta ventana. Ajuste de <MoneyValue minor={shown} intent="movement" /> para {studentName}.</p></TaskOutcome>}
    {phase === 'success' && result && <TaskOutcome kind="success" title="Ajuste aplicado"><p className="text-2xl font-black"><MoneyValue minor={result.amount} intent="movement" /></p><p>Saldo actual de {studentName}: <MoneyValue minor={result.after} intent="balance" className="font-bold" /></p></TaskOutcome>}
    {phase === 'rejected' && <TaskOutcome kind="failure" title="No se registró el ajuste"><p>PIKAS rechazó la solicitud. No se movió dinero. Revisa los datos, el motivo y tus permisos.</p></TaskOutcome>}
    {phase === 'uncertain' && request && <TaskOutcome kind="uncertain" title="Ajuste pendiente de confirmar"><p>No sabemos si se registró el ajuste de <MoneyValue minor={request.amount_minor} intent="movement" />. Reintenta el mismo ajuste: PIKAS no lo duplicará. No inicies otro.</p></TaskOutcome>}
  </TaskWindow>;
}
