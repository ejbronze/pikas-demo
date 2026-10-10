'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CafeteriaRead, Operation } from '../lib/cafeteria/contracts';
import { commandSchema } from '../lib/cafeteria/contracts';
import { load, prepare, recoveryKey, send, mustPreserve, type Pending } from '../lib/cafeteria/command';
import { CatalogEditorContext, type CatalogWorkspace } from './cafeteria-editor-context';
type Result = { ok:true } | { ok:false; message:string };
type Execute = (operation:Operation,payload:unknown)=>Promise<Result>;
const MutationContext = createContext<Execute|null>(null);
export function useCafeteriaMutation() { const execute=useContext(MutationContext); if (!execute) throw new Error('Missing cafeteria mutation context'); return execute; }
export function ConnectedCafeteriaProvider({data,children}:{data:CafeteriaRead;children:React.ReactNode}) {
 const router=useRouter(); const storageKey=recoveryKey(data.scope.actor_id,data.scope.cafeteria_id);
 const [ready,setReady]=useState(false),[pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const inFlight=useRef(false);
 useEffect(()=>{let alive=true; queueMicrotask(()=>{if(!alive)return; try { const stored=load(sessionStorage,storageKey); if(stored && stored.command.cafeteriaId!==data.scope.cafeteria_id) throw new Error('Scope mismatch'); setPending(stored);setReady(true);if(stored)setMessage('Solicitud pendiente de confirmar. Recupera la misma solicitud antes de editar.'); } catch {setMessage('No se puede recuperar la solicitud. Las operaciones están bloqueadas.');}}); return ()=>{alive=false;};},[storageKey,data.scope.cafeteria_id]);
 const execute:Execute=async(operation,payload)=>{
  if(inFlight.current || !ready)return {ok:false,message:'Confirma la solicitud pendiente antes de continuar.'};
  inFlight.current=true;setBusy(true);
  try {
   const recovery=pending ?? load(sessionStorage,storageKey);
   const request=recovery ?? prepare(sessionStorage,storageKey,commandSchema.parse({cafeteriaId:data.scope.cafeteria_id,operation,payload}));
   setPending(request);
   const outcome=await send(request);
   if(mustPreserve(!!recovery,outcome)) {
    const message='La operación anterior sigue sin confirmar. Conservamos la misma clave, operación y datos. Recupera el acceso y confirma la solicitud pendiente antes de editar.';setMessage(message);return {ok:false,message};
   }
   sessionStorage.removeItem(storageKey);setPending(null);
   if(outcome==='success'){setMessage('Cambio confirmado.');router.refresh();return {ok:true};}
   const message=outcome==='pending-identity'?'Identidad pendiente: debe registrarse y confirmar su correo. No se ha concedido acceso.':'No se realizó el cambio. Revisa los datos, versiones y permisos actuales.';
   setMessage(message);return {ok:false,message};
  } catch { const message='No se pudo completar la preparación o confirmación. Revisa la solicitud pendiente antes de continuar.';setMessage(message);return {ok:false,message}; }
  finally {inFlight.current=false;setBusy(false);}
 };
 const scope={organizationId:data.scope.account_id,locationId:data.scope.cafeteria_id};
 const productPayload=(item:Parameters<CatalogWorkspace['adminUpdateMenu']>[0],version:number|null)=>({id:item.id,version,name:item.name,description:item.description,category:item.category,price_minor:item.priceMinor,active:item.active!==false,available:item.available,ingredients:item.ingredients,allergens:item.allergens});
 const workspace:CatalogWorkspace={connected:true,timeZone:data.service?.business_timezone,categories:data.categories.filter(c=>c.status==='active').map(c=>c.name),scope,connection:'Online',state:{
  menuItems:data.products.map(p=>({id:p.id,name:p.name,description:p.description,category:data.categories.find(c=>c.id===p.category_id)?.name ?? 'Sin categoría',priceMinor:p.price_minor,active:p.active,available:p.available,ingredients:p.ingredients,allergens:p.allergens,restrictionTags:[],imageUrl:null})),
  cafeteriaOperations:{menus:data.menus.map(m=>({...scope,id:m.id,name:m.name,description:m.description,active:m.active})),menuProducts:data.menus.flatMap(m=>m.product_ids.map(productId=>({menuId:m.id,productId}))),serviceShifts:data.shifts.map(s=>({...scope,id:s.id,name:s.name,menuId:s.menu_id,weekdays:s.weekdays,startTime:s.start_time,endTime:s.end_time,enabled:s.enabled})),serviceSettings:{enabled:data.settings.scheduling_enabled,timeZone:'America/Santo_Domingo'},registers:data.registers.map(r=>({...scope,id:r.id,name:r.name,active:r.status==='active'}))}
 },
 adminAddMenu:item=>execute('product_save',productPayload({...item,ingredients:item.ingredients??[],restrictionTags:item.restrictionTags??[],imageUrl:null},null)),
 adminUpdateMenu:item=>execute('product_save',productPayload(item,data.products.find(p=>p.id===item.id)?.version??null)),
 adminSaveCafeteriaMenu:(menu,productIds)=>execute('menu_save',{id:menu.id,version:data.menus.find(m=>m.id===menu.id)?.version??null,name:menu.name,description:menu.description??'',active:menu.active,product_ids:productIds}),
 adminSaveServiceShift:shift=>execute('shift_save',{id:shift.id,version:data.shifts.find(s=>s.id===shift.id)?.version??null,menu_id:shift.menuId,name:shift.name,start_time:shift.startTime,end_time:shift.endTime,enabled:shift.enabled,weekdays:shift.weekdays}),
 adminSetServiceScheduling:enabled=>execute('settings_save',{version:data.settings.version,scheduling_enabled:enabled}),
 };
 return <MutationContext.Provider value={execute}><CatalogEditorContext.Provider value={workspace}>
 {message && <p className="my-3 rounded-xl bg-amber-50 p-3 text-sm" role="status">{message}</p>}
 {pending && <button className="btn mb-4" disabled={!ready||busy} onClick={()=>{void execute(pending.command.operation,pending.command.payload);}}>{busy?'Confirmando…':'Confirmar solicitud pendiente'}</button>}
 <fieldset className="min-w-0 border-0 p-0" disabled={!ready||busy||pending!==null}>{children}</fieldset>
 </CatalogEditorContext.Provider></MutationContext.Provider>;
}
