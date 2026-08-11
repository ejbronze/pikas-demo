"use client";

import Link from "next/link";
import {useState} from "react";
import {BrandLogo} from "@/components/brand-logo";
import {Eye, EyeOff} from "@/components/icons";

type LoginRole = "parent" | "student" | "pos";
const accounts = {parent:{label:"Familia",identifier:"familia@demo.pikas.do",credential:"Contraseña"},student:{label:"Estudiante",identifier:"PK-10982",credential:"PIN"},pos:{label:"Cafetería",identifier:"cafeteria@demo.pikas.do",credential:"Contraseña"}} as const;

export default function Login() {
  const [role, setRole] = useState<LoginRole>("parent");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const account = accounts[role];
  const student = role === "student";
  return <main className="grid min-h-screen bg-pikas-navy lg:grid-cols-2">
    <section className="hidden items-end bg-[radial-gradient(circle_at_top_left,#04c7c5,#03234b_62%)] p-12 text-white lg:flex">
      <div><span className="inline-flex rounded-2xl bg-white p-2"><BrandLogo compact className="size-14"/></span><h1 className="mt-8 max-w-lg text-5xl font-black">Una entrada para toda tu comunidad escolar.</h1><p className="mt-5 max-w-md text-blue-100">Familias, estudiantes y personal de cafetería llegan al espacio correcto según su rol.</p></div>
    </section>
    <section className="grid place-items-center bg-slate-50 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl sm:p-8">
      <Link href="/" className="inline-flex min-h-11 items-center" aria-label="Volver al inicio"><BrandLogo className="h-auto w-32"/></Link>
      <h1 className="mt-6 text-3xl font-black">Iniciar sesión</h1><p className="mt-2 text-slate-600">Elige cómo quieres entrar.</p>
      <div className="mt-6 grid grid-cols-3 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Tipo de usuario">{(Object.keys(accounts) as LoginRole[]).map(value=><button type="button" role="tab" aria-selected={role===value} onClick={()=>setRole(value)} className={`min-h-11 rounded-lg text-sm font-bold ${role===value?"bg-white shadow":""}`} key={value}>{accounts[value].label}</button>)}</div>
      <form action="/api/auth/login" method="post" onSubmit={()=>setPending(true)} className="mt-6 space-y-4"><input type="hidden" name="role" value={role}/><label className="block"><span className="font-bold">{student?"Código estudiantil":"Correo electrónico"}</span><input key={role} className="field mt-2" name="identifier" autoComplete={student?"username":"email"} type={student?"text":"email"} defaultValue={account.identifier} required/></label><label className="block"><span className="font-bold">{account.credential}</span><span className="relative mt-2 block"><input className="field pr-12" name="password" type={show?"text":"password"} autoComplete="current-password" defaultValue="pikas-demo" required minLength={4}/><button type="button" onClick={()=>setShow(!show)} className="absolute inset-y-0 right-0 grid w-12 place-items-center" aria-label={show?"Ocultar contraseña":"Mostrar contraseña"}>{show?<EyeOff size={20}/>:<Eye size={20}/>}</button></span></label><button disabled={pending} className="btn w-full">{pending?"Entrando…":`Entrar como ${account.label.toLowerCase()}`}</button></form>
      {!student&&<Link href="/forgot-password" className="mt-5 block text-center font-bold text-blue-700">¿Olvidaste tu contraseña?</Link>}<p className="mt-6 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Acceso de demostración con datos ficticios. No se mueve dinero real.</p>
    </div></section>
  </main>;
}
