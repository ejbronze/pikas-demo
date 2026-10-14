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

type TreeProps = {children?:unknown;id?:string;name?:string;role?:string;'aria-describedby'?:string;onChange?:()=>void;onSubmit?:(event:{preventDefault:()=>void;currentTarget:object})=>void};
type Tree = ReactModule.ReactElement<TreeProps>;
function find(tree:unknown,predicate:(node:Tree)=>boolean):Tree | undefined {
 if(!ReactModule.isValidElement<TreeProps>(tree))return;
 if(predicate(tree))return tree;
 for(const child of [tree.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}
}
async function passwordForm(){vi.stubGlobal('window',{location:{hash:'',search:'?invitation='+ 'b'.repeat(32)},history:{replaceState:vi.fn()}});render();mocks.effects[0]();await Promise.resolve();mocks.first=false;}
function submit(password:string,confirmation:string){vi.stubGlobal('FormData',class{get(name:string){return name==='password'?password:confirmation;}});find(render(),n=>n.type==='form')!.props.onSubmit!({preventDefault(){},currentTarget:{}});}
it('matching passwords send only the existing handle/password payload',async()=>{await passwordForm();const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetcher);submit('secure-password','secure-password');await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({handle:'b'.repeat(32),password:'secure-password'});});
it('mismatch prevents submission, associates an inline error, and correction permits submission',async()=>{await passwordForm();const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetcher);submit('secure-password','different-password');expect(fetcher).not.toHaveBeenCalled();const error=find(render(),n=>n.props?.id==='password-mismatch');expect(error!.props.role).toBe('alert');expect(error!.props.children).toContain('no coinciden');const confirmation=find(render(),n=>n.props?.name==='confirmPassword');expect(confirmation!.props['aria-describedby']).toBe(error!.props.id);confirmation!.props.onChange!();expect(find(render(),n=>n.props?.id==='password-mismatch')).toBeUndefined();submit('secure-password','secure-password');await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());});
it.each(['weak_password','invalid'])('matching confirmation preserves existing %s error and recovery messaging',async error=>{await passwordForm();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({error})}));submit('secure-password','secure-password');await vi.waitFor(()=>expect(find(render(),n=>n.props?.role==='alert')!.props.children).toContain(error==='weak_password'?'política de seguridad':'Reintenta con la misma contraseña'));expect(find(render(),n=>n.type==='form')).toBeDefined();});

it("keeps platform sign-in and adds customer sign-in after activation",()=>{render();mocks.slots[3]=true;const tree=render();expect(find(tree,n=>n.props && "href" in n.props && n.props.href==="/login")?.props.children).toBe("Entrar a mi escuela o cafetería");expect(find(tree,n=>n.props && "href" in n.props && n.props.href==="/backoffice/login")).toBeDefined();});
