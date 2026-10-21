import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,it,expect,vi } from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh(){}}),usePathname:()=>'/admin/cafeteria'}));
vi.mock('next/link',()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
vi.mock('./product-image-picker',()=>({ProductImagePicker:()=>null}));
vi.mock('./demo-provider',()=>{throw Error('Connected workspace must not load demo authority');});
(globalThis as {React?:typeof React}).React=React;
import { ConnectedCafeteriaPages } from './connected-cafeteria-pages';
import { ConnectedCafeteriaProvider } from './connected-cafeteria-provider';
import { ConnectedCafeteriaShell } from './connected-cafeteria-shell';
import { cafeteriaRead,id } from '../lib/cafeteria/test-fixtures';
describe('connected cafeteria presentation',()=>{
 it.each(['summary','products','menus','shifts','staff','registers','settings','transactions','schools'] as const)('renders %s without demo authority',section=>{const data=cafeteriaRead();const html=renderToStaticMarkup(<ConnectedCafeteriaProvider data={data}><ConnectedCafeteriaPages section={section} data={data}/></ConnectedCafeteriaProvider>);expect(html).not.toContain('Cafetería PIKAS Central');expect(html).not.toContain('Restablecer demo');expect(html).not.toContain('auth_user_id');expect(html).not.toContain('token_hash');});
 it('retains seven navigation destinations and real sandbox scope',()=>{const data=cafeteriaRead();const html=renderToStaticMarkup(<ConnectedCafeteriaShell cafeteriaId={id} context={{person_id:id,display_name:'Real admin',cafeterias:[{...data.scope,tenant_kind:'sandbox'}]}}>Workspace</ConnectedCafeteriaShell>);for(const label of ['Hoy','Productos','Menús','Personal POS','Cajas','Transacciones','Configuración','DEMO / SANDBOX','Real cafeteria'])expect(html).toContain(label);});
 it('truthfully separates pending identity from granting staff authority',()=>{const data=cafeteriaRead();const html=renderToStaticMarkup(<ConnectedCafeteriaProvider data={data}><ConnectedCafeteriaPages section="staff" data={data}/></ConnectedCafeteriaProvider>);expect(html).toContain('No se envía correo');expect(html).toContain('enlace privado de activación');expect(html).not.toContain('Auth UUID');});
 it('retains mature product filters and category controls',()=>{const data=cafeteriaRead();const html=renderToStaticMarkup(<ConnectedCafeteriaProvider data={data}><ConnectedCafeteriaPages section="products" data={data}/></ConnectedCafeteriaProvider>);for(const label of ['Agregar producto','Buscar productos','Todas las categorías','Todos los estados','Crear categoría'])expect(html).toContain(label);});
});

it('preserves existing sandbox staff completion without exposing activation issuance',()=>{const data=cafeteriaRead();data.scope.tenant_kind='sandbox';data.invitations=[{id,email:'fictional@example.invalid',role:'pos_cashier',status:'pending',expires_at:'2099-01-01T00:00:00Z'}];const html=renderToStaticMarkup(<ConnectedCafeteriaProvider data={data}><ConnectedCafeteriaPages section="staff" data={data}/></ConnectedCafeteriaProvider>);expect(html).toContain('Confirmar identidad y conceder acceso POS');expect(html).not.toContain('Generar enlace de activación');});
