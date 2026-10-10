import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import * as ReactModule from 'react';
const mocks=vi.hoisted(()=>({slots:[] as unknown[],refs:[] as {current:unknown}[],effects:[] as (()=>unknown)[],first:true,cursor:{state:0,ref:0},refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(initial:unknown)=>{const n=mocks.cursor.state++;if(!(n in mocks.slots))mocks.slots[n]=initial;return [mocks.slots[n],(v:unknown)=>{mocks.slots[n]=typeof v==='function'?v(mocks.slots[n]):v;}];},useRef:(initial:unknown)=>{const n=mocks.cursor.ref++;return mocks.refs[n]??={current:initial};},useEffect:(effect:()=>unknown)=>{if(mocks.first)mocks.effects.push(effect);}}));
(globalThis as {React?:unknown}).React=ReactModule;
import { ConnectedCafeteriaProvider } from './connected-cafeteria-provider';
import { cafeteriaRead,id } from '../lib/cafeteria/test-fixtures';
import { recoveryKey } from '../lib/cafeteria/command';
let snapshot=cafeteriaRead();
function render(){mocks.cursor.state=0;mocks.cursor.ref=0;return ConnectedCafeteriaProvider({data:snapshot,children:'Editors'});}
async function mount(){render();mocks.effects.splice(0).forEach(e=>e());mocks.first=false;await Promise.resolve();return render();}
const payload={email:'original@example.invalid',role:'pos_cashier'};
const execute=(data=payload)=>render().props.value('staff_prepare',data);
function locked(){return render().props.children.props.children[2].props.disabled;}
function text(node:unknown):string {if(typeof node==='string')return node;if(Array.isArray(node))return node.map(text).join(' ');if(node&&typeof node==='object'&&'props' in node)return text((node as {props:{children?:unknown}}).props.children);return '';}
beforeEach(()=>{snapshot=cafeteriaRead();vi.clearAllMocks();mocks.slots.length=0;mocks.refs.length=0;mocks.effects.length=0;mocks.first=true;const values=new Map<string,string>();vi.stubGlobal('sessionStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('cafeteria workspace recovery',()=>{
 it.each([400,401,403,422,409,503])('preserves lost committed request after recovery %s across reloads',async status=>{
  let attempt=0,writes=0;const committed=new Set<string>();const uuid=vi.spyOn(crypto,'randomUUID');
  const fetcher=vi.fn(async(_url:string,options:RequestInit)=>{const key=(options.headers as Record<string,string>)['Idempotency-Key'];attempt++;if(attempt===2)return {ok:false,status,json:async()=>({error:'rejected'})};if(!committed.has(key)){writes++;committed.add(key);}if(attempt===1)throw Error('Committed response lost');return {ok:true,json:async()=>({result:{request_id:key,operation:'staff_prepare',target_id:id}})};});
  vi.stubGlobal('fetch',fetcher);await mount();await execute();const journal=sessionStorage.getItem(recoveryKey(id,id));expect(journal).not.toBeNull();expect(locked()).toBe(true);
  mocks.slots.length=0;mocks.refs.length=0;mocks.first=true;await mount();await execute({email:'edited@example.invalid',role:'pos_supervisor'});
  expect(sessionStorage.getItem(recoveryKey(id,id))).toBe(journal);expect(locked()).toBe(true);expect(text(render())).toContain('sigue sin confirmar');expect(text(render())).not.toContain('No se realizó el cambio');expect(mocks.refresh).not.toHaveBeenCalled();
  mocks.slots.length=0;mocks.refs.length=0;mocks.first=true;await mount();await execute();expect(fetcher.mock.calls[1]).toEqual(fetcher.mock.calls[0]);expect(fetcher.mock.calls[2]).toEqual(fetcher.mock.calls[0]);expect(writes).toBe(1);expect(uuid).toHaveBeenCalledOnce();expect(sessionStorage.getItem(recoveryKey(id,id))).toBeNull();expect(locked()).toBe(false);expect(mocks.refresh).toHaveBeenCalledOnce();
 });
 it.each([400,401,403,422])('first definitive rejection %s unlocks',async status=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status,json:async()=>({error:'rejected'})}));await mount();await execute();expect(locked()).toBe(false);expect(sessionStorage.getItem(recoveryKey(id,id))).toBeNull();});
 it('corrupt journal blocks new writes',async()=>{vi.stubGlobal('sessionStorage',{getItem:()=>'{bad'});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);await mount();await execute();expect(fetcher).not.toHaveBeenCalled();expect(locked()).toBe(true);});
 it('duplicate submit cannot start another request',async()=>{let resolve!:(v:unknown)=>void;const fetcher=vi.fn().mockReturnValue(new Promise(r=>{resolve=r;}));vi.stubGlobal('fetch',fetcher);await mount();const first=execute();await execute();expect(fetcher).toHaveBeenCalledOnce();resolve({ok:false,status:422,json:async()=>({})});await first;});
});

describe('catalog editor adapter bindings',()=>{
 function sender(){const fetcher=vi.fn(async(_url:string,options:RequestInit)=>{const command=JSON.parse(options.body as string);return {ok:true,json:async()=>({result:{request_id:(options.headers as Record<string,string>)['Idempotency-Key'],operation:command.operation,target_id:id}})};});vi.stubGlobal('fetch',fetcher);return fetcher;}
 it('sends persisted minor-unit price and version without unsupported metadata',async()=>{snapshot.products=[{id,name:'Food',description:'',category_id:null,price_minor:19500,active:true,available:true,ingredients:[],allergens:[],version:7}];const fetcher=sender();await mount();await render().props.children.props.value.adminUpdateMenu({id,name:'Food',description:'Updated',category:'Lunch',priceMinor:19950,active:true,available:false,ingredients:['Rice'],allergens:['Milk'],restrictionTags:['unsupported'],imageUrl:'unsupported'});const command=JSON.parse(fetcher.mock.calls[0][1].body as string);expect(command).toEqual({cafeteriaId:id,operation:'product_save',payload:{id,version:7,name:'Food',description:'Updated',category:'Lunch',price_minor:19950,active:true,available:false,ingredients:['Rice'],allergens:['Milk']}});});
 it('saves menu and selection in one authoritative command',async()=>{snapshot.menus=[{id,name:'Menu',description:'',active:true,version:4,product_ids:[]}];const fetcher=sender();await mount();await render().props.children.props.value.adminSaveCafeteriaMenu({id,name:'Edited menu',active:true,organizationId:'untrusted',locationId:'untrusted'},[id]);expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({cafeteriaId:id,operation:'menu_save',payload:{id,version:4,name:'Edited menu',description:'',active:true,product_ids:[id]}});});
 it('uses the authoritative settings version',async()=>{snapshot.settings.version=5;const fetcher=sender();await mount();await render().props.children.props.value.adminSetServiceScheduling(true,false);expect(JSON.parse(fetcher.mock.calls[0][1].body as string).payload).toEqual({version:5,scheduling_enabled:true});});
 it('carries the real business timezone into the preserved editors',async()=>{snapshot.service={status:'manual',scheduling_enabled:false,business_date:'2026-10-10',local_time:'12:00:00',business_timezone:'America/New_York',service_shift_id:null,service_shift_name:null,menu_id:null,menu_name:null};await mount();expect(render().props.children.props.value.timeZone).toBe('America/New_York');});
});
