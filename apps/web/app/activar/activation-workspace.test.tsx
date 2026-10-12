import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as ReactModule from 'react';
const mocks=vi.hoisted(()=>({slots:[] as unknown[],refs:[] as {current:unknown}[],effects:[] as (()=>void)[],cursor:{state:0,ref:0},first:true}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(initial:unknown)=>{const n=mocks.cursor.state++;if(!(n in mocks.slots))mocks.slots[n]=initial;return [mocks.slots[n],(value:unknown)=>{mocks.slots[n]=value;}];},useRef:(initial:unknown)=>{const n=mocks.cursor.ref++;return mocks.refs[n]??={current:initial};},useEffect:(effect:()=>void)=>{if(mocks.first)mocks.effects.push(effect);}}));
(globalThis as {React?:unknown}).React=ReactModule;
import {ActivationWorkspace} from './activation-workspace';
function render(){mocks.cursor.state=0;mocks.cursor.ref=0;return ActivationWorkspace();}
beforeEach(()=>{mocks.slots.length=0;mocks.refs.length=0;mocks.effects.length=0;mocks.first=true;});
afterEach(()=>vi.unstubAllGlobals());
it('keeps the private fragment token during repeated StrictMode effects and never activates automatically',async()=>{
 const location={hash:'#token='+ 'a'.repeat(64),search:''};const replaceState=vi.fn(()=>{location.hash='';});const fetcher=vi.fn();
 vi.stubGlobal('window',{location,history:{replaceState}});vi.stubGlobal('fetch',fetcher);
 render();const effect=mocks.effects[0];effect();effect();await Promise.resolve();
 mocks.first=false;const tree=render();expect(replaceState).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled();
 expect(tree.props.children[3].props.children[1].props.children).toBe('Activar mi cuenta');
});
it('a clean reload resumes password setting by opaque handle without persisting the provider token',async()=>{
 vi.stubGlobal('window',{location:{hash:'',search:'?invitation='+ 'b'.repeat(32)},history:{replaceState:vi.fn()}});
 render();mocks.effects[0]();await Promise.resolve();mocks.first=false;
 expect(render().props.children[3].props.children[0].props.children).toBe('Crea tu contraseña');
});
it('warns that the private link does not independently prove mailbox ownership',()=>{const tree=render();expect(tree.props.children[1].props.children).toContain('no verifica por separado');});
