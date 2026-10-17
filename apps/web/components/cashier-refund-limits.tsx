'use client';
import { useEffect, useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { limitsSchema } from '../lib/pos/refunds';
import { parseCash } from '../lib/pos/contracts';
type Limits = ReturnType<typeof limitsSchema.parse>;
async function callLimits(cafeteriaId: string, body: object) {
  const response = await sessionFetch('/api/cafeteria/refund-limits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const parsed = limitsSchema.safeParse((await response.json()).result);
  if (!response.ok || !parsed.success || parsed.data.cafeteria_id !== cafeteriaId) throw Error(String(response.status));
  return parsed.data;
}
const plain = (minor: string) => `${BigInt(minor)/100n}.${(BigInt(minor)%100n).toString().padStart(2,'0')}`;
// Cashier refunds without supervisor override: within 5 minutes of the sale and both daily limits.
export function CashierRefundLimits({ cafeteriaId }: { cafeteriaId: string }) {
  const [limits,setLimits] = useState<Limits|null>(null);
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  useEffect(()=>{let alive=true;void callLimits(cafeteriaId,{operation:'read',cafeteria_id:cafeteriaId}).then(l=>{if(alive)setLimits(l);},()=>{if(alive)setMessage('No se pudieron cargar los límites de reembolso.');});return()=>{alive=false;};},[cafeteriaId]);
  return <section className="card mt-5 space-y-3 p-5"><h2 className="text-xl font-black">Reembolsos de cajeros</h2>
    <p className="text-sm text-slate-600">Un cajero puede reembolsar sin autorización solo dentro de los 5 minutos posteriores a la venta y dentro de ambos límites diarios. Si no, se requiere autorización de un supervisor POS o administrador de cafetería.</p>
    {limits&&<form key={limits.version} className="grid gap-3 sm:grid-cols-2" onSubmit={async event=>{
      event.preventDefault(); if(busy)return;
      const data=new FormData(event.currentTarget); const count=Number(data.get('count')); const amount=parseCash(String(data.get('amount')??''));
      if(!Number.isInteger(count)||count<0||count>10000||amount===null){setMessage('Revisa los límites: cantidad entera y monto con hasta dos decimales.');return;}
      setBusy(true); setMessage('');
      try{ const next=await callLimits(cafeteriaId,{operation:'configure',cafeteria_id:cafeteriaId,expected_version:limits.version,count_limit:count,amount_limit_minor:amount}); setLimits(next); setMessage('Límites guardados.'); }
      catch(e){ setMessage(String(e).includes('409')?'Otro usuario cambió los límites. Recarga la página.':'No se pudieron guardar los límites.'); }
      finally{ setBusy(false); }
    }}>
      <label className="block">Reembolsos por cajero al día<input name="count" type="number" min={0} max={10000} className="field mt-1 w-full" defaultValue={limits.count_limit} /></label>
      <label className="block">Monto diario por cajero (RD$)<input name="amount" inputMode="decimal" className="field mt-1 w-full" defaultValue={plain(limits.amount_limit_minor)} /></label>
      <button className="btn-secondary sm:col-span-2" disabled={busy}>{busy?'Guardando…':'Guardar límites'}</button>
    </form>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
