"use client";

import {useEffect,useState} from "react";
import type {PosCartLine,PosMenuItemRecord,PosPurchaseRecord} from "@pikas/data-access";
import {BrandLogo} from "./brand-logo";
import {ProductImage} from "./product-image";
import {LogOut,ReceiptText,Search,ShieldCheck,Utensils} from "./icons";
import {useDemo} from "./demo-provider";

const money=(minor:number)=>new Intl.NumberFormat("es-DO",{style:"currency",currency:"DOP"}).format(minor/100);
const date=(value:string)=>new Intl.DateTimeFormat("es-DO",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));
const cartKey="pikas:pos-cart:v1";

function restrictionFor(item:PosMenuItemRecord,allergies:string[],blockedIds:string[],blockedNames:string[]){
  if(!item.available)return "No disponible en este momento.";
  const allergy=item.allergens.find(value=>allergies.some(student=>student.toLowerCase()===value.toLowerCase()));
  if(allergy)return `No permitido: contiene ${allergy}, una alergia registrada.`;
  if(blockedIds.includes(item.id)||blockedNames.some(value=>value.toLowerCase()===item.name.toLowerCase()))return "No permitido: producto bloqueado por la familia.";
  return null;
}

export function PosDashboard({demo}:{demo:boolean}){
  const {state,lookupStudentForPos,checkoutPos}=useDemo();
  const [mode,setMode]=useState<"student_wallet"|"cash">("student_wallet");
  const [code,setCode]=useState("");
  const [studentId,setStudentId]=useState<string|null>(null);
  const [lookupError,setLookupError]=useState("");
  const [cart,setCart]=useState<PosCartLine[]>([]);
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("Todos");
  const [notice,setNotice]=useState("");
  const [selected,setSelected]=useState<PosPurchaseRecord|null>(null);
  const [ready,setReady]=useState(false);
  useEffect(()=>{setReady(true);try{const saved=localStorage.getItem(cartKey);if(saved){const parsed=JSON.parse(saved) as {cart:PosCartLine[];mode:"student_wallet"|"cash"};setCart(parsed.cart);setMode(parsed.mode)}}catch{}},[]);
  useEffect(()=>{if(ready)localStorage.setItem(cartKey,JSON.stringify({cart,mode}))},[cart,mode,ready]);

  if(!demo)return <main className="min-h-screen bg-slate-100 p-5"><section className="mx-auto mt-12 max-w-2xl card p-7"><h1 className="text-3xl font-black">POS Supabase en integración</h1><p className="mt-3 text-slate-600">El menú compartido está activo; checkout remoto requiere completar la validación del entorno de desarrollo.</p><Logout/></section></main>;
  const operator=state.administration.users.find(item=>item.id==="pos-1");
  const partnership=state.administration.partnerships.find(item=>item.id==="partner-active");
  if(operator?.status!=="active")return <main className="min-h-screen bg-slate-100 p-5"><section className="mx-auto mt-12 max-w-2xl card p-7"><h1 className="text-3xl font-black">Acceso de caja suspendido</h1><p className="mt-3">Un administrador debe reactivar esta cuenta.</p><Logout/></section></main>;

  const student=state.students.find(item=>item.id===studentId)??null;
  const categories=["Todos",...new Set(state.menuItems.map(item=>item.category))];
  const menu=state.menuItems.filter(item=>(category==="Todos"||item.category===category)&&item.name.toLowerCase().includes(query.toLowerCase()));
  const total=cart.reduce((sum,line)=>sum+(state.menuItems.find(item=>item.id===line.itemId)?.priceMinor??0)*line.quantity,0);
  const history=state.purchases;
  const canShop=mode==="cash"||Boolean(student);
  const setQuantity=(id:string,quantity:number)=>setCart(current=>quantity<=0?current.filter(line=>line.itemId!==id):current.map(line=>line.itemId===id?{...line,quantity}:line));
  const add=(id:string)=>setCart(current=>{const line=current.find(item=>item.itemId===id);return line?current.map(item=>item.itemId===id?{...item,quantity:item.quantity+1}:item):[...current,{itemId:id,quantity:1}]});
  const verify=()=>{const result=lookupStudentForPos(code);if(!result.ok){setStudentId(null);setLookupError("No encontramos un estudiante activo con ese código.");return}setStudentId(result.student.id);setLookupError("")};
  const complete=()=>{const result=checkoutPos(mode==="cash"?null:student?.id??null,cart,crypto.randomUUID(),mode);if(!result.ok){setNotice(result.message);return}setCart([]);setNotice(`${mode==="cash"?"Venta en efectivo":"Compra con cuenta estudiantil"} completada: ${money(result.purchase.totalMinor)}.`)};

  return <main className="min-h-screen overflow-x-hidden bg-slate-100 pb-10">
    <header className="flex flex-wrap items-center justify-between gap-3 bg-pikas-navy px-4 py-4 text-white md:px-8"><div className="flex items-center gap-3"><span className="rounded-xl bg-white p-1"><BrandLogo compact className="size-9"/></span><div><strong className="text-xl">PIKAS Cafetería</strong><p className="text-xs text-slate-300">Instituto Nueva Generación · Caja 1</p></div></div><Logout/></header>
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <section className={`rounded-2xl border p-4 ${partnership?.status==="active"?"border-emerald-300 bg-emerald-50":"border-red-300 bg-red-50"}`}><ShieldCheck className="mr-2 inline"/><strong>Conexión Escuela–Cafetería: {partnership?.status==="active"?"Activa":"Bloqueada"}</strong><p className="mt-1 text-sm">La verificación y el checkout requieren una asociación activa.</p></section>
      <section className="card p-5"><span className="label">Paso 1</span><h1 className="mt-2 text-2xl font-black">Forma de cobro</h1><div className="mt-4 grid gap-3 sm:grid-cols-2"><button aria-pressed={mode==="student_wallet"} className={`btn-secondary min-h-16 ${mode==="student_wallet"?"ring-2 ring-teal-500":""}`} onClick={()=>{setMode("student_wallet");setStudentId(null)}}>Código estudiantil / NFC</button><button aria-pressed={mode==="cash"} className={`btn-secondary min-h-16 ${mode==="cash"?"ring-2 ring-teal-500":""}`} onClick={()=>{setMode("cash");setStudentId(null);setLookupError("")}}>Venta en efectivo</button></div>
        {mode==="student_wallet"&&!student?<div className="mt-4 max-w-xl"><label className="font-bold" htmlFor="student-code">Código estudiantil</label><div className="relative mt-2"><Search className="absolute left-4 top-3.5 text-slate-400"/><input id="student-code" className="field pl-12 uppercase" value={code} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="PK-10982"/></div><button className="btn mt-3" onClick={verify}>Comprobar estudiante</button>{lookupError?<p id="lookup-error" role="alert" className="mt-3 rounded-xl bg-red-50 p-3 font-bold text-red-900">{lookupError}</p>:null}</div>:null}
        {student?<div className="mt-4 rounded-2xl bg-blue-50 p-4"><h2 className="text-xl font-black">{student.preferredName}</h2><p>{student.grade} · Saldo {money(student.balance*100)}</p><div className="mt-2 flex flex-wrap gap-2">{student.allergies.map(value=><span className="chip bg-red-100" key={value}>Alergia: {value}</span>)}{student.blocked.map(value=><span className="chip bg-amber-100" key={value}>Bloqueado: {value}</span>)}</div></div>:mode==="cash"?<p className="mt-4 rounded-xl bg-amber-50 p-3 font-bold">Efectivo seleccionado: no se consultará ni afectará una billetera estudiantil.</p>:null}
      </section>
      {canShop?<div className="grid gap-5 lg:grid-cols-[1.5fr_.8fr]"><section className="card p-5"><span className="label">Paso 2</span><h2 className="mt-2 text-2xl font-black">Productos</h2><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><input className="field" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar producto"/><div className="flex max-w-full gap-2 overflow-auto pb-1">{categories.map(value=><button className={`chip min-h-11 whitespace-nowrap ${category===value?"bg-slate-950 text-white":""}`} onClick={()=>setCategory(value)} key={value}>{value}</button>)}</div></div><div className="mt-4 grid gap-4 sm:grid-cols-2">{menu.map(item=>{const restriction=mode==="cash"?!item.available?"No disponible en este momento.":null:restrictionFor(item,student?.allergies??[],student?.blockedProductIds??[],student?.blocked??[]);return <article className="overflow-hidden rounded-2xl border bg-white" key={item.id}><ProductImage src={item.imageUrl} name={item.name}/><div className="p-4"><div className="flex justify-between gap-3"><div><h3 className="font-black">{item.name}</h3><p className="text-sm text-slate-500">{item.category} · {item.description}</p></div><strong>{money(item.priceMinor)}</strong></div><p className="mt-2 text-xs">Ingredientes: {item.ingredients.join(", ")||"No especificados"}</p>{restriction?<p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold">{restriction}</p>:null}<button disabled={Boolean(restriction)} className="btn mt-3 w-full" onClick={()=>add(item.id)}>Añadir al carrito</button></div></article>})}</div>{menu.length===0?<p className="mt-4 rounded-xl bg-slate-50 p-5 text-center">No hay productos para este filtro.</p>:null}</section>
        <aside className="card h-fit p-5"><span className="label">Paso 3</span><h2 className="mt-2 text-2xl font-black">Carrito persistente</h2>{cart.length===0?<div className="mt-4 rounded-xl bg-slate-50 p-6 text-center"><Utensils className="mx-auto"/><p className="mt-2">El carrito está vacío.</p></div>:<div className="mt-3 divide-y">{cart.map(line=>{const item=state.menuItems.find(value=>value.id===line.itemId);return item?<div className="py-3" key={line.itemId}><div className="flex justify-between"><strong>{item.name}</strong><strong>{money(item.priceMinor*line.quantity)}</strong></div><div className="mt-2 flex items-center gap-2"><button className="btn-secondary min-w-11" onClick={()=>setQuantity(item.id,line.quantity-1)}>−</button><span className="font-black">{line.quantity}</span><button className="btn-secondary min-w-11" onClick={()=>setQuantity(item.id,line.quantity+1)}>+</button></div></div>:null})}<div className="flex justify-between py-4 text-xl font-black"><span>Total</span><span>{money(total)}</span></div><button className="btn w-full" onClick={complete}>Completar {mode==="cash"?"venta en efectivo":"compra"}</button></div>}</aside></div>:null}
      {notice?<section role="status" className="rounded-2xl bg-emerald-50 p-4 text-emerald-900"><h2 className="text-xl font-black">Compra completada</h2><p className="font-bold">{notice}</p></section>:null}
      <section className="card p-5"><h2 className="text-2xl font-black">Historial POS</h2>{history.length===0?<div className="mt-4 rounded-xl bg-slate-50 p-6 text-center"><ReceiptText className="mx-auto"/><p>Aún no hay transacciones.</p></div>:<div className="mt-3 divide-y">{history.map(purchase=><button className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left" onClick={()=>setSelected(purchase)} key={purchase.id}><div><strong>{purchase.studentName}</strong><p className="text-sm text-slate-500">{purchase.items.map(item=>`${item.quantity}× ${item.name}`).join(", ")} · {purchase.paymentMethod==="cash"?"Efectivo":"Cuenta estudiantil"} · {date(purchase.createdAt)}</p></div><strong>{money(purchase.totalMinor)}</strong></button>)}</div>}</section>
    </div>
    {selected?<div className="fixed inset-0 z-50 grid place-items-end bg-slate-950/60 p-0 sm:place-items-center sm:p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-t-3xl bg-white p-6 sm:rounded-3xl"><h2 className="text-2xl font-black">Detalle de transacción</h2><p className="mt-2">{selected.paymentMethod==="cash"?"Efectivo":"Cuenta estudiantil"} · {selected.studentName}</p><ul className="mt-3 divide-y">{selected.items.map(item=><li className="flex justify-between py-3" key={item.itemId}><span>{item.quantity}× {item.name}</span><strong>{money(item.unitPriceMinor*item.quantity)}</strong></li>)}</ul><button className="btn mt-4 w-full" onClick={()=>setSelected(null)}>Cerrar detalle</button></div></div>:null}
  </main>;
}

function Logout(){return <form action="/api/auth/logout" method="post"><button className="btn mt-4"><LogOut size={18}/>Salir</button></form>}
