import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({require:vi.fn(),read:vi.fn()}));
vi.mock('../../../lib/platform/customer-console',()=>({requirePlatform:mocks.require,readPlatform:mocks.read}));
vi.mock('@/lib/platform/customer-console',()=>({requirePlatform:mocks.require,readPlatform:mocks.read}));
vi.mock('@/components/brand-logo',()=>({BrandLogo:()=>null}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh(){}}),usePathname:()=>'/platform/equipo'}));
(globalThis as {React?:typeof React}).React=React;
import TeamPage from './page';
import PlatformLayout from '../layout';
const data={actor_handle:'a'.repeat(32),operators:[{handle:'b'.repeat(32),name:'Internal operator',email:'internal@example.invalid',person_status:'active',admin_status:'active',demo:false}],prepared:[{handle:'c'.repeat(32),name:'Pending operator',email:'pending@example.invalid',demo:true,status:'pending'}]};
beforeEach(()=>{vi.clearAllMocks();mocks.require.mockResolvedValue({identity:{person:{displayName:'Administrator'}},capabilities:['platform:team:manage']});mocks.read.mockResolvedValue({kind:'ready',value:data});});
describe('Equipo de PIKAS',()=>{
 it('reads through the dedicated platform gate and shows safe operator details',async()=>{const html=renderToStaticMarkup(await TeamPage());expect(mocks.read).toHaveBeenCalledWith(expect.anything(),'platform:team:manage','platform_team_activation_read',{},expect.anything());expect(html).toMatch(/<h1[^>]*>Equipo<\/h1>/);expect(html).toContain('Internal operator');expect(html).toContain('Completar acceso');expect(html).toContain('Añadir persona');expect(html).toContain('no concede membresías');expect(html).not.toContain('a'.repeat(32));expect(html).not.toContain('b'.repeat(32));});
 it('shows forbidden without team details',async()=>{mocks.read.mockResolvedValue({kind:'forbidden'});const html=renderToStaticMarkup(await TeamPage());expect(html).toContain('No tienes permiso');expect(html).not.toContain('Internal operator');});
 it('fails closed on unavailable reads',async()=>{mocks.read.mockResolvedValue({kind:'unavailable'});expect(renderToStaticMarkup(await TeamPage())).toContain('No se pudo cargar');});
 it('adds navigation only for team capability',async()=>{expect(renderToStaticMarkup(await PlatformLayout({children:'Content'}))).toContain('/platform/equipo');mocks.require.mockResolvedValue({identity:{person:{displayName:'Operator'}},capabilities:['platform:sandbox:pov:enter']});expect(renderToStaticMarkup(await PlatformLayout({children:'Content'}))).not.toContain('/platform/equipo');});
});
