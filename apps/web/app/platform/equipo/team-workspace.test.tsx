import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import * as ReactModule from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const mocks=vi.hoisted(()=>({slots:[] as unknown[],refs:[] as {current:unknown}[],effects:[] as (()=>unknown)[],first:true,cursor:{state:0,ref:0},refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(initial:unknown)=>{const n=mocks.cursor.state++;if(!(n in mocks.slots))mocks.slots[n]=initial;return [mocks.slots[n],(v:unknown)=>{mocks.slots[n]=typeof v==='function'?v(mocks.slots[n]):v;}];},useRef:(initial:unknown)=>{const n=mocks.cursor.ref++;return mocks.refs[n]??={current:initial};},useEffect:(effect:()=>unknown)=>{if(mocks.first)mocks.effects.push(effect);}}));
(globalThis as {React?:unknown}).React=ReactModule;
import { TeamWorkspace } from './team-workspace';
import { teamJournalKey } from '../../../lib/platform/team-journal';
import type { TeamRead } from '../../../lib/platform/team-contracts';
const data:TeamRead={actor_handle:'a'.repeat(32),operators:[],prepared:[]};
const command={operation:'prepare',payload:{name:'Original',email:'original@example.invalid',demo:true}};
const key='4d400000-0000-4000-8000-000000000001';
function render(){mocks.cursor.state=0;mocks.cursor.ref=0;return TeamWorkspace({data});}
async function mount(){render();mocks.effects.splice(0).forEach(e=>e());mocks.first=false;await Promise.resolve();return render();}
const locked=()=>render().props.children[3].props.disabled;
function retry(){return render().props.children[2].props.onClick();}
beforeEach(()=>{vi.clearAllMocks();mocks.slots.length=0;mocks.refs.length=0;mocks.effects.length=0;mocks.first=true;const values=new Map<string,string>();vi.stubGlobal('sessionStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}});});
afterEach(()=>{data.prepared.length=0;vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('team workspace recovery lock',()=>{
 it.each([400,401,403,409,422,503])('restored pending request remains locked after %s then clears only on matching success',async status=>{
  const saved=JSON.stringify({key,command});sessionStorage.setItem(teamJournalKey(data.actor_handle),saved);await mount();expect(locked()).toBe(true);
  const fetcher=vi.fn().mockResolvedValue({ok:false,status});vi.stubGlobal('fetch',fetcher);retry();await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());await vi.waitFor(()=>expect(render().props.children[2].props.disabled).toBe(false));expect(sessionStorage.getItem(teamJournalKey(data.actor_handle))).toBe(saved);expect(locked()).toBe(true);expect(mocks.refresh).not.toHaveBeenCalled();
  fetcher.mockResolvedValue({ok:true,json:async()=>({result:{request_id:key,operation:'prepare',status:'confirmed'}})});retry();await vi.waitFor(()=>expect(mocks.refresh).toHaveBeenCalledOnce());expect(fetcher.mock.calls[1]).toEqual(fetcher.mock.calls[0]);expect(locked()).toBe(false);expect(sessionStorage.getItem(teamJournalKey(data.actor_handle))).toBeNull();
 });
 it('an old pending completion can create its matching invitation without replacing the completion request',async()=>{const saved=JSON.stringify({key,command:{operation:'complete',payload:{handle:'b'.repeat(32)}}});sessionStorage.setItem(teamJournalKey(data.actor_handle),saved);await mount();expect(locked()).toBe(true);const section=render().props.children[4];expect(section.props.children[1].props.handle).toBe('b'.repeat(32));expect(sessionStorage.getItem(teamJournalKey(data.actor_handle))).toBe(saved);});
 it('old completion retry waits for password readiness without changing its saved key/payload',async()=>{const saved=JSON.stringify({key,command:{operation:'complete',payload:{handle:'b'.repeat(32)}}});sessionStorage.setItem(teamJournalKey(data.actor_handle),saved);data.prepared.push({handle:'b'.repeat(32),name:'Pending',email:'pending@example.invalid',demo:true,status:'pending',identity_ready:false});await mount();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);expect(render().props.children[2].props.disabled).toBe(true);retry();expect(fetcher).not.toHaveBeenCalled();expect(sessionStorage.getItem(teamJournalKey(data.actor_handle))).toBe(saved);data.prepared[0].identity_ready=true;expect(render().props.children[2].props.disabled).toBe(false);expect(sessionStorage.getItem(teamJournalKey(data.actor_handle))).toBe(saved);});
 it('corrupt journal locks editing and prevents retry',async()=>{sessionStorage.setItem(teamJournalKey(data.actor_handle),'malformed');await mount();expect(locked()).toBe(true);expect(render().props.children[2]).toBeNull();});
 it('duplicate retry sends only once',async()=>{sessionStorage.setItem(teamJournalKey(data.actor_handle),JSON.stringify({key,command}));await mount();let resolve!:(value:unknown)=>void;const fetcher=vi.fn().mockReturnValue(new Promise(r=>{resolve=r;}));vi.stubGlobal('fetch',fetcher);retry();retry();expect(fetcher).toHaveBeenCalledOnce();resolve({ok:false,status:503});await vi.waitFor(()=>expect(render().props.children[2].props.disabled).toBe(false));expect(locked()).toBe(true);});
});

it.each([['pending',false,'Activación pendiente'],['pending',true,'Listo para completar'],['completed',true,'Acceso completado']] as const)('shows authoritative %s/readiness=%s state with unchanged completion gate',async(status,identity_ready,label)=>{
 data.prepared.push({handle:'b'.repeat(32),name:'Invitada local',email:'local@example.invalid',demo:false,status,identity_ready});await mount();const html=renderToStaticMarkup(render());expect(html).toContain(label);
 if(status==='pending'){expect(html).toContain('Acceso preparado');expect(html).toContain('Completar acceso');expect(html).toMatch(identity_ready?/<button class="btn">Completar acceso/:/<button class="btn" disabled="">Completar acceso/);}else expect(html).not.toContain('Completar acceso');
});
