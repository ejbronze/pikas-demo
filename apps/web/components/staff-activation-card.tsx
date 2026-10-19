'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {sessionFetch} from '../lib/auth/session-fetch';
import {staffActivationStatusSchema,type StaffActivationStatus} from '../lib/cafeteria/staff-activation';
import {useCafeteriaMutation} from './connected-cafeteria-provider';
import {ConfirmAction} from './confirm-action';
export function StaffActivationCard({invitationId,pending,sandbox}:{invitationId:string;pending:boolean;sandbox:boolean}){
 const execute=useCafeteriaMutation(),[state,setState]=useState<StaffActivationStatus|null>(null),[link,setLink]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),inFlight=useRef(false),form=useRef<HTMLFormElement>(null);
 const refresh=useCallback(async()=>{try{const r=await sessionFetch(`/api/cafeteria/staff-activation?invitation=${invitationId}`);if(!r.ok){setState(null);setLink('');setMessage('No se pudo confirmar la activación con la sesión o los permisos actuales. Recupera el acceso y actualiza el estado.');return;}setState(staffActivationStatusSchema.parse(await r.json()));}catch{setState(null);setMessage('No se pudo actualizar el estado de activación.');}},[invitationId]);
 useEffect(()=>{if(!sandbox)void refresh();},[refresh,sandbox]);
 async function issue(){
  if(inFlight.current)return;
  if(state?.link_state==='active'&&!window.confirm('¿Reemplazar el enlace privado? El anterior dejará de funcionar.'))return;
  inFlight.current=true;setBusy(true);setLink('');setMessage('');
  try{const r=await sessionFetch('/api/cafeteria/staff-activation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitationId})});const body=await r.json();
   if(!r.ok)setMessage('No se pudo confirmar la emisión. Actualiza el estado y reemplaza explícitamente el enlace si se perdió; conserva este mismo acceso preparado.');
   else if(body.status==='identity_ready')setMessage('Identidad lista. No se cambia su contraseña; confirma el mismo acceso preparado.');
   else if(typeof body.link==='string'&&new URL(body.link).origin===window.location.origin){setLink(body.link);setMessage('Enlace privado creado. No se envió correo. Entrégalo solo al destinatario; vence en una hora o al vencer el acceso preparado.');}
   else setMessage('Respuesta inesperada. Actualiza el estado antes de continuar.');
  }catch{setMessage('Resultado incierto. Actualiza el estado y reemplaza explícitamente el enlace si se perdió. No prepares otro acceso.');}
  finally{inFlight.current=false;setBusy(false);await refresh();}
 }
 if(sandbox)return <p className="text-sm">La emisión de activaciones no está disponible en la experiencia sandbox.</p>;
 return <div className="space-y-3"><p className="text-sm">{!pending?'Este acceso ya no está pendiente de activación.':state?.identity_state==='ready'?'Identidad lista: confirma el acceso POS.':state?.identity_state==='activation_pending'?'Activación pendiente: el destinatario debe guardar su contraseña.':state?.identity_state==='missing'?'Identidad sin activar.':state?'Identidad no disponible para este acceso.':'Verificando activación…'}</p>
 {message&&<p role="status" className="break-words text-sm">{message}</p>}
 <button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setLink('');void refresh();}}>Actualizar estado de activación</button>
 {pending&&state&&['missing','activation_pending'].includes(state.identity_state)&&<button type="button" className="btn-secondary" disabled={busy} onClick={()=>void issue()}>{state.link_state==='active'?'Reemplazar enlace de activación':'Generar enlace de activación'}</button>}
 {pending&&link&&<div className="space-y-2"><label className="block font-bold">Enlace privado de activación<input readOnly className="field w-full" value={link}/></label><button type="button" className="btn-secondary" onClick={async()=>{try{await navigator.clipboard.writeText(link);setMessage('Enlace copiado. Compártelo por un canal privado confiable.');}catch{setMessage('No se pudo copiar. Selecciona el enlace y cópialo manualmente.');}}}>Copiar enlace</button><p className="text-xs">El enlace no se guarda y desaparece al recargar. Reemplazarlo invalida el anterior.</p></div>}
 {pending&&state?.identity_state==='ready'&&<form ref={form} className="space-y-3" onSubmit={e=>e.preventDefault()}><label className="block font-bold">Nombre completo<input className="field mt-1" required name="display_name" maxLength={200}/></label><ConfirmAction label="Confirmar identidad y conceder acceso POS" question="¿Conceder acceso operativo exclusivamente a esta cafetería?" before={()=>!!form.current?.reportValidity()} onConfirm={()=>void execute('staff_complete',{invitation_id:invitationId,display_name:String(new FormData(form.current!).get('display_name')??'').trim()})}/></form>}
 </div>;
}
