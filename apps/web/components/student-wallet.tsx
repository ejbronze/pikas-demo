'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { historySchema, type History, type Credit } from '../lib/wallet/contracts';
import { load, prepare, send } from '../lib/wallet/command';
import { money } from '../lib/cafeteria/operations';
import { parseCash } from '../lib/pos/contracts';
export function StudentWallet({ schoolId, studentId, actorId, canReplenish }: {schoolId:string;studentId:string;actorId:string;canReplenish:boolean}) {
  const key = `pikas:wallet:${actorId}:${schoolId}:${studentId}`;
  const [history,setHistory] = useState<History|null>(null);
  const [pending,setPending] = useState<Credit|null>(null);
  const [ready,setReady] = useState(false);
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [before,setBefore] = useState<string|null>(null);
  const inFlight = useRef(false);
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
  useEffect(()=>{let alive=true;queueMicrotask(()=>{if(!alive)return;try{const stored=load(sessionStorage,key);if(stored&&(stored.school_id!==schoolId||stored.student_id!==studentId))throw Error();setPending(stored);setReady(true);}catch{setMessage('No se puede recuperar la solicitud. Las recargas están bloqueadas.');}void read();});return()=>{alive=false;};},[key,schoolId,studentId,read]);
  return <div className="space-y-5"><p className="text-sm text-slate-600">Saldo del estudiante. Las recargas manuales requieren fondos previamente verificados.</p>
    {loading&&<p role="status">Consultando PIKAS Cash…</p>}{error&&<p role="alert">{error}</p>}
    <button type="button" className="btn-secondary" disabled={loading} onClick={()=>void read()}>Actualizar saldo e historial</button>
    {history&&<><p className="text-xl font-bold">{history.student_name}</p><section className="card space-y-3 p-5"><h2 className="text-lg font-bold">Saldo PIKAS Cash</h2><p className="text-3xl font-black">{money(history.wallet?.balance_minor??'0')}</p><p>{history.wallet?.status==='frozen'?'Monedero congelado':'Monedero activo'}</p>
    {!canReplenish?<p className="text-sm text-slate-600">Consulta de solo lectura. Tu rol no puede registrar recargas.</p>:<form className="space-y-3" noValidate={pending!==null} onSubmit={async event=>{
      event.preventDefault();if(!ready||inFlight.current)return;
      const form=event.currentTarget;
      inFlight.current=true;setBusy(true);
      try{
        const recovery=pending??load(sessionStorage,key);
        let command=recovery;
        if(!command){const data=new FormData(form);const amount=parseCash(String(data.get('amount')??''));if(amount===null||BigInt(amount)<=0n){setMessage('Introduce un monto positivo con hasta dos decimales.');return;}
          if(!window.confirm(`¿Confirmar recarga manual verificada de ${money(amount)}?`))return;
          command=prepare(sessionStorage,key,{operation:'replenish',school_id:schoolId,student_id:studentId,amount_minor:amount,reference:String(data.get('reference')??'').trim(),note:String(data.get('note')??'').trim(),request_key:crypto.randomUUID()});}
        setPending(command);const result=await send(command);
        if(result.outcome==='success'){sessionStorage.removeItem(key);setPending(null);form.reset();setMessage(`Recarga confirmada. Saldo al registrar: ${money(result.result.balance_after_minor)}.`);await read();}
        else if(recovery||result.outcome==='uncertain'){setMessage('Resultado pendiente de confirmar. Conservamos la misma solicitud; recupera el acceso y reintenta antes de editar.');}
        else{sessionStorage.removeItem(key);setPending(null);setMessage('No se realizó la recarga. Revisa los datos, la matrícula, el estado y tus permisos.');}
      }catch{setMessage('No se pudo preparar o recuperar la solicitud. No se ha enviado una nueva recarga.');}
      finally{inFlight.current=false;setBusy(false);}
    }}>
    <fieldset disabled={!ready||busy||pending!==null||history.wallet?.status==='frozen'} className="min-w-0 space-y-3">
      <label className="block">Monto de recarga (RD$)<input name="amount" inputMode="decimal" className="field mt-1 w-full" required maxLength={22} /></label>
      <label className="block">Referencia de fondos verificados<input name="reference" className="field mt-1 w-full" maxLength={160} /></label>
      <label className="block">Nota de verificación<textarea name="note" className="field mt-1 w-full" maxLength={500} /></label>
      <p className="text-xs text-slate-600">Incluye referencia o nota. Esta recarga no registra efectivo recibido en una caja ni amplía límites de gasto.</p>
    </fieldset>
    <button className="btn" disabled={!ready||busy||(!pending&&history.wallet?.status==='frozen')}>{busy?'Confirmando…':pending?'Recuperar misma recarga':'Confirmar recarga verificada'}</button>
    {pending&&<p className="break-words text-sm">Solicitud pendiente: {money(pending.amount_minor)} · {pending.reference||pending.note}</p>}
    {message&&<p role="status">{message}</p>}
    </form>}</section>
    <section className="space-y-3"><h2 className="text-lg font-bold">Movimientos del monedero</h2><p className="text-xs text-slate-600">Más recientes primero. El saldo de cada movimiento corresponde al momento de registrarlo.</p>
      {!history.movements.length&&<p>No hay movimientos registrados.</p>}
      {history.movements.map(m=><article className="card space-y-2 break-words p-4" key={m.id}><h3 className="font-bold">{{replenishment:'Recarga verificada',purchase:'Compra',adjustment:'Ajuste histórico',refund:'Reembolso histórico'}[m.type]} · {BigInt(m.amount_minor)>0n?'+':''}{money(m.amount_minor)}</h3><p className="text-sm">{new Date(m.occurred_at).toLocaleString('es-DO',{timeZone:'America/Santo_Domingo'})} · {m.actor??'Actor registrado'}</p><p>Saldo después: {money(m.balance_after_minor)}</p>{m.purchase_id&&<details><summary className="cursor-pointer">Recibo #{m.receipt_number} · {m.cafeteria}</summary><p className="break-all text-xs">Compra {m.purchase_id}</p>{m.items.map((i,n)=><p key={n}>{i.quantity} × {i.name} · {money(i.line_total_minor)}</p>)}</details>}{m.replenishment_id&&<p className="break-all text-xs">Recarga {m.replenishment_id} · Fondos manuales verificados</p>}{m.reference&&<p>Referencia: {m.reference}</p>}{m.note&&<p>{m.note}</p>}</article>)}
      <div className="flex flex-wrap gap-3">{before&&<button className="btn-secondary" disabled={loading} onClick={()=>void read()}>Más recientes</button>}{history.next_before&&<button className="btn-secondary" disabled={loading} onClick={()=>void read(history.next_before)}>Movimientos anteriores</button>}</div>
    </section></>}
  </div>;
}
