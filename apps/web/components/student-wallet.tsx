'use client';
import { useCallback, useEffect, useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { historySchema, type History, type Credit } from '../lib/wallet/contracts';
import { load } from '../lib/wallet/command';
import { money } from '../lib/cafeteria/operations';
import { adjustmentReasons, reversalReasons } from '../lib/wallet/contracts';
import { WalletAdjustmentDialog } from './wallet-adjustment-dialog';
import { MoneyValue } from './money-value';
import { AppPageHeader } from './app-page-header';
import { TaskSummary } from './task-window';
import { WalletReversalDialog, loadPendingReversal, reversalJournalKey } from './wallet-reversal-dialog';
import { WalletRechargeTask, rechargeJournalKey } from './wallet-recharge-task';
const reasonLabel = Object.fromEntries(reversalReasons) as Record<string,string>;
const adjustmentLabel = Object.fromEntries(adjustmentReasons.map(([id,label])=>[id,label])) as Record<string,string>;
const roleLabel: Record<string,string> = {account_admin:'Administración de cuenta',school_admin:'Administración escolar',cafeteria_admin:'Administración de cafetería'};
export function StudentWallet({ schoolId, studentId, actorId, canReplenish, canReverse = false, canAdjust = false, back }: {schoolId:string;studentId:string;actorId:string;canReplenish:boolean;canReverse?:boolean;canAdjust?:boolean;back?:{href:string;label:string}}) {
  const key = rechargeJournalKey(actorId, schoolId, studentId);
  const [history,setHistory] = useState<History|null>(null);
  const [pending,setPending] = useState<Credit|null>(null);
  const [ready,setReady] = useState(false);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [before,setBefore] = useState<string|null>(null);
  const [recharging,setRecharging] = useState(false);
  const [reversal,setReversal] = useState<{replenishmentId:string;amountMinor:string;reference:string|null;note:string|null;occurredAt:string}|null>(null);
  const [pendingReversal,setPendingReversal] = useState<string|null>(null);
  const [adjusting,setAdjusting] = useState(false);
  const read = useCallback(async (cursor:string|null=null) => {
    setLoading(true); setError('');
    try {
      const response = await sessionFetch('/api/school/wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'read',school_id:schoolId,student_id:studentId,before:cursor})});
      const parsed = historySchema.safeParse((await response.json()).result);
      if (!response.ok || !parsed.success || parsed.data.school_id!==schoolId || parsed.data.student_id!==studentId) throw Error();
      setHistory(parsed.data); setBefore(cursor);
    } catch { setError('No se pudo cargar PIKAS Cash con tus permisos actuales. Reintenta la consulta.'); }
    finally { setLoading(false); }
  },[schoolId,studentId]);
  useEffect(()=>{let alive=true;queueMicrotask(()=>{if(!alive)return;try{const stored=load(sessionStorage,key);if(stored&&(stored.school_id!==schoolId||stored.student_id!==studentId))throw Error();setPending(stored);setReady(true);try{setPendingReversal(loadPendingReversal(reversalJournalKey(actorId,schoolId,studentId))?.replenishment_id??null);}catch{setPendingReversal(null);}}catch{setMessage('No se puede recuperar la solicitud. Las recargas están bloqueadas.');}void read();});return()=>{alive=false;};},[key,actorId,schoolId,studentId,read]);
  const typeLabel=(m:History['movements'][number])=>m.type==='adjustment'&&m.actor_role?'Ajuste administrativo':{replenishment:'Recarga verificada',purchase:'Compra',adjustment:'Ajuste histórico',refund:'Reembolso histórico',replenishment_reversal:'Reversión de recarga'}[m.type];
  const when=(at:string)=>new Date(at).toLocaleString('es-DO',{timeZone:'America/Santo_Domingo',dateStyle:'medium',timeStyle:'short'});
  // One-line context from existing fields only; the full record is in "Ver detalle".
  const context=(m:History['movements'][number])=>m.type==='purchase'?[m.receipt_number?`Recibo #${m.receipt_number}`:null,m.cafeteria].filter(Boolean).join(' · '):m.type==='adjustment'&&m.actor_role?`Motivo: ${adjustmentLabel[m.adjustment_reason??'']??m.adjustment_reason??'—'}`:m.type==='replenishment_reversal'?`Motivo: ${reasonLabel[m.reversal_reason??'']??m.reversal_reason??'—'}`:m.reference?`Referencia: ${m.reference}`:'';
  const details=(m:History['movements'][number]):[string,React.ReactNode][]=>[
    ...(m.purchase_id?[['Recibo',`#${m.receipt_number??'—'}`],['Cafetería',m.cafeteria??'—']] as [string,React.ReactNode][]:[]),
    ...(m.type==='adjustment'&&m.actor_role?[['Motivo',adjustmentLabel[m.adjustment_reason??'']??m.adjustment_reason??'—'],['Rol',roleLabel[m.actor_role]??m.actor_role],...(m.cafeteria?[['Cafetería',m.cafeteria]]:[]),...(m.balance_before_minor?[['Saldo antes',<MoneyValue key="b" minor={m.balance_before_minor} intent="balance"/>]]:[])] as [string,React.ReactNode][]:[]),
    ...(m.type==='replenishment_reversal'?[['Motivo',reasonLabel[m.reversal_reason??'']??m.reversal_reason??'—'],...(m.reversal_note?[['Explicación',m.reversal_note]]:[]),...(m.original_reference?[['Referencia original',m.original_reference]]:[])] as [string,React.ReactNode][]:[]),
    ...(m.replenishment_id?[['Origen','Fondos manuales verificados']] as [string,React.ReactNode][]:[]),
    ...(m.reference?[['Referencia',m.reference]] as [string,React.ReactNode][]:[]),...(m.note?[['Nota',m.note]] as [string,React.ReactNode][]:[]),
    ['Registrado por',m.actor??'Actor registrado'],['Fecha',when(m.occurred_at)],['Saldo después',<MoneyValue key="a" minor={m.balance_after_minor} intent="balance"/>],
  ];
  const ids=(m:History['movements'][number])=>[m.purchase_id&&`Compra ${m.purchase_id}`,m.replenishment_id&&`Recarga ${m.replenishment_id}`,m.reversed_replenishment_id&&`Revierte la recarga ${m.reversed_replenishment_id}`].filter(Boolean) as string[];
  return <div className="space-y-5">
    <AppPageHeader back={back} title={history?.student_name??'PIKAS Cash'} description={history?'PIKAS Cash del estudiante':undefined}
      action={<button type="button" className="btn-secondary" disabled={loading} onClick={()=>void read(before)}>{loading?'Actualizando…':'Actualizar'}</button>}/>
    {loading&&!history&&<p role="status">Consultando PIKAS Cash…</p>}{error&&<p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-800">{error}</p>}
    {history&&<><section className="card space-y-3 p-5" aria-label="Saldo PIKAS Cash"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-sm font-bold uppercase tracking-wide text-slate-600">Saldo PIKAS Cash</h2><p className="text-3xl font-black"><MoneyValue minor={history.wallet?.balance_minor??'0'} intent="balance"/></p>
    <p className="text-sm">{history.wallet?.status==='frozen'?'PIKAS Cash congelado':'PIKAS Cash activo'}</p></div>
    {(canReplenish||canAdjust)&&<div className="flex flex-wrap gap-2">
      {canAdjust&&<button type="button" className="btn-secondary" onClick={()=>{setMessage('');setAdjusting(true);}}>Corregir saldo</button>}
      {canReplenish&&<button type="button" className="btn" disabled={!ready||pending!==null||history.wallet?.status==='frozen'} onClick={()=>{setMessage('');setRecharging(true);}}>Recargar</button>}
    </div>}</div>
    {BigInt(history.wallet?.balance_minor??'0')<0n&&<p role="alert" className="rounded-xl bg-amber-100 p-3 font-bold text-amber-950">Saldo negativo. No se pueden pagar compras con PIKAS Cash hasta que nuevas recargas cubran el saldo.</p>}
    {pendingReversal&&<p role="alert" className="text-sm">Hay una reversión pendiente de confirmar. Abre la recarga correspondiente y reintenta la misma reversión.</p>}
    {pending&&<div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="font-bold">Hay una recarga de {money(pending.amount_minor)} pendiente de confirmar.</p><p className="text-sm">Revísala y reintenta la misma solicitud antes de registrar otra recarga.</p>{canReplenish&&<button type="button" className="btn-secondary" onClick={()=>setRecharging(true)}>Revisar recarga pendiente</button>}</div>}
    {!canReplenish&&<p className="text-sm text-slate-600">Consulta de solo lectura. Tu rol no puede registrar recargas.</p>}
    {canReplenish&&history.wallet?.status==='frozen'&&<p className="text-sm text-slate-600">PIKAS Cash congelado: no admite recargas.</p>}
    <p className="text-sm text-slate-600">Las recargas manuales requieren fondos previamente verificados.</p>
    {message&&<p role="status">{message}</p>}</section>
    <section className="space-y-3" aria-labelledby="wallet-movements"><div><h2 id="wallet-movements" className="text-lg font-bold">Movimientos de PIKAS Cash</h2><p className="text-xs text-slate-600">Más recientes primero. El saldo de cada movimiento corresponde al momento de registrarlo.</p></div>
      {!history.movements.length&&<p className="card p-5">No hay movimientos registrados.</p>}
      {history.movements.length>0&&<ul className="card divide-y">{history.movements.map(m=><li className="space-y-2 break-words p-4" key={m.id}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1"><div className="min-w-0 flex-1 basis-48"><h3 className="font-bold">{typeLabel(m)}</h3><p className="text-sm text-slate-600">{when(m.occurred_at)} · {m.actor??'Actor registrado'}</p>{context(m)&&<p className="text-sm">{context(m)}</p>}
          {m.type==='replenishment'&&m.reversal_id&&<p className="mt-1"><span className="chip bg-amber-100 text-amber-900">Revertida · {reasonLabel[m.reversal_reason??'']??m.reversal_reason}</span></p>}</div>
          <div className="text-right"><p className="text-lg font-black"><MoneyValue minor={m.amount_minor} intent="movement"/></p><p className="text-xs text-slate-600">Saldo después: <MoneyValue minor={m.balance_after_minor} intent="balance"/></p></div></div>
        <details className="group"><summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-bold text-teal-800">Ver detalle</summary><div className="mt-2 space-y-3"><TaskSummary rows={details(m)}/>
          {m.items.length>0&&<div><p className="text-sm font-bold">Artículos</p><ul className="text-sm">{m.items.map((i,n)=><li key={n} className="flex justify-between gap-3"><span>{i.quantity} × {i.name}</span><MoneyValue minor={i.line_total_minor} intent="amount"/></li>)}</ul></div>}
          {ids(m).map(text=><p key={text} className="break-all text-xs text-slate-500">{text}</p>)}</div></details>
        {m.type==='replenishment'&&!m.reversal_id&&canReverse&&m.replenishment_id&&<button type="button" className="btn-secondary" onClick={()=>{setMessage('');setReversal({replenishmentId:m.replenishment_id!,amountMinor:m.amount_minor,reference:m.reference,note:m.note,occurredAt:m.occurred_at});}}>{pendingReversal===m.replenishment_id?'Recuperar reversión pendiente':'Revertir recarga'}</button>}</li>)}</ul>}
      <div className="flex flex-wrap gap-3">{before&&<button className="btn-secondary" disabled={loading} onClick={()=>void read()}>Más recientes</button>}{history.next_before&&<button className="btn-secondary" disabled={loading} onClick={()=>void read(history.next_before)}>Movimientos anteriores</button>}</div>
    </section>
    {recharging&&<WalletRechargeTask schoolId={schoolId} studentId={studentId} studentName={history.student_name} actorId={actorId} balanceMinor={history.wallet?.balance_minor??'0'}
      onClose={()=>{setRecharging(false);try{setPending(load(sessionStorage,key));}catch{setPending(null);}}} onDone={async after=>{setRecharging(false);setPending(null);setMessage(`Recarga registrada. Saldo actual: ${money(after)}.`);await read();}}/>}
    {adjusting&&<WalletAdjustmentDialog scope={{kind:'school',schoolId}} studentId={studentId} studentName={history.student_name} actorId={actorId} balanceMinor={history.wallet?.balance_minor??'0'}
      onClose={()=>setAdjusting(false)} onDone={async text=>{setAdjusting(false);setMessage(text);await read();}}/>}
    {reversal&&<WalletReversalDialog schoolId={schoolId} studentId={studentId} studentName={history.student_name} actorId={actorId} balanceMinor={history.wallet?.balance_minor??'0'} target={reversal}
      onClose={()=>setReversal(null)} onDone={async text=>{setReversal(null);setPendingReversal(null);setMessage(text);await read(before);}}/>}</>}
  </div>;
}
