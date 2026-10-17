'use client';
import { useState } from 'react';
import { sessionFetch } from '../lib/auth/session-fetch';
import { cafeteriaReadSchema, type CafeteriaWalletRead } from '../lib/wallet/contracts';
import { money } from '../lib/cafeteria/operations';
// Read-only: cafeteria administrators see balances of eligible customers and never mutate wallets.
export function CafeteriaWalletLookup({ cafeteriaId }: { cafeteriaId: string }) {
  const [result,setResult] = useState<CafeteriaWalletRead|null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  return <section className="card mt-5 space-y-3 p-5"><h2 className="text-xl font-black">Saldo PIKAS Cash de clientes</h2>
    <p className="text-sm text-slate-600">Consulta de solo lectura para estudiantes que la escuela comparte con esta cafetería. Las recargas las realiza la administración escolar.</p>
    <form className="flex flex-wrap gap-3" onSubmit={async event=>{
      event.preventDefault(); if(loading)return;
      const query=String(new FormData(event.currentTarget).get('query')??'').trim();
      setLoading(true); setError('');
      try{
        const response=await sessionFetch('/api/cafeteria/wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cafeteria_id:cafeteriaId,query})});
        const parsed=cafeteriaReadSchema.safeParse((await response.json()).result);
        if(!response.ok||!parsed.success||parsed.data.cafeteria_id!==cafeteriaId)throw Error();
        setResult(parsed.data);
      }catch{setResult(null);setError('No se pudo consultar PIKAS Cash con tus permisos actuales. Reintenta la consulta.');}
      finally{setLoading(false);}
    }}>
      <input name="query" className="field min-w-0 flex-1" aria-label="Buscar cliente por nombre" placeholder="Buscar por nombre" maxLength={80} />
      <button className="btn-secondary" disabled={loading}>{loading?'Consultando…':'Consultar saldo'}</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    {result&&(result.students.length?<ul className="space-y-2" aria-label="Saldos PIKAS Cash">{result.students.map(s=><li key={s.student_id} className="flex flex-wrap justify-between gap-2 border-t pt-2"><span className="break-words font-semibold">{s.display_name}</span><span>{s.wallet_status===null?'Sin monedero':`${money(s.balance_minor)}${s.wallet_status==='frozen'?' · Congelado':''}`}</span></li>)}</ul>:<p>No hay clientes compartidos que coincidan.</p>)}
  </section>;
}
