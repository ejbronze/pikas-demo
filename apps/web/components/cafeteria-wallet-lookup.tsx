'use client';
import { useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { cafeteriaReadSchema, type CafeteriaWalletRead } from '../lib/wallet/contracts';
import { money } from '../lib/cafeteria/operations';
import { WalletAdjustmentDialog } from './wallet-adjustment-dialog';
// Balances of eligible customers; with 5C.3 capability, scoped administrative adjustments for those students only.
export function CafeteriaWalletLookup({ cafeteriaId, actorId = '', canAdjust = false }: { cafeteriaId: string; actorId?: string; canAdjust?: boolean }) {
  const [result,setResult] = useState<CafeteriaWalletRead|null>(null);
  const [lastQuery,setLastQuery] = useState('');
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [adjusting,setAdjusting] = useState<CafeteriaWalletRead['students'][number]|null>(null);
  const lookup = async (query: string) => {
    setLoading(true); setError('');
    try{
      const response=await sessionFetch('/api/cafeteria/wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cafeteria_id:cafeteriaId,query})});
      const parsed=cafeteriaReadSchema.safeParse((await response.json()).result);
      if(!response.ok||!parsed.success||parsed.data.cafeteria_id!==cafeteriaId)throw Error();
      setResult(parsed.data); setLastQuery(query);
    }catch{setResult(null);setError('No se pudo consultar PIKAS Cash con tus permisos actuales. Reintenta la consulta.');}
    finally{setLoading(false);}
  };
  return <section className="card mt-5 space-y-3 p-5"><h2 className="text-xl font-black">Saldo PIKAS Cash de clientes</h2>
    <p className="text-sm text-slate-600">Consulta para estudiantes que la escuela comparte con esta cafetería. Las recargas las realiza la administración escolar.{canAdjust?' Los ajustes administrativos son solo para correcciones excepcionales.':''}</p>
    <form className="flex flex-wrap gap-3" onSubmit={event=>{event.preventDefault(); if(!loading) void lookup(String(new FormData(event.currentTarget).get('query')??'').trim());}}>
      <input name="query" className="field min-w-0 flex-1" aria-label="Buscar cliente por nombre" placeholder="Buscar por nombre" maxLength={80} />
      <button className="btn-secondary" disabled={loading}>{loading?'Consultando…':'Consultar saldo'}</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    {message&&<p role="status">{message}</p>}
    {result&&(result.students.length?<ul className="space-y-2" aria-label="Saldos PIKAS Cash">{result.students.map(s=><li key={s.student_id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"><span className="break-words font-semibold">{s.display_name}</span>
      <span className="flex flex-wrap items-center gap-3"><span className={s.wallet_status!==null&&BigInt(s.balance_minor)<0n?'font-bold text-red-700':''}>{s.wallet_status===null?'Sin monedero':`${money(s.balance_minor)}${s.wallet_status==='frozen'?' · Congelado':''}`}</span>
      {canAdjust&&<button type="button" className="btn-secondary" aria-label={`Corregir saldo de ${s.display_name}`} onClick={()=>{setMessage('');setAdjusting(s);}}>Corregir saldo</button>}</span></li>)}</ul>:<p>No hay clientes compartidos que coincidan.</p>)}
    {adjusting&&<WalletAdjustmentDialog scope={{kind:'cafeteria',cafeteriaId}} studentId={adjusting.student_id} studentName={adjusting.display_name} actorId={actorId} balanceMinor={adjusting.balance_minor}
      onClose={()=>setAdjusting(null)} onDone={async text=>{setAdjusting(null);setMessage(text);await lookup(lastQuery);}}/>}
  </section>;
}
