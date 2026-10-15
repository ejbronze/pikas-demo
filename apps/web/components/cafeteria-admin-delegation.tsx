'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {SchoolCommandForm} from './school-command-form';
import {Input} from './student-fields';
import {sessionFetch} from '../lib/auth/session-fetch';
import {delegationReadSchema,type DelegationRead} from '../lib/school/cafeteria-delegation';

export function CafeteriaAdminDelegation({actorId,schoolId,cafeteriaId}:{actorId:string;schoolId:string;cafeteriaId:string}){
 const [data,setData]=useState<DelegationRead|null>(null),[message,setMessage]=useState(''),[link,setLink]=useState(''),[busy,setBusy]=useState(false);
 const inFlight=useRef(false);
 const load=useCallback(async()=>{try{const response=await sessionFetch(`/api/school/cafeteria-administration?school=${schoolId}&cafeteria=${cafeteriaId}`);if(!response.ok){setData(null);setMessage('No se pudo confirmar el acceso de delegación. Recupera la sesión y actualiza el estado.');return;}setData(delegationReadSchema.parse(await response.json()));}catch{setData(null);setMessage('No se pudo actualizar el estado.');}},[schoolId,cafeteriaId]);
 useEffect(()=>{void load();},[load]);
 const props={actorId,schoolId,onSuccess:()=>{void load();}};
 const issue=async(invitationId:string,replacing:boolean)=>{
  if(inFlight.current||(replacing&&!window.confirm('¿Reemplazar el enlace privado? El anterior dejará de funcionar.')))return;
  inFlight.current=true;setBusy(true);setLink('');setMessage('');
  try{const response=await sessionFetch('/api/school/cafeteria-administration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitationId})});const body=await response.json();
   if(!response.ok){setMessage('No se pudo confirmar el enlace. Actualiza el estado; conserva este mismo acceso preparado.');}
   else if(body.status==='identity_ready'){setMessage('Identidad lista. Completa este acceso preparado; no se modifica su contraseña.');}
   else if(typeof body.link==='string'&&new URL(body.link).origin===window.location.origin){setLink(body.link);setMessage('Enlace privado creado. No se envió correo. Entrégalo solo al destinatario; vence en una hora o al vencer el acceso.');}
   else setMessage('Respuesta inesperada. Actualiza el estado antes de continuar.');
  }catch{setMessage('Resultado incierto. Actualiza el estado antes de generar otro enlace.');}
  finally{inFlight.current=false;setBusy(false);await load();}
 };
 return <section className="space-y-3 border-t pt-4" aria-label="Administración de cafetería"><h3 className="font-bold">Administración de cafetería</h3><p className="text-sm text-slate-600">La delegación es explícita y no concede acceso de cajero. Activar una identidad no concede permisos.</p>
 {message&&<p role="status" className="break-words text-sm">{message}</p>}
 <button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setLink('');void load();}}>Actualizar estado de administración</button>
 {data&&<>{data.administrators.map((a,index)=><p key={index} className="text-sm">{a.name} · {a.status==='active'?'Activo':a.status==='suspended'?'Suspendido':'Inactivo'}</p>)}
 {data.self_status==='active'?<Link className="btn inline-flex" href={`/admin/cafeteria?cafeteria=${cafeteriaId}`}>Entrar a administración de cafetería</Link>:data.self_status?<p>Tu acceso está suspendido o inactivo. No se reactiva desde esta acción.</p> : null}
 <SchoolCommandForm {...props} submitVisible={data.self_status===null} formId={`cafeteria-self:${cafeteriaId}`} operation="cafeteria_admin_self" label="Asignarme como administrador de esta cafetería" confirmation="¿Concederte administración explícita exclusivamente de esta cafetería? No incluye permisos de cajero." makePayload={()=>({cafeteria_id:cafeteriaId})}/>
 <details><summary className="cursor-pointer font-semibold">Invitar administrador de cafetería</summary><div className="mt-3"><SchoolCommandForm {...props} formId={`cafeteria-prepare:${cafeteriaId}`} operation="cafeteria_admin_prepare" label="Preparar acceso de cafetería" makePayload={d=>({cafeteria_id:cafeteriaId,email:String(d.get('email')??'').trim()})}><Input label="Correo del administrador de cafetería" name="email" type="email" maxLength={254}/></SchoolCommandForm></div></details>
 {data.invitations.map(i=><article key={i.id} className="space-y-3 rounded-xl border p-3"><p className="break-all font-semibold">{i.email}</p><p className="text-sm">{i.status==='accepted'?'Acceso completado':i.status==='expired'?'Acceso vencido':i.status==='pending'?'Acceso preparado':'Acceso revocado'} · {i.identity==='ready'?'Identidad lista':i.identity==='activation_pending'?'Activación pendiente':i.identity==='missing'?'Identidad sin activar':'Identidad no disponible'}</p>
 {i.status==='pending'&&<>{['missing','activation_pending'].includes(i.identity)&&<button className="btn-secondary" type="button" disabled={busy} onClick={()=>void issue(i.id,i.link_state==='active')}>{i.link_state==='active'?'Reemplazar enlace de activación':'Generar enlace de activación'}</button>}
 </>}
 <SchoolCommandForm {...props} formId={`cafeteria-complete:${i.id}`} operation="cafeteria_admin_complete" label="Completar acceso de cafetería" confirmation="¿Conceder administración exclusivamente de esta cafetería a la identidad confirmada?" submitVisible={i.status==='pending'&&i.identity==='ready'} makePayload={d=>({cafeteria_id:cafeteriaId,invitation_id:i.id,display_name:String(d.get('display_name')??'').trim()})}><Input label="Nombre del administrador de cafetería" name="display_name" maxLength={200}/></SchoolCommandForm>
 </article>)}
 </>}
 {link&&<div className="space-y-2"><label className="block text-sm font-bold">Enlace privado de activación<input readOnly className="field w-full" value={link}/></label><button type="button" className="btn-secondary" onClick={async()=>{try{await navigator.clipboard.writeText(link);setMessage('Enlace copiado. Compártelo por un canal privado confiable.');}catch{setMessage('No se pudo copiar. Selecciona el enlace y cópialo manualmente.');}}}>Copiar enlace</button><p className="text-xs">El enlace no se guarda y desaparece al recargar. Reemplazarlo invalida el anterior.</p></div>}
 </section>;
}
