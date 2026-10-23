"use client";
import {useEffect,useState} from "react";

// Recovery links and Phase 6A temporary access both land here. A temporary password must be
// replaced before the workspace opens; the new password is never shown back or stored by PIKAS.
export default function Reset(){
 const [message,setMessage]=useState(""),[temporary,setTemporary]=useState(false),[pending,setPending]=useState(false);
 useEffect(()=>{queueMicrotask(()=>setTemporary(new URLSearchParams(window.location.search).get("motivo")==="temporal"));},[]);
 return <main className="grid min-h-screen place-items-center bg-slate-50 p-4"><form className="card w-full max-w-md p-7" onSubmit={async e=>{e.preventDefault();setPending(true);setMessage("");
  try{const r=await fetch("/api/auth/update-password",{method:"POST",body:new FormData(e.currentTarget)});const body=await r.json().catch(()=>({}));
   if(r.ok&&body.next){window.location.assign(body.next);return;}
   setMessage(r.ok?"Contraseña actualizada. Ya puedes iniciar sesión.":body.error==="password_change_required"?"Elige una contraseña distinta de la temporal.":body.error==="temporary_access_expired"?"Tu contraseña temporal venció (caduca a los 15 minutos). Pide una nueva al administrador de tu cafetería.":temporary?"No pudimos actualizarla. Inicia sesión de nuevo con tu contraseña temporal.":"No pudimos actualizarla. Solicita un enlace nuevo.");
  }catch{setMessage("No pudimos actualizarla. Inténtalo de nuevo.");}finally{setPending(false);}}}>
  <h1 className="text-3xl font-black">{temporary?"Elige tu contraseña":"Nueva contraseña"}</h1>
  {temporary&&<p className="mt-2 text-slate-600">Entraste con una contraseña temporal. Para continuar, crea una contraseña personal de al menos 10 caracteres.</p>}
  <label className="mt-6 block font-bold">Contraseña nueva<input className="field mt-2" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required/></label>
  <button disabled={pending} className="btn mt-5 w-full">{pending?"Guardando…":"Guardar contraseña"}</button>{message&&<p role="status" className="mt-4 rounded-xl bg-blue-50 p-3">{message}</p>}</form></main>}
