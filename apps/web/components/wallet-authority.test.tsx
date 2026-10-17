import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh(){}}),usePathname:()=>'/admin',redirect:vi.fn()}));
vi.mock('next/link',()=>({default:({children,href,className}:{children:React.ReactNode;href:string;className?:string})=><a href={href} className={className}>{children}</a>}));
vi.mock('./product-image-picker',()=>({ProductImagePicker:()=>null}));
const mocks=vi.hoisted(()=>({access:vi.fn(),wallet:vi.fn(),walletProps:[] as unknown[]}));
vi.mock('../lib/supabase/server',()=>({createSupabaseServerClient:async()=>({})}));
vi.mock('../lib/auth/school-access',()=>({resolveSchoolAccess:mocks.access}));
vi.mock('../lib/wallet/access',()=>({readSchoolWalletAccess:mocks.wallet}));
vi.mock('./connected-school-shell',()=>({ConnectedSchoolShell:({children}:{children:React.ReactNode})=><>{children}</>}));
vi.mock('./student-wallet',()=>({StudentWallet:(props:unknown)=>{mocks.walletProps.push(props);return <div data-wallet="mounted"/>;}}));
(globalThis as {React?:typeof React}).React=React;
import { ConnectedSchoolPages } from './connected-school-pages';
import { ConnectedCafeteriaPages } from './connected-cafeteria-pages';
import { ConnectedCafeteriaProvider } from './connected-cafeteria-provider';
import WalletPage from '../app/admin/escuela/estudiantes/[studentId]/pikas-cash/page';
import { cafeteriaRead } from '../lib/cafeteria/test-fixtures';
import type { SchoolRead } from '../lib/school/contracts';
const id='5bf00000-0000-4000-8000-000000000001';
const data:SchoolRead={scope:{actor_id:id,membership_id:id,role:'account_admin',account_id:id,school_id:id,account_name:'Cuenta ficticia',school_name:'Escuela ficticia',tenant_kind:'customer'},locations:[]};
const student={id,first_name:'Sol',last_name:'Ficticia',display_name:'Sol Ficticia',student_code:'SOL',status:'active' as const,enrollment:null};
beforeEach(()=>{mocks.walletProps.length=0;mocks.wallet.mockClear();mocks.access.mockResolvedValue({status:'authorized',context:{person_id:id,display_name:'Admin',schools:[{school_id:id}]}});});
describe('capability-aware wallet surfaces',()=>{
 it('roster shows PIKAS Cash only with server-derived read authority',()=>{
  expect(renderToStaticMarkup(<ConnectedSchoolPages section="students" data={data} students={[student]} walletRead />)).toContain('PIKAS Cash de Sol Ficticia');
  expect(renderToStaticMarkup(<ConnectedSchoolPages section="students" data={data} students={[student]} />)).not.toContain('PIKAS Cash');
 });
 it.each([[{read:false,replenish:false},false,null],[{read:true,replenish:false},true,false],[{read:true,replenish:true},true,true]])('wallet page for %j',async(access,mounted,canReplenish)=>{
  mocks.wallet.mockResolvedValue({school_id:id,...access});
  const html=renderToStaticMarkup(await WalletPage({params:Promise.resolve({studentId:id}),searchParams:Promise.resolve({school:id})}));
  expect(html.includes('data-wallet="mounted"')).toBe(mounted);
  if(!mounted)expect(html).toContain('Tu rol no tiene acceso a PIKAS Cash');
  else expect(mocks.walletProps[0]).toMatchObject({canReplenish});
 });
 it('sandbox POV never queries or mounts wallet',async()=>{
  mocks.access.mockResolvedValue({status:'authorized',context:{person_id:id,display_name:'Admin',schools:[{school_id:id}],pov:{}}});
  const html=renderToStaticMarkup(await WalletPage({params:Promise.resolve({studentId:id}),searchParams:Promise.resolve({school:id})}));
  expect(html).toContain('sandbox');expect(mocks.wallet).not.toHaveBeenCalled();expect(mocks.walletProps).toHaveLength(0);
 });
 it.each([[['cafeteria:wallets:read'],'customer',true],[['cafeteria:catalog:manage'],'customer',false],[['cafeteria:wallets:read'],'sandbox',false]])('cafeteria lookup with %j/%s',(capabilities,tenant,visible)=>{
  const read=cafeteriaRead();read.scope.capabilities=capabilities;read.scope.tenant_kind=tenant as 'customer'|'sandbox';
  const html=renderToStaticMarkup(<ConnectedCafeteriaProvider data={read}><ConnectedCafeteriaPages section="schools" data={read}/></ConnectedCafeteriaProvider>);
  expect(html.includes('Saldo PIKAS Cash de clientes')).toBe(visible);
  expect(html).not.toMatch(/Recarga|recarga verificada|Monto de recarga/);
 });
});
describe('administrative adjustment surfaces (5C.3)',()=>{
 it('cafeteria lookup offers adjustment only with the server capability',()=>{
  for(const [caps,visible] of [[['cafeteria:wallets:read','cafeteria:wallets:administrative_adjust'],true],[['cafeteria:wallets:read'],false]] as const){
   const read=cafeteriaRead();read.scope.capabilities=[...caps];read.scope.tenant_kind='customer';
   const html=renderToStaticMarkup(<ConnectedCafeteriaProvider data={read}><ConnectedCafeteriaPages section="schools" data={read}/></ConnectedCafeteriaProvider>);
   expect(html.includes('Los ajustes administrativos son solo para correcciones excepcionales')).toBe(visible);
  }
 });
 it('wallet page passes adjust authority to the wallet',async()=>{
  mocks.wallet.mockResolvedValue({school_id:id,read:true,replenish:true,reverse:true,adjust:true});
  renderToStaticMarkup(await WalletPage({params:Promise.resolve({studentId:id}),searchParams:Promise.resolve({school:id})}));
  expect(mocks.walletProps[0]).toMatchObject({canAdjust:true,canReverse:true});
 });
});
