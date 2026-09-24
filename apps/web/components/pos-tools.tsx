"use client";
import {useState} from 'react';
import {businessDay,parseMoney,refundedMinor,type PosPurchaseRecord} from '@pikas/data-access';
import {usePosHistory as useDemo} from './demo-provider';
export const posMoney=(minor:number)=>new Intl.NumberFormat('es-DO',{style:'currency',currency:'DOP'}).format(minor/100);
export function Calculator(){
  const [left,setLeft]=useState(''),[right,setRight]=useState(''),[operation,setOperation]=useState('+');
  const a=Number(left),b=Number(right),result=operation==='+'?a+b:operation==='−'?a-b:operation==='×'?a*b:b===0?NaN:a/b;
  return <details className="card p-4"><summary className="cursor-pointer py-2 font-bold">Calculadora</summary><div className="mt-3 grid gap-3 sm:grid-cols-3"><input className="field" aria-label="Primer número" inputMode="decimal" value={left} onChange={e=>setLeft(e.target.value)}/><select className="field" aria-label="Operación" value={operation} onChange={e=>setOperation(e.target.value)}>{['+','−','×','÷'].map(op=><option key={op}>{op}</option>)}</select><input className="field" aria-label="Segundo número" inputMode="decimal" value={right} onChange={e=>setRight(e.target.value)}/></div><output className="mt-3 block text-xl font-black">Resultado: {Number.isFinite(result)?result:'No definido'}</output><p className="text-sm">Esta herramienta no cambia el carrito ni el efectivo recibido.</p></details>;
}
export function PurchaseDetail({purchase,admin=false}:{purchase:PosPurchaseRecord;admin?:boolean}){
  const {state,refundPos,connection}=useDemo();
  const [amount,setAmount]=useState(''),[reason,setReason]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[key,setKey]=useState(()=>crypto.randomUUID());
  const events=state.events.filter(e=>e.originalPurchaseId===purchase.id),remaining=purchase.totalMinor-refundedMinor(purchase.id,state.events);
  const allowed=admin||state.posPolicy.allowCashierRefunds;
  return <section className="card space-y-3 p-5" aria-label="Detalle de transacción">
    <h2 className="text-xl font-black">Detalle de transacción</h2><p className="break-all">ID {purchase.id} · Completada</p><p>{purchase.studentName} · {purchase.studentCode??purchase.studentId??'Sin cuenta'}</p>
    <p>{purchase.paymentMethod==='cash'?'Efectivo':'Saldo PIKAS'} · {new Date(purchase.createdAt).toLocaleString('es-DO')}</p><p>Cajero: {purchase.employeeLabel} · Registro: {purchase.posStationId} · Ubicación: {purchase.locationId}</p>
    <ul>{purchase.items.map((item,index)=><li className="flex justify-between gap-3 py-2" key={`${item.itemId}-${index}`}><span>{item.quantity}× {item.name}</span><strong>{posMoney(item.quantity*item.unitPriceMinor)}</strong></li>)}</ul>
    <p className="text-lg font-black">Total {posMoney(purchase.totalMinor)}</p>{purchase.paymentMethod==='cash'?<p>Recibido {posMoney(purchase.cashReceivedMinor??0)} · Cambio {posMoney(purchase.changeProvidedMinor??0)}</p>:null}
    {events.map(event=><div className="rounded-xl bg-emerald-50 p-3 text-emerald-950" key={event.id}><p>Reembolso {posMoney(event.amountMinor)} → {event.destination==='wallet'?'Saldo PIKAS':'Efectivo'}</p><p className="break-all">{event.id} · {event.reason}</p><p>Procesado por {event.actorName}{event.approvedByName?` · Aprobado por ${event.approvedByName}`:''}</p></div>)}
    {allowed&&remaining>0?<form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);const result=await refundPos(purchase.id,parseMoney(amount)||remaining,reason,key);setNotice(result.ok?'Reembolso completado.':result.message);if(result.ok){setAmount('');setReason('');setKey(crypto.randomUUID())}setBusy(false)}} className="space-y-3 border-t pt-4">
      <h3 className="font-black">Reembolsar · Disponible {posMoney(remaining)}</h3>
      {state.posPolicy.requireApproval&&!admin?<p>Requiere aprobación. El administrador debe entrar en su cuenta y procesar este ID en Transacciones.</p>:<>
        {state.posPolicy.partialRefunds?<label className="block font-bold">Monto del reembolso (RD$)<input className="field mt-2" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder={String(remaining/100)}/></label>:<p>Reembolso completo</p>}
        <label className="block font-bold">Motivo<input className="field mt-2" required={state.posPolicy.requireReason} value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <button className="btn" disabled={busy||connection!=='Online'||(amount!==''&&(parseMoney(amount)===null||parseMoney(amount)===0))}>Confirmar reembolso</button>
      </>}
    </form>:null}{notice?<p role="status">{notice}</p>:null}
  </section>;
}
export function PosHistory({admin=false}:{admin?:boolean}){
  const {state}=useDemo();const [query,setQuery]=useState(''),[day,setDay]=useState(''),[cashier,setCashier]=useState(''),[selected,setSelected]=useState<string|null>(null);
  const purchases=state.purchases.filter(p=>p.organizationId==='cafeteria-demo'&&p.locationId==='principal');
  const rows=purchases.filter(p=>(!day||businessDay(p.createdAt)===day)&&(!cashier||p.cashierId===cashier)&&`${p.id} ${p.studentName} ${p.studentId} ${p.studentCode??''}`.toLowerCase().includes(query.toLowerCase()));
  const purchase=purchases.find(p=>p.id===selected);
  return <section className="space-y-4"><h2 className="text-2xl font-black">Historial POS</h2><div className="grid gap-3 sm:grid-cols-3"><input className="field" aria-label="Buscar transacción" placeholder="ID, nombre o código" value={query} onChange={e=>setQuery(e.target.value)}/><input className="field" aria-label="Fecha de transacción" type="date" value={day} onChange={e=>setDay(e.target.value)}/><select className="field" aria-label="Cajero" value={cashier} onChange={e=>setCashier(e.target.value)}><option value="">Todos los cajeros</option>{[...new Map(purchases.map(p=>[p.cashierId,p.employeeLabel])).entries()].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></div>
    <div className="card divide-y p-4">{rows.length?rows.map(p=><button className="flex min-h-16 w-full flex-wrap justify-between gap-2 py-3 text-left" key={p.id} onClick={()=>setSelected(p.id)}><span><strong>{p.studentName}</strong><span className="block text-sm">{p.items.map(i=>`${i.quantity}× ${i.name}`).join(', ')} · {p.studentAssociation==='general_sale'?'Cash — General sale':p.paymentMethod==='cash'?'Cash — Student-linked':'Cashless / PIKAS account'}</span><small>{new Date(p.createdAt).toLocaleString('es-DO')} · {p.employeeLabel}</small></span><strong>{posMoney(p.totalMinor)}</strong></button>):<p>No hay transacciones para estos filtros.</p>}</div>
    {purchase?<><PurchaseDetail key={purchase.id} purchase={purchase} admin={admin}/><button className="btn-secondary" onClick={()=>setSelected(null)}>Cerrar detalle</button></>:null}
    <details className="card p-4"><summary className="cursor-pointer py-2 font-bold">Recargas, reembolsos y cancelaciones</summary>{state.events.filter(e=>e.organizationId==='cafeteria-demo'&&e.locationId==='principal'&&(!day||businessDay(e.createdAt)===day)&&(!cashier||e.actorId===cashier)&&`${e.id} ${e.originalPurchaseId??''} ${state.students.find(s=>s.id===e.studentId)?.preferredName??''}`.toLowerCase().includes(query.toLowerCase())).map(e=><p className="break-words border-t py-3" key={e.id}>{e.type==='refund'?'Reembolso':e.type==='void'?'Cancelación':'Recarga'} · {posMoney(e.amountMinor)} · {e.actorName} · {new Date(e.createdAt).toLocaleString('es-DO')} · {e.id}</p>)}</details>
  </section>;
}
