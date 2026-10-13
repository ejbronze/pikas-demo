'use client';
import { useEffect,useRef,useState } from 'react';
import Link from 'next/link';
export function ActivationWorkspace() {
 const [token,setToken]=useState(''),[handle,setHandle]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[message,setMessage]=useState('');
 const [passwordMismatch,setPasswordMismatch]=useState(false);
 const inFlight=useRef(false),initialized=useRef(false);
 useEffect(()=>{if(initialized.current)return;initialized.current=true;const value=new URLSearchParams(window.location.hash.slice(1)).get('token')??'';
  const saved=new URLSearchParams(window.location.search).get('invitation')??'';
  const resume=/^[0-9a-f]{32}$/.test(saved)?saved:'';
  window.history.replaceState(null,'',resume?`/activar?invitation=${resume}`:'/activar');
  queueMicrotask(()=>{setToken(value);setHandle(resume);if(!value&&!resume)setMessage('La invitación no está disponible. Solicita un nuevo enlace al administrador.');});
 },[]);
 async function send(path:string,body:unknown) {
  if(inFlight.current)return;
  inFlight.current=true;setBusy(true);setMessage('');
  try {
   const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const result=await response.json();
   if(!response.ok)throw Error(result.error==='weak_password'?'weak_password':'invalid');
   if(path.endsWith('/activate')){setHandle(result.handle);setToken('');window.history.replaceState(null,'',`/activar?invitation=${result.handle}`);}
   else {setDone(true);}
  }catch(error){setMessage(error instanceof Error&&error.message==='weak_password'?'La contraseña no cumple la política de seguridad. Elige una más fuerte.':handle?'No se pudo guardar la contraseña. Reintenta con la misma contraseña y la cuenta destinataria. Si perdiste la sesión, vuelve a abrir el enlace privado original.':'La invitación no es válida, venció o ya se utilizó. Antes de guardar contraseña, puedes volver a abrir el mismo enlace privado y reintentar. Si ya guardaste la contraseña, inicia sesión.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <main className="mx-auto w-full max-w-md space-y-5 px-4 py-12"><h1 className="text-2xl font-bold">Has sido invitado a PIKAS</h1>
 <p>Este enlace privado permite activar la identidad destinataria; no verifica por separado el acceso a su correo. El administrador deberá completar tu acceso después.</p>
 {message&&<p role="alert" className="card p-4">{message}</p>}
 {done?<section className="card space-y-3 p-5"><h2 className="font-bold">Identidad activada</h2><p>Tu contraseña está lista. Tu acceso sigue pendiente de que el administrador pulse «Completar acceso».</p><Link className="btn" href="/backoffice/login">Volver a PIKAS</Link></section>
 :handle?<form className="card space-y-4 p-5" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);if(form.get('password')!==form.get('confirmPassword')){setPasswordMismatch(true);return;}setPasswordMismatch(false);void send('/api/auth/activation-password',{handle,password:form.get('password')});}}>
 <h2 className="font-bold">Crea tu contraseña</h2><label className="block">Contraseña<input className="field mt-1 w-full" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required onChange={()=>setPasswordMismatch(false)}/></label><p className="text-sm">Usa al menos 10 caracteres.</p>
 <label className="block" htmlFor="confirm-password">Confirmar contraseña</label><input id="confirm-password" className="field w-full" name="confirmPassword" type="password" autoComplete="new-password" required aria-invalid={passwordMismatch} aria-describedby={passwordMismatch?'password-mismatch':undefined} onChange={()=>setPasswordMismatch(false)}/>
 {passwordMismatch&&<p id="password-mismatch" role="alert" className="text-sm text-red-700">Las contraseñas no coinciden. Revisa ambos campos.</p>}<button className="btn" disabled={busy}>Guardar contraseña</button></form>
 :token?<section className="card space-y-4 p-5"><p>Al continuar, este navegador usará la cuenta destinataria de la invitación. Si compartes el dispositivo, continúa en una ventana privada.</p><button className="btn" disabled={busy} onClick={()=>void send('/api/auth/activate',{token})}>{busy?'Confirmando…':'Activar mi cuenta'}</button></section>:null}
 <p><Link href="/backoffice/login" className="underline">Ya tengo cuenta</Link> · <Link href="/forgot-password" className="underline">Recuperar contraseña</Link></p>
 </main>;
}
