'use client';
import { AppPageHeader } from './app-page-header';
import {CafeteriaOperations} from './cafeteria-operations';
import { CafeteriaTransactions } from './cafeteria-transactions';
import {StaffActivationCard} from './staff-activation-card';
import { useRef, useState } from 'react';
import type { CafeteriaRead, Operation } from '../lib/cafeteria/contracts';
import { useCafeteriaMutation } from './connected-cafeteria-provider';
import { CafeteriaProductsEditor } from './cafeteria-products-editor';
import { CafeteriaMenusEditor } from './cafeteria-menus-editor';
import { CafeteriaWalletLookup } from './cafeteria-wallet-lookup';
import { CafeteriaReports } from './cafeteria-reports';
import { CafeteriaToday } from './cafeteria-today';
import { CashierRefundLimits } from './cashier-refund-limits';
import { DataList } from './data-list';
import { EmptyState } from './state-panels';
import { RegisterTask, StaffAccessTask, StaffPrepareTask, StaffStatusTask, roleLabel } from './cafeteria-admin-tasks';
import { MemberCredentialsTask, identityRequest } from './identity-credentials';
import { accessState, isInternalEmail } from '../lib/identity/staff-access';
import type { IdentitySummary } from '../lib/identity/contracts';
import { useEffect } from 'react';
export type CafeteriaSection='summary'|'products'|'menus'|'shifts'|'staff'|'registers'|'settings'|'transactions'|'schools'|'reports';
const statusLabel=(s:string)=>({active:'Activo',inactive:'Inactivo',suspended:'Suspendido',archived:'Archivado',pending:'Pendiente',accepted:'Completado',expired:'Vencido',revoked:'Revocado'})[s]??s;
const value=(data:FormData,key:string)=>String(data.get(key)??'').trim();
function Input({label,name,initial='',type='text',maxLength=120,readOnly=false}:{label:string;name:string;initial?:string;type?:string;maxLength?:number;readOnly?:boolean}) {
 return <label className="block font-bold">{label}<input className="field mt-1" required name={name} type={type} maxLength={maxLength} defaultValue={initial} readOnly={readOnly}/></label>;
}
function CommandForm({operation,payload,label,children,confirmation,onSuccess}:{operation:Operation;payload:(data:FormData)=>unknown;label:string;children?:React.ReactNode;confirmation?:string;onSuccess?:()=>void}) {
 const execute=useCafeteriaMutation();
 // In-app confirmation (Wave D.3) replaces window.confirm; nothing is prepared before it.
 const [confirming,setConfirming]=useState(false),confirmed=useRef(false);
 return <form className="space-y-4" onSubmit={async e=>{e.preventDefault();if(confirmation&&!confirmed.current){setConfirming(true);return;}confirmed.current=false;setConfirming(false);const result=await execute(operation,payload(new FormData(e.currentTarget)));if(result.ok)onSuccess?.();}}>{children}
 {confirming?<div role="alertdialog" aria-label={label} className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="font-bold">{confirmation}</p><div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={()=>setConfirming(false)}>Cancelar</button><button type="button" className="btn" onClick={e=>{confirmed.current=true;e.currentTarget.form?.requestSubmit();}}>{label}</button></div></div>:<button className="btn" type="submit">{label}</button>}</form>;
}
// UX 12B: the access state of one POS member, read lazily through the existing tenant-scoped
// identity read (identity_support_read_membership). Customer tenants only; never in sandbox.
const accessTone={ready:'bg-emerald-100 text-emerald-900',pending:'bg-amber-100 text-amber-900',blocked:'bg-red-50 text-red-900',off:'bg-slate-100 text-slate-700'} as const;
const when=(iso:string|null)=>iso?new Date(iso).toLocaleString('es-DO',{dateStyle:'medium',timeStyle:'short'}):'Nunca';
function AccessCell({membershipId,status}:{membershipId:string;status:'active'|'suspended'|'inactive'}) {
 const [state,setState]=useState<{summary?:IdentitySummary;error?:boolean}>({});
 useEffect(()=>{let live=true;identityRequest({operation:'read_membership',membership_id:membershipId}).then(r=>{if(live)setState(r.summary?{summary:r.summary}:{error:true});},()=>{if(live)setState({error:true});});return()=>{live=false;};},[membershipId]);
 if(state.error)return <span className="text-sm text-slate-500">No pudimos consultar el acceso</span>;
 if(!state.summary)return <span className="text-sm text-slate-500" role="status">Consultando…</span>;
 const a=accessState(state.summary,status);
 return <span className="block"><span className={`chip ${accessTone[a.tone]}`} title={a.detail}>{a.label}</span><span className="mt-1 block text-xs text-slate-600">{state.summary.username?`Usuario ${state.summary.username} · `:''}Último acceso: {when(state.summary.last_sign_in_at)}</span></span>;
}
function Staff({data}:{data:CafeteriaRead}) {
 const [query,setQuery]=useState(''),[role,setRole]=useState(''),[status,setStatus]=useState(''),[task,setTask]=useState<{kind:'new'}|{kind:'status'|'credentials';id:string}|null>(null),[notice,setNotice]=useState('');
 const staff=data.staff.filter(m=>(!role||m.role===role)&&(!status||m.status===status)&&m.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const filtered=!!(query.trim()||role||status),clear=()=>{setQuery('');setRole('');setStatus('');};
 const member=task?.kind==='status'?data.staff.find(m=>m.id===task.id):undefined,credentials=task?.kind==='credentials'?data.staff.find(m=>m.id===task.id):undefined;
 const close=(message?:string)=>{setTask(null);if(message)setNotice(message);};
 // Link-based accesses still waiting (or expired); completed ones already live in the staff list.
 const linkAccesses=data.invitations.filter(i=>i.status==='pending'||i.status==='expired');
 return <div className="space-y-5"><AppPageHeader title="Personal POS" description={`Personal de ${data.scope.cafeteria_name}: identidad, estado y acceso a cajas.`} action={<button className="btn" onClick={()=>{setNotice('');setTask({kind:'new'});}}>Agregar personal a {data.scope.cafeteria_name}</button>}/>
 {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 font-bold text-emerald-900">{notice}</p>}
 <p className="rounded-xl bg-amber-50 p-3 text-sm">{data.scope.tenant_kind==='sandbox'?'No se emiten enlaces de activación en sandbox. Solo puede completarse acceso para una identidad elegible ya existente.':'Agrega personal en un paso: usuario sugerido, contraseña temporal de un solo uso y caja. No se envía correo. Al entrar, la persona crea su propia contraseña. Desde Credenciales puedes ver su usuario y emitirle otra contraseña temporal; con Cambiar acceso lo suspendes o reactivas.'}</p>
 <div role="search" aria-label="Filtros de personal" className="grid gap-3 sm:grid-cols-3"><label className="font-bold">Buscar personal<input className="field mt-1 w-full" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nombre"/></label><label className="font-bold">Filtrar por rol<select className="field mt-1 w-full" value={role} onChange={e=>setRole(e.target.value)}><option value="">Todos los roles</option><option value="pos_cashier">Cajero</option><option value="pos_supervisor">Supervisor</option></select></label><label className="font-bold">Filtrar por estado<select className="field mt-1 w-full" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos los estados</option>{['active','suspended','inactive'].map(s=><option key={s} value={s}>{statusLabel(s)}</option>)}</select></label></div>
 <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"><p role="status">{staff.length} de {data.staff.length} personas</p>{filtered&&<button type="button" className="min-h-11 font-bold text-teal-800 underline" onClick={clear}>Limpiar filtros</button>}</div>
 {!data.staff.length?<EmptyState title={`Aún no hay personal POS en ${data.scope.cafeteria_name}.`} description="Agrega una persona para preparar su acceso al POS. Después la asignas a una caja en Cajas."/>:!staff.length?<EmptyState title="No encontramos personas con estos filtros." action={<button type="button" className="btn-secondary" onClick={clear}>Limpiar filtros</button>}/>
 :<DataList label="Personal POS" rows={staff} rowKey={m=>m.id} columns={[
  {header:'Persona',primary:true,cell:m=>m.name},
  {header:'Rol',cell:m=>roleLabel(m.role)},
  {header:'Estado',cell:m=><span className="chip">{statusLabel(m.status)}</span>},
  ...(data.scope.tenant_kind==='customer'?[{header:'Acceso',cell:(m:CafeteriaRead['staff'][number])=><AccessCell membershipId={m.id} status={m.status}/>}]:[]),
  {header:'Cajas',cell:m=>data.assignments.filter(a=>a.membership_id===m.id&&a.status==='active').map(a=>data.registers.find(r=>r.id===a.register_id)?.name).join(', ')||'Sin caja asignada'},
  {header:'Sesión',cell:m=>m.open?'Sesión abierta':'Sin sesión abierta'},
 ]} actions={m=><><button className="btn-secondary" aria-label={`Cambiar acceso de ${m.name}`} onClick={()=>{setNotice('');setTask({kind:'status',id:m.id});}}>Cambiar acceso</button>{data.scope.tenant_kind!=='sandbox'&&<button className="btn-secondary" aria-label={`Credenciales de ${m.name}`} onClick={()=>{setNotice('');setTask({kind:'credentials',id:m.id});}}>Credenciales</button>}</>}/>}
 {!!linkAccesses.length&&<><h2 className="text-xl font-black">Accesos preparados por enlace</h2><p className="text-sm text-slate-600">Accesos que esperan activación por enlace privado. Los accesos creados en un paso no aparecen aquí: ya están en la lista de personal.</p></>}{linkAccesses.map(i=><article className="card space-y-3 p-4" key={i.id}><p className="break-all font-bold">{isInternalEmail(i.email)?'Acceso sin correo (usuario PIKAS)':i.email}</p><p>{roleLabel(i.role)} · {statusLabel(i.status)} · Vence {new Date(i.expires_at).toLocaleDateString('es-DO',{timeZone:'UTC'})}</p>{data.scope.tenant_kind==='sandbox'?(i.status==='pending'&&<CommandForm operation="staff_complete" label="Confirmar identidad y conceder acceso POS" confirmation="¿Conceder acceso operativo exclusivamente a esta cafetería?" payload={d=>({invitation_id:i.id,display_name:value(d,'display_name')})}><Input label="Nombre completo" name="display_name" maxLength={200}/></CommandForm>):<StaffActivationCard invitationId={i.id} pending={i.status==='pending'} sandbox={false}/>}</article>)}
 {task?.kind==='new'&&(data.scope.tenant_kind==='customer'?<StaffAccessTask data={data} onClose={close}/>:<StaffPrepareTask data={data} onClose={close}/>)}
 {member&&<StaffStatusTask member={member} cafeteriaName={data.scope.cafeteria_name} onClose={close}/>}
 {credentials&&<MemberCredentialsTask membershipId={credentials.id} name={credentials.name} onClose={()=>setTask(null)}/>}
 </div>;
}
function Registers({data}:{data:CafeteriaRead}) {
 const [task,setTask]=useState<{id:string|null;n:number}|null>(null),[query,setQuery]=useState(''),[status,setStatus]=useState(''),[notice,setNotice]=useState('');
 const registers=data.registers.filter(r=>(!status||r.status===status)&&`${r.name} ${r.code}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const filtered=!!(query.trim()||status),clear=()=>{setQuery('');setStatus('');};
 const register=task?.id?data.registers.find(r=>r.id===task.id):undefined;
 return <div className="space-y-5"><AppPageHeader title="Cajas" description={`Cajas de ${data.scope.cafeteria_name}: configuración, estado operativo y personal autorizado.`} action={<button className="btn" onClick={()=>{setNotice('');setTask({id:null,n:0});}}>Crear caja para {data.scope.cafeteria_name}</button>}/>
 {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 font-bold text-emerald-900">{notice}</p>}
 <div role="search" aria-label="Filtros de cajas" className="grid gap-3 sm:grid-cols-2"><label className="font-bold">Buscar cajas<input className="field mt-1 w-full" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nombre o código"/></label><label className="font-bold">Estado<select className="field mt-1 w-full" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos</option><option value="active">Activa</option><option value="inactive">Inactiva</option></select></label></div>
 <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"><p role="status">{registers.length} de {data.registers.length} cajas</p>{filtered&&<button type="button" className="min-h-11 font-bold text-teal-800 underline" onClick={clear}>Limpiar filtros</button>}</div>
 {!data.registers.length?<EmptyState title={`Aún no hay cajas en ${data.scope.cafeteria_name}.`} description="Crea la primera caja para asignar personal y abrir sesiones en el POS."/>:!registers.length?<EmptyState title="No encontramos cajas con estos filtros." action={<button type="button" className="btn-secondary" onClick={clear}>Limpiar filtros</button>}/>:null}
 {registers.map(r=><article className="card space-y-4 p-5" key={r.id}><div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-black">{r.name}</h2><p className="text-sm text-slate-600">{r.code} · {r.status==='active'?'Activa':'Inactiva'}</p><p className="mt-1"><span className={`chip ${r.open?'bg-emerald-100 text-emerald-900':''}`}>{r.open?'Sesión abierta':'Sin sesión abierta'}</span></p></div><div className="text-right"><button className="btn-secondary" aria-label={`Editar caja ${r.name}`} disabled={r.open} onClick={()=>{setNotice('');setTask({id:r.id,n:0});}}>Editar</button>{r.open&&<p className="mt-1 text-xs text-slate-600">Cierra la sesión para editar.</p>}</div></div>
 <details><summary className="flex min-h-11 cursor-pointer items-center font-bold">Personal autorizado</summary><div className="mt-4 space-y-4">{data.staff.map(m=>{const assignment=data.assignments.find(a=>a.register_id===r.id&&a.membership_id===m.id); const active=assignment?.status==='active';if(!active&&(m.status!=='active'||r.status!=='active'))return null;return <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><p>{m.name} · {roleLabel(m.role)} · {active?'Asignado':'Sin asignación'}</p><CommandForm operation="assignment_save" label={active?`Quitar asignación de ${r.name}`:`Asignar ${r.name}`} confirmation={active?`¿Quitar a ${m.name} la asignación de ${r.name}? Solo deja de poder abrir esta caja; su acceso a la cafetería, sus sesiones y su historial se conservan.`:`¿Asignar ${r.name} a ${m.name}? Podrá abrir sesiones en esta caja desde el POS.`} payload={()=>({membership_id:m.id,register_id:r.id,status:active?'inactive':'active',version:assignment?.version??null})}/></div>;})}{!data.staff.length&&<p>No hay personal POS. Prepara su acceso en Personal POS.</p>}</div></details></article>)}
 {task&&(task.id===null||register)&&<RegisterTask key={`${task.id}:${task.n}`} data={data} register={register} onClose={message=>{setTask(null);if(message)setNotice(message);}} reopen={()=>setTask({id:null,n:task.n+1})}/>}
 </div>;
}
function Categories({data}:{data:CafeteriaRead}) {
 const create=<CommandForm operation="category_save" label="Crear categoría" payload={d=>({id:crypto.randomUUID(),version:null,name:value(d,'name'),display_order:0,status:'active'})}><Input label="Nombre de categoría" name="name" maxLength={80}/></CommandForm>;
 // UX 14 (audit A-9): with no categories the panel teaches what they are, why the catalog and the CSV
 // import need one, and shows the existing create form instead of an empty heading.
 if(!data.categories.length)return <section id="categorias" aria-labelledby="categorias-title" className="card mt-5 space-y-4 p-5"><h2 id="categorias-title" className="text-lg font-black">Categorías</h2>
  <EmptyState title="Aún no hay categorías en esta cafetería." description="Una categoría agrupa productos parecidos («Bebidas», «Almuerzos», «Meriendas») para que el catálogo y el POS sean fáciles de recorrer. Cada producto pertenece a una categoría, y la importación por CSV solo acepta categorías que ya existen." hint="Es normal al empezar. Crea la primera aquí; al agregar un producto también puedes crear una categoría nueva en el mismo paso."/>
  {create}</section>;
 return <details id="categorias" className="card mt-5 p-5"><summary className="flex min-h-11 cursor-pointer items-center text-lg font-black">Categorías</summary><div className="mt-4 space-y-5">{create}{data.categories.map(c=><section className="border-t pt-4" key={c.id}><CommandForm operation="category_save" label="Guardar categoría" confirmation="¿Guardar los cambios de categoría?" payload={d=>({id:c.id,version:c.version,name:value(d,'name'),display_order:Number(value(d,'display_order')),status:value(d,'status')})}><Input label="Nombre de categoría" name="name" initial={c.name} maxLength={80}/><Input label="Orden" name="display_order" initial={String(c.display_order)} type="number"/><label className="block font-bold">Estado<select className="field mt-1" name="status" defaultValue={c.status}><option value="active">Activa</option><option value="archived">Archivada</option></select></label></CommandForm></section>)}</div></details>;
}
export function ConnectedCafeteriaPages({section,data}:{section:CafeteriaSection;data:CafeteriaRead}) {
 if(section==='products')return <><CafeteriaProductsEditor/><Categories data={data}/></>;
 if(section==='menus'||section==='shifts')return <CafeteriaMenusEditor shifts={section==='shifts'}/>;
 if(section==='staff')return <Staff data={data}/>;
 if(section==='registers')return <><Registers data={data}/><CafeteriaOperations cafeteriaId={data.scope.cafeteria_id} actorId={data.scope.actor_id} kind="sessions" sandbox={data.scope.tenant_kind==='sandbox'}/></>;
 if(section==='settings')return <><AppPageHeader title="Configuración" description="Modo de servicio y controles de la operación POS."/><section className="card mt-5 space-y-3 p-5"><h2 className="text-xl font-black">Operación de cafetería</h2><p>{data.scope.cafeteria_name} · {data.scope.school_name} · {data.scope.location_name}</p><p>Moneda del catálogo: {data.settings.currency}</p><CommandForm operation="settings_save" label="Guardar modo de servicio" confirmation="¿Confirmar el modo de servicio? Cambia los productos ofrecidos en POS." payload={d=>({version:data.settings.version,scheduling_enabled:d.has('scheduling_enabled')})}><label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="scheduling_enabled" defaultChecked={data.settings.scheduling_enabled}/>Activar turnos de servicio</label></CommandForm></section><section className="card mt-5 p-5"><h2 className="text-xl font-black">Controles pendientes</h2><p className="mt-2">Preferencias visuales POS, imágenes y etiquetas alimentarias adicionales aún no tienen configuración conectada. Solicitudes familiares y reportes se habilitarán en una fase posterior.</p></section>{data.scope.tenant_kind==='customer'&&data.scope.capabilities.includes('cafeteria:refund_limits:configure')&&<CashierRefundLimits cafeteriaId={data.scope.cafeteria_id}/>}</>;
 if(section==='reports')return data.scope.capabilities.includes('cafeteria:pos:purchases:read')?<CafeteriaReports cafeteriaId={data.scope.cafeteria_id} sandbox={data.scope.tenant_kind==='sandbox'} reconciliation={data.scope.capabilities.includes('cafeteria:pos:sessions:read')}/>:<p className="card p-5">Tu rol no tiene acceso a reportes de esta cafetería.</p>;
 if(section==='transactions')return <CafeteriaTransactions cafeteriaId={data.scope.cafeteria_id} sandbox={data.scope.tenant_kind==='sandbox'}/>;
 if(section==='schools'){const walletRead=data.scope.tenant_kind==='customer'&&data.scope.capabilities.includes('cafeteria:wallets:read');return <><AppPageHeader title={walletRead?'PIKAS Cash':'Escuelas conectadas'} description={`${data.scope.school_name} · ${data.scope.location_name}. La escuela administra la compartición y la elegibilidad estudiantil.`}/>{walletRead&&<CafeteriaWalletLookup cafeteriaId={data.scope.cafeteria_id} actorId={data.scope.actor_id} canAdjust={data.scope.capabilities.includes('cafeteria:wallets:administrative_adjust')}/>}</>;}
 return <CafeteriaToday data={data}/>;
}

// Platform support reuses the same catalog/register tasks and provider, but exposes only the
// M2/M4 allow-list. Financial operations, staff provisioning and credential controls never render.
export function SupportCafeteriaManagement({section,data}:{section:'products'|'menus'|'shifts'|'registers'|'settings';data:CafeteriaRead}) {
 if(section==='products')return <><CafeteriaProductsEditor/><Categories data={data}/></>;
 if(section==='menus'||section==='shifts')return <CafeteriaMenusEditor shifts={section==='shifts'}/>;
 if(section==='registers')return <Registers data={data}/>;
 return <><AppPageHeader title="Configuración" description="Modo de servicio del catálogo y menús."/><section className="card mt-5 space-y-3 p-5"><h2 className="text-xl font-black">Operación de cafetería</h2><p>{data.scope.cafeteria_name} · {data.scope.school_name} · {data.scope.location_name}</p><p>Moneda del catálogo: {data.settings.currency}</p><CommandForm operation="settings_save" label="Guardar modo de servicio" confirmation="¿Confirmar el modo de servicio? Cambia los productos ofrecidos en POS." payload={d=>({version:data.settings.version,scheduling_enabled:d.has('scheduling_enabled')})}><label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="scheduling_enabled" defaultChecked={data.settings.scheduling_enabled}/>Activar turnos de servicio</label></CommandForm></section></>;
}
