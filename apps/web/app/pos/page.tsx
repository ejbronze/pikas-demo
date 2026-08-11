"use client";
import {useEffect,useState} from "react";
import {Search,ShieldCheck,LogOut} from "@/components/icons";
export default function Page(){
  const [checked,setChecked]=useState(false),[ready,setReady]=useState(false);
  useEffect(()=>setReady(true),[]);
  return <main className="min-h-screen bg-slate-100">
    <header className="flex items-center justify-between bg-slate-950 px-5 py-4 text-white"><div><strong className="text-xl">PIKAS Cafetería</strong><p className="text-xs text-slate-400">Instituto Nueva Generación · Caja 1</p></div><form action="/api/auth/logout" method="post"><button className="flex min-h-11 items-center gap-2 rounded-xl px-3 font-bold hover:bg-white/10"><LogOut size={18}/>Salir</button></form></header>
    <div className="mx-auto grid max-w-5xl gap-6 p-5 lg:grid-cols-[1.2fr_1fr]"><section className="card p-6"><span className="chip bg-emerald-50 text-emerald-800">Sesión POS activa</span><h1 className="mt-4 text-3xl font-black">Validar estudiante</h1><p className="mt-2 text-slate-600">Escanea el QR o introduce un código de demostración. Solo se muestra la información mínima para atender la compra.</p>
      <form className="mt-6" onSubmit={event=>{event.preventDefault();setChecked(true)}}><label className="font-bold">Código estudiantil<div className="relative mt-2"><Search className="absolute left-4 top-3.5 text-slate-400" size={20}/><input name="studentCode" className="field pl-12" placeholder="Ej. PK-10982" required/></div></label><button disabled={!ready} className="btn mt-4 w-full bg-slate-900 hover:bg-slate-800">{ready?"Comprobar elegibilidad":"Preparando lector…"}</button></form>
      {checked&&<div role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex gap-3"><ShieldCheck className="text-emerald-700"/><div><h2 className="font-black text-emerald-900">Estudiante elegible</h2><p className="text-sm text-emerald-800">Sofi · Saldo suficiente para validar una compra. Las restricciones se comprobarán al añadir productos.</p></div></div></div>}
    </section><aside className="card p-6"><span className="label">Acceso limitado</span><h2 className="mt-3 text-xl font-black">Lo que puede ver cafetería</h2><ul className="mt-4 space-y-3 text-sm text-slate-600"><li>• Nombre preferido y foto.</li><li>• Resultado de elegibilidad.</li><li>• Alertas necesarias para el producto actual.</li></ul><p className="mt-6 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">No puede ver datos familiares, cambiar límites ni editar el historial financiero.</p></aside></div>
  </main>
}
