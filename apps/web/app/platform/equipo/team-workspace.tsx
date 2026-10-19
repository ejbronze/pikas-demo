'use client';
import { useEffect,useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import { teamCommandSchema,type TeamCommand,type TeamRead } from '../../../lib/platform/team-contracts';
import { restoreTeam,prepareTeam,confirmTeam,teamJournalKey,type TeamPending } from '../../../lib/platform/team-journal';
import { InvitationButton } from './invitation-button';
import { AdminStatus } from '../../../components/admin-interactions';
import { AppPageHeader } from '../../../components/app-page-header';
import { ConfirmAction } from '../../../components/confirm-action';
import { CommandTask, type CommandResult } from '../../../components/command-task';
import { TaskSummary } from '../../../components/task-window';
const labels:Record<string,string>={active:'Activo',suspended:'Suspendido',inactive:'Inactivo',none:'Sin acceso',pending:'Activación pendiente',completed:'Acceso completado',expired:'Preparación vencida'};
export function TeamWorkspace({data}:{data:TeamRead}) {
 const router=useRouter(),storageKey=teamJournalKey(data.actor_handle);
 const [ready,setReady]=useState(false),[pending,setPending]=useState<TeamPending|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [adding,setAdding]=useState(0);
 const inFlight=useRef(false);
 const waitingForPassword=(command:TeamCommand)=>command.operation==='complete'&&data.prepared.some(intent=>intent.handle===command.payload.handle&&intent.status==='pending'&&!intent.identity_ready);
 useEffect(()=>{let alive=true;queueMicrotask(()=>{if(!alive)return;try{const saved=restoreTeam(sessionStorage,storageKey);setPending(saved);setReady(true);if(saved)setMessage('Solicitud pendiente. Confirma la misma solicitud antes de continuar.');}catch{setMessage('No se puede recuperar la solicitud. Las operaciones permanecen bloqueadas.');}});return()=>{alive=false;};},[storageKey]);
 async function execute(command:TeamCommand):Promise<boolean> {
  if(!ready||inFlight.current||waitingForPassword(command))return false;
  inFlight.current=true;setBusy(true);
  try {
   const request=pending??prepareTeam(sessionStorage,storageKey,command);setPending(request);
   await confirmTeam(sessionStorage,storageKey,request);
   setPending(null);setMessage(request.command.operation==='prepare'?'Acceso preparado. No se envió correo ni se concedió autoridad.':'Cambio confirmado.');router.refresh();return true;
  }catch{setMessage('La solicitud sigue sin confirmar. Conservamos su clave y datos. Comprueba el acceso y la identidad activada; reintenta la misma solicitud.');return false;}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <>
 <AppPageHeader title="Equipo" description="Operadores internos de PIKAS. Cada persona utiliza su propia cuenta." />
 {message&&<p role="status" className="card p-4">{message}</p>}
 {pending&&<button className="btn" disabled={!ready||busy||waitingForPassword(pending.command)} onClick={()=>void execute(pending.command)}>{waitingForPassword(pending.command)?'Esperando activación y contraseña':busy?'Confirmando…':'Confirmar solicitud pendiente'}</button>}
 <fieldset className="min-w-0 space-y-6 border-0 p-0" disabled={!ready||busy||pending!==null}>
 <section className="card space-y-3 p-5"><h2 className="text-lg font-bold">Añadir persona</h2><p className="text-sm text-slate-600">Prepara acceso de administrador de plataforma. Preparar no concede acceso ni envía correo.</p>
 <button type="button" className="btn" onClick={()=>{setMessage('');setAdding(n=>n+1);}}>Añadir persona</button>
 {adding>0&&<TeamPrepareTask key={adding} onClose={()=>setAdding(0)} submit={async command=>await execute(command)?{kind:'success'}:{kind:'uncertain',message:'La solicitud sigue sin confirmar. Conservamos su clave y datos; reintenta la misma solicitud.'}}/>}
 </section>
 <section className="space-y-3"><h2 className="text-lg font-bold">Operadores</h2>
 {data.operators.map(operator=><article className="card space-y-3 p-5" key={operator.handle}><h3 className="font-bold">{operator.name}</h3><p className="break-all">{operator.email??'Correo no disponible'}</p><p>Plataforma: {labels[operator.admin_status]} · Persona: {labels[operator.person_status]}</p><p>Demostración: {operator.demo?'Habilitada':'Sin acceso'}</p><ConfirmAction className="btn-secondary" disabled={!operator.demo&&(operator.admin_status!=='active'||operator.person_status!=='active')} question={operator.demo?'¿Retirar únicamente el acceso de demostración?':'¿Habilitar el acceso al entorno de demostración compartido?'} label={operator.demo?'Deshabilitar demostración':'Habilitar demostración'} onConfirm={()=>void execute({operation:'demo',payload:{handle:operator.handle,enabled:!operator.demo}})}/></article>)}
 </section>
 <section className="space-y-3"><h2 className="text-lg font-bold">Accesos preparados</h2>{data.prepared.map(intent=><article className="card space-y-3 p-5" key={intent.handle}><h3 className="font-bold">{intent.name}</h3><p className="break-all">{intent.email}</p><div className="flex flex-wrap gap-2">{intent.status==='pending'&&<AdminStatus label="Acceso preparado"/>}<AdminStatus label={intent.status==='pending'&&intent.identity_ready?'Listo para completar':labels[intent.status]}/></div><p>Administrador de plataforma · Demostración: {intent.demo?'Sí':'No'}</p>{intent.status==='pending'&&<p className="text-sm text-slate-600">{intent.identity_ready?'La identidad está activada. Completar acceso es el paso que concede el acceso preparado.':'La persona debe activar su identidad y guardar su contraseña. Preparar o crear el enlace no concede acceso.'}</p>}{intent.status==='pending'&&<InvitationButton handle={intent.handle}/>} {intent.status==='pending'&&<ConfirmAction disabled={!intent.identity_ready} question="¿Completar acceso para la identidad activada?" label="Completar acceso" onConfirm={()=>void execute({operation:'complete',payload:{handle:intent.handle}})}/>}</article>)}{!data.prepared.length&&<p>No hay accesos preparados.</p>}</section>
 </fieldset>
 {pending?.command.operation==='complete'&&!busy&&<section className="card space-y-3 p-5"><p>Puedes crear la invitación para esta identidad pendiente y después confirmar la misma solicitud de acceso.</p><InvitationButton handle={pending.command.payload.handle}/></section>}
 <p className="text-sm text-slate-600">La demostración usa el mismo Colegio Horizonte mediante el lanzador existente; no concede membresías de cliente ni de cajero. La desactivación del administrador de plataforma aún no está disponible.</p>
 </>;
}

// "Añadir persona" as a focused task; the same team journal (one request per operator) commits it.
function TeamPrepareTask({onClose,submit}:{onClose:()=>void;submit:(command:TeamCommand)=>Promise<CommandResult>}) {
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[demo,setDemo]=useState(false),[problem,setProblem]=useState<TeamCommand|null>(null);
 const parse=()=>teamCommandSchema.safeParse({operation:'prepare',payload:{name,email,demo}});
 return <CommandTask title="Añadir persona" context="Equipo de PIKAS"
  pages={[{label:'Persona',content:<><label className="block font-bold">Nombre *<input className="field mt-1 w-full" required maxLength={200} data-autofocus value={name} onChange={e=>setName(e.target.value)}/></label>
   <label className="block font-bold">Correo *<input className="field mt-1 w-full" type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <p><strong>Acceso de plataforma:</strong> Administrador de plataforma</p>
   <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={demo} onChange={e=>setDemo(e.target.checked)}/>Acceso al entorno de demostración</label></>}]}
  validate={()=>{const parsed=parse();if(!parsed.success)return 'Revisa el nombre y correo.';setProblem(parsed.data);return null;}}
  review={<><TaskSummary rows={[['Nombre',name.trim()],['Correo',email.trim()],['Acceso','Administrador de plataforma'],['Demostración',demo?'Sí':'No']]}/><p className="text-sm text-slate-600">Preparar no concede acceso. La persona usará un enlace privado para activar su identidad y elegir contraseña. No se enviará correo.</p></>}
  finalLabel="Preparar acceso" sendingLabel="Preparando acceso…" submit={()=>problem?submit(problem):Promise.resolve({kind:'rejected',message:'Revisa el nombre y correo.'})}
  dirty={!!(name||email||demo)} success={{title:'Acceso preparado',body:<p>Aparece en Accesos preparados. No se envió correo ni se concedió autoridad.</p>}} onClose={onClose}/>;
}
