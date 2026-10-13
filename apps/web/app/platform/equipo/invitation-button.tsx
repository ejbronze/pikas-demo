'use client';
import { useRef,useState } from 'react';
export function InvitationButton({handle}:{handle:string}) {
 const [busy,setBusy]=useState(false),[link,setLink]=useState(''),[message,setMessage]=useState('');
 const [copyFeedback,setCopyFeedback]=useState<{link:string;message:string}|null>(null);
 const inFlight=useRef(false);
 async function prepare() {
  if(inFlight.current)return;
  inFlight.current=true;setBusy(true);setMessage('');setLink('');setCopyFeedback(null);
  try {
   const response=await fetch('/api/platform/team/invitation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle})});
   const result=await response.json();
   if(!response.ok){setMessage(['identity_exists','identity_unavailable'].includes(result.error)?'La identidad no puede recibir este enlace. Si ya tiene cuenta, puede iniciar sesión mediante su acceso existente; no se modificó su contraseña.':'No se pudo crear el enlace. Comprueba la configuración y el acceso preparado.');return;}
   if(result.delivery!=='link_only'||typeof result.link!=='string')throw Error('invalid');
   setLink(result.link);setMessage('Enlace creado. No se envió correo. Compártelo de forma privada con la persona destinataria. Vence en una hora o cuando vence el acceso preparado. Crear otro enlace invalida el anterior. El mismo enlace permite reintentar hasta guardar la contraseña; después queda cerrado. Entrega este enlace únicamente a la persona destinataria mediante un canal privado confiable. Cuando active su identidad, recarga esta pantalla para completar el acceso.');
  }catch{setMessage('No se pudo confirmar la creación del enlace. No se envió correo. Puedes crear otro para el mismo acceso preparado.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 async function copy() {
  const currentLink=link;
  try {await navigator.clipboard.writeText(currentLink);setCopyFeedback({link:currentLink,message:'Enlace copiado'});}
  catch {setCopyFeedback({link:currentLink,message:'No se pudo copiar. Selecciona el enlace privado y cópialo manualmente.'});}
 }
 return <div className="min-w-0 space-y-3"><button type="button" className={link?'btn-destructive':'btn'} disabled={busy} onClick={()=>{if(!link||confirm('¿Reemplazar el enlace? El enlace anterior dejará de funcionar.'))void prepare();}}>{busy?'Preparando…':link?'Reemplazar enlace':'Crear enlace de invitación'}</button>
 {message&&<p role="status">{message}</p>}{link&&<div className="min-w-0 space-y-3"><label className="block">Enlace privado de activación<input className="field mt-1 w-full" readOnly value={link} onFocus={event=>event.currentTarget.select()}/></label><button type="button" className="btn-secondary" onClick={()=>void copy()}>Copiar enlace</button>{copyFeedback?.link===link&&<p role="status">{copyFeedback.message}</p>}</div>}</div>;
}
