'use client';
import { useEffect,useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import { teamCommandSchema,type TeamCommand,type TeamRead } from '../../../lib/platform/team-contracts';
import { restoreTeam,prepareTeam,confirmTeam,teamJournalKey,type TeamPending } from '../../../lib/platform/team-journal';
import { InvitationButton } from './invitation-button';
const labels:Record<string,string>={active:'Activo',suspended:'Suspendido',inactive:'Inactivo',none:'Sin acceso',pending:'Identidad pendiente',completed:'Acceso completado',expired:'Preparación vencida'};
export function TeamWorkspace({data}:{data:TeamRead}) {
 const router=useRouter(),storageKey=teamJournalKey(data.actor_handle);
 const [ready,setReady]=useState(false),[pending,setPending]=useState<TeamPending|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [draft,setDraft]=useState<{name:string;email:string;demo:boolean}|null>(null);
 const inFlight=useRef(false);
 const waitingForPassword=(command:TeamCommand)=>command.operation==='complete'&&data.prepared.some(intent=>intent.handle===command.payload.handle&&intent.status==='pending'&&!intent.identity_ready);
 useEffect(()=>{let alive=true;queueMicrotask(()=>{if(!alive)return;try{const saved=restoreTeam(sessionStorage,storageKey);setPending(saved);setReady(true);if(saved)setMessage('Solicitud pendiente. Confirma la misma solicitud antes de continuar.');}catch{setMessage('No se puede recuperar la solicitud. Las operaciones permanecen bloqueadas.');}});return()=>{alive=false;};},[storageKey]);
 async function execute(command:TeamCommand) {
  if(!ready||inFlight.current||waitingForPassword(command))return;
  inFlight.current=true;setBusy(true);
  try {
   const request=pending??prepareTeam(sessionStorage,storageKey,command);setPending(request);
   await confirmTeam(sessionStorage,storageKey,request);
   setPending(null);setDraft(null);setMessage(request.command.operation==='prepare'?'Acceso preparado. No se envió correo ni se concedió autoridad.':'Cambio confirmado.');router.refresh();
  }catch{setMessage('La solicitud sigue sin confirmar. Conservamos su clave y datos. Comprueba el acceso y la identidad activada; reintenta la misma solicitud.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <>
 <header><h1 className="text-2xl font-bold">Equipo de PIKAS</h1><p className="mt-2 text-slate-600">Operadores internos de plataforma. Cada persona utiliza su propia cuenta.</p></header>
 {message&&<p role="status" className="card p-4">{message}</p>}
 {pending&&<button className="btn" disabled={!ready||busy||waitingForPassword(pending.command)} onClick={()=>void execute(pending.command)}>{waitingForPassword(pending.command)?'Esperando activación y contraseña':busy?'Confirmando…':'Confirmar solicitud pendiente'}</button>}
 <fieldset className="min-w-0 space-y-6 border-0 p-0" disabled={!ready||busy||pending!==null}>
 <section className="card space-y-4 p-5"><h2 className="text-lg font-bold">Añadir persona</h2>
 {!draft?<form className="space-y-3" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);const parsed=teamCommandSchema.safeParse({operation:'prepare',payload:{name:form.get('name'),email:form.get('email'),demo:form.has('demo')}});if(parsed.success&&parsed.data.operation==='prepare'){setDraft(parsed.data.payload);setMessage('');}else setMessage('Revisa el nombre y correo.');}}>
 <label className="block font-semibold">Nombre<input className="field mt-1 w-full" name="name" required maxLength={200}/></label>
 <label className="block font-semibold">Correo<input className="field mt-1 w-full" name="email" type="email" required maxLength={254}/></label>
 <p><strong>Acceso de plataforma:</strong> Administrador de plataforma</p>
 <label className="flex min-h-11 items-center gap-3"><input name="demo" type="checkbox"/>Acceso al entorno de demostración</label>
 <button className="btn">Revisar acceso</button></form>:<div className="space-y-3"><p>{draft.name} · {draft.email}</p><p>Administrador de plataforma · Demostración: {draft.demo?'Sí':'No'}</p><p>Preparar no concede acceso. La persona usará un enlace privado para activar su identidad y elegir contraseña. No se enviará correo.</p><button className="btn" onClick={()=>void execute({operation:'prepare',payload:draft})}>Preparar acceso</button><button className="btn-secondary ml-3" onClick={()=>setDraft(null)}>Volver</button></div>}
 </section>
 <section className="space-y-3"><h2 className="text-lg font-bold">Operadores</h2>
 {data.operators.map(operator=><article className="card space-y-3 p-5" key={operator.handle}><h3 className="font-bold">{operator.name}</h3><p className="break-all">{operator.email??'Correo no disponible'}</p><p>Plataforma: {labels[operator.admin_status]} · Persona: {labels[operator.person_status]}</p><p>Demostración: {operator.demo?'Habilitada':'Sin acceso'}</p><button className="btn-secondary" disabled={!operator.demo&&(operator.admin_status!=='active'||operator.person_status!=='active')} onClick={()=>{if(confirm(operator.demo?'¿Retirar únicamente el acceso de demostración?':'¿Habilitar el acceso al entorno de demostración compartido?'))void execute({operation:'demo',payload:{handle:operator.handle,enabled:!operator.demo}});}}>{operator.demo?'Deshabilitar demostración':'Habilitar demostración'}</button></article>)}
 </section>
 <section className="space-y-3"><h2 className="text-lg font-bold">Accesos preparados</h2>{data.prepared.map(intent=><article className="card space-y-3 p-5" key={intent.handle}><h3 className="font-bold">{intent.name}</h3><p className="break-all">{intent.email}</p><p>{intent.status==='pending'&&intent.identity_ready?'Identidad activada; acceso pendiente de completar':labels[intent.status]} · Administrador de plataforma · Demostración: {intent.demo?'Sí':'No'}</p>{intent.status==='pending'&&<InvitationButton handle={intent.handle}/>} {intent.status==='pending'&&<button className="btn" disabled={!intent.identity_ready} onClick={()=>{if(confirm('¿Completar acceso para la identidad activada?'))void execute({operation:'complete',payload:{handle:intent.handle}});}}>Completar acceso</button>}</article>)}{!data.prepared.length&&<p>No hay accesos preparados.</p>}</section>
 </fieldset>
 {pending?.command.operation==='complete'&&!busy&&<section className="card space-y-3 p-5"><p>Puedes crear la invitación para esta identidad pendiente y después confirmar la misma solicitud de acceso.</p><InvitationButton handle={pending.command.payload.handle}/></section>}
 <p className="text-sm text-slate-600">La demostración usa el mismo Colegio Horizonte mediante el lanzador existente; no concede membresías de cliente ni de cajero. La desactivación del administrador de plataforma aún no está disponible.</p>
 </>;
}
