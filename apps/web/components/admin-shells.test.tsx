import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({path:'/admin/cafeteria/configuracion',session:vi.fn()}));
vi.mock('next/navigation',()=>({usePathname:()=>mocks.path,useRouter:()=>({replace:vi.fn(),refresh:vi.fn()})}));
vi.mock('./brand-logo',()=>({BrandLogo:()=> <span>PIKAS</span>}));
vi.mock('@/lib/platform/customer-console',()=>({requirePlatform:mocks.session}));
(globalThis as {React?:unknown}).React=React;
import {ConnectedSchoolShell} from './connected-school-shell';
import {ConnectedCafeteriaShell} from './connected-cafeteria-shell';
import {isCurrent} from './administrative-shell';
import PlatformLayout from '../app/platform/layout';
import {cafeteriaRead,id} from '../lib/cafeteria/test-fixtures';
const other='5c300000-0000-4000-8000-000000000099';
const school={school_id:id,account_id:id,school_name:'Escuela Ficticia',account_name:'Cuenta Ficticia',tenant_kind:'customer' as const};
const pov={session_id:'5c300000-0000-4000-8000-000000000001',pov_code:'school_admin' as const,operator_person_id:id,operator_name:'Edwin Ficticio',expires_at:'2030-01-01T00:00:00Z'};
// Labels of the desktop sidebar navigation, in order.
const sideNav=(html:string)=>{const start=html.indexOf('<nav class="mt-6');const nav=html.slice(start,html.indexOf('</nav>',start));return [...nav.matchAll(/<span class="min-w-0 break-words">([^<]+)<\/span>/g)].map(m=>m[1]);};
const mobileNav=(html:string)=>{const start=html.indexOf('<nav class="mobile-nav');const nav=html.slice(start,html.indexOf('</nav>',start));return [...nav.matchAll(/<span class="max-w-full hyphens-auto text-center">([^<]+)<\/span>/g)].map(m=>m[1]);};
const currentLabels=(html:string)=>[...html.matchAll(/aria-current="page"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<span[^>]*>([^<]+)</g)].map(m=>m[1]);
beforeEach(()=>{mocks.path='/admin/cafeteria/configuracion';mocks.session.mockResolvedValue({identity:{person:{displayName:'Operador local'}},capabilities:[]});});

describe('active destination',()=>{
 it.each([['/platform','/platform',true,true],['/platform/clientes','/platform',true,false],['/platform/clientes/fixture','/platform/clientes',false,true],['/platform/clientes/nuevo','/platform/clientes',false,true],['/platform/clientesx','/platform/clientes',false,false],
  ['/admin/escuela/estudiantes/abc/pikas-cash','/admin/escuela/estudiantes',false,true],['/admin/escuela/estudiantes','/admin/escuela',true,false],['/admin/cafeteria/menus/turnos','/admin/cafeteria/menus',false,true]] as const)
 ('%s against %s (exact=%s) → %s',(path,match,exact,current)=>expect(isCurrent(path,{match,exact})).toBe(current));
});

describe('cafeteria shell',()=>{
 it('one shell: identity, context, account, logout; overflow keeps every scoped destination discoverable',()=>{const data=cafeteriaRead();const html=renderToStaticMarkup(<ConnectedCafeteriaShell cafeteriaId={id} context={{person_id:id,display_name:'Admin',cafeterias:[data.scope]}}>Workspace</ConnectedCafeteriaShell>);
  expect(html).toContain('PIKAS Admin');expect(html).toContain('Administración de cafetería');expect(html).toContain('>Cafetería</p>');expect(html).toContain(data.scope.cafeteria_name);
  expect(html).toContain('<details');expect(html).toContain('aria-label="Más destinos · Actual: Configuración"');
  for(const suffix of ['','/productos','/menus','/personal','/cajas','/transacciones','/configuracion'])expect(html).toContain(`href="/admin/cafeteria${suffix}?cafeteria=${id}"`);
  expect(currentLabels(html)).toContain('Configuración');expect(html).toContain('Cerrar sesión');expect(html).toContain('aria-label="Cuenta y sesión"');expect(html).toContain('Administrador de cafetería');
  expect(html).not.toContain('Cambiar</button>');expect(html).not.toContain('Entorno Demo');});
 it('PIKAS Cash appears only with server-derived wallet read',()=>{mocks.path='/admin/cafeteria/escuelas';const data=cafeteriaRead();const ctx={person_id:id,display_name:'Admin',cafeterias:[data.scope]};const shown=renderToStaticMarkup(<ConnectedCafeteriaShell cafeteriaId={id} context={ctx} walletNav>Workspace</ConnectedCafeteriaShell>);expect(shown).toContain(`href="/admin/cafeteria/escuelas?cafeteria=${id}"`);expect(shown).toContain('>PIKAS Cash<');expect(currentLabels(shown)).toContain('PIKAS Cash');const hidden=renderToStaticMarkup(<ConnectedCafeteriaShell cafeteriaId={id} context={ctx}>Workspace</ConnectedCafeteriaShell>);expect(hidden).not.toContain('/admin/cafeteria/escuelas');expect(hidden).not.toContain('PIKAS Cash');});
 it('Reportes appears only with server-derived purchase-read authority',()=>{mocks.path='/admin/cafeteria/reportes';const data=cafeteriaRead();const ctx={person_id:id,display_name:'Admin',cafeterias:[data.scope]};const shown=renderToStaticMarkup(<ConnectedCafeteriaShell cafeteriaId={id} context={ctx} reportsNav>Workspace</ConnectedCafeteriaShell>);expect(shown).toContain(`href="/admin/cafeteria/reportes?cafeteria=${id}"`);expect(currentLabels(shown)).toContain('Reportes');const hidden=renderToStaticMarkup(<ConnectedCafeteriaShell cafeteriaId={id} context={ctx}>Workspace</ConnectedCafeteriaShell>);expect(hidden).not.toContain('/admin/cafeteria/reportes');expect(sideNav(hidden)).not.toContain('Reportes');expect(hidden).toContain('aria-current="page">Reportes</li>');});
 it('operational destinations lead the navigation (first four on mobile)',()=>{const data=cafeteriaRead();const html=renderToStaticMarkup(<ConnectedCafeteriaShell cafeteriaId={id} context={{person_id:id,display_name:'Admin',cafeterias:[data.scope]}} walletNav reportsNav>Workspace</ConnectedCafeteriaShell>);expect(sideNav(html)).toEqual(['Hoy','Transacciones','Reportes','PIKAS Cash','Cajas','Personal POS','Productos','Menús','Configuración']);
  expect(mobileNav(html)).toEqual(['Hoy','Transacciones','Cajas','Reportes']);expect(html.indexOf('>Operación</p>')).toBeLessThan(html.indexOf('>Mi cafetería</p>'));expect(html.indexOf('>Mi cafetería</p>')).toBeLessThan(html.indexOf('>Cajas</span>'));});
 it('UX 12A: the header carries the sede and the location trail names colegio → sede → cafetería → current area on every surface',()=>{mocks.path='/admin/cafeteria/cajas';const data=cafeteriaRead();const html=renderToStaticMarkup(<ConnectedCafeteriaShell cafeteriaId={id} context={{person_id:id,display_name:'Admin',cafeterias:[data.scope]}}>Workspace</ConnectedCafeteriaShell>);
  expect(html).toContain('Real cafeteria<span class="font-normal text-slate-500"> · Real campus · Real school</span>');
  const trail=html.slice(html.indexOf('aria-label="Ubicación en la estructura"'),html.indexOf('</nav>',html.indexOf('aria-label="Ubicación en la estructura"')));
  expect(trail).toContain('Colegio</span><span class="hoy-trail-v">Real school');expect(trail).toContain('Sede</span><span class="hoy-trail-v">Real campus');expect(trail).toContain('Cafetería</span><span class="hoy-trail-v">Real cafeteria');expect(trail).toContain('aria-current="page">Cajas</li>');expect(trail).not.toMatch(/<a |<button/);
  mocks.path='/admin/cafeteria/reportes/ventas';expect(renderToStaticMarkup(<ConnectedCafeteriaShell cafeteriaId={id} context={{person_id:id,display_name:'Admin',cafeterias:[data.scope]}} reportsNav>Workspace</ConnectedCafeteriaShell>)).toContain('aria-current="page">Reportes</li>');
  mocks.path='/admin/cafeteria';expect(renderToStaticMarkup(<ConnectedCafeteriaShell cafeteriaId={id} context={{person_id:id,display_name:'Admin',cafeterias:[data.scope]}}>Workspace</ConnectedCafeteriaShell>)).toContain('aria-current="page">Hoy</li>');});
});

describe('school / account shell',()=>{
 it('school: scoped destinations, detail keeps Estudiantes current, explicit logout; Reportes (UX 8) joins «Más» on mobile',()=>{mocks.path='/admin/escuela/estudiantes/abc/pikas-cash';const html=renderToStaticMarkup(<ConnectedSchoolShell schoolId={id} role="school_admin" context={{person_id:id,display_name:'Admin',schools:[school]}}>Workspace</ConnectedSchoolShell>);
  for(const suffix of ['','/estudiantes','/administradores','/cafeterias','/actividad','/reportes'])expect(html).toContain(`href="/admin/escuela${suffix}?school=${id}"`);
  expect(new Set(currentLabels(html))).toEqual(new Set(['Estudiantes']));
  expect(html).toContain('mobile-nav');expect(html).toContain('Más destinos');expect(html.slice(html.indexOf('Más destinos'))).toMatch(/Actividad[\s\S]*Reportes/);expect(html).toContain('Cerrar sesión');expect(html).toContain('Administración escolar');expect(html).toContain('Administrador escolar');expect(html).toContain('Escuela Ficticia');expect(html).not.toContain('Cuenta Ficticia');});
 it('account admin: server-derived role labels the area and shows the account; context switcher only with several schools',()=>{mocks.path='/admin/escuela';const html=renderToStaticMarkup(<ConnectedSchoolShell schoolId={id} role="account_admin" context={{person_id:id,display_name:'Admin',schools:[school,{...school,school_id:other,school_name:'Otra Escuela'}]}}>Workspace</ConnectedSchoolShell>);
  expect(html).toContain('Administración de cuenta');expect(html).toContain('Administrador de cuenta');expect(html).toContain('Cuenta Ficticia');expect(html).toContain('Otra Escuela');expect(html).toContain('Cambiar</button>');});
 it('without a validated read the role label stays neutral (no inferred authority)',()=>{const html=renderToStaticMarkup(<ConnectedSchoolShell schoolId={id} context={{person_id:id,display_name:'Admin',schools:[school]}}>Workspace</ConnectedSchoolShell>);expect(html).not.toContain('Administrador de cuenta');expect(html).not.toContain('Administrador escolar');});
 it('demo persona: one Demo bar, real operator shown, no logout, no context switcher',()=>{const html=renderToStaticMarkup(<ConnectedSchoolShell schoolId={id} context={{person_id:id,display_name:'Persona ficticia',schools:[{...school,tenant_kind:'sandbox'}],pov}}>Workspace</ConnectedSchoolShell>);
  expect(html.match(/aria-label="Entorno Demo"/g)).toHaveLength(1);expect(html).toContain('Salir del Demo');expect(html).not.toContain('action="/api/auth/logout"');expect(html).not.toContain('DEMO / SANDBOX');expect(html).toContain('Edwin Ficticio');expect(html).toContain('Operador de PIKAS · Demo');expect(html).not.toContain('Cambiar</button>');});
});

describe('platform shell',()=>{
 it('Inicio · Clientes · Equipo · Demo by capability, plus logout in the account area',async()=>{let html=renderToStaticMarkup(await PlatformLayout({children:'Workspace'}));expect(html).toContain('Cerrar sesión');for(const href of ['/platform/clientes','/platform/equipo','/platform/demostracion'])expect(html).not.toContain(`href="${href}"`);
  mocks.session.mockResolvedValue({identity:{person:{displayName:'Operador local'}},capabilities:['platform:tenant:lifecycle:read','platform:tenant:provision','platform:customer_admin:provision','platform:team:manage','platform:sandbox:pov:enter']});mocks.path='/platform/clientes/nuevo';
  html=renderToStaticMarkup(await PlatformLayout({children:'Workspace'}));expect(sideNav(html)).toEqual(['Inicio','Clientes','Equipo','Demo']);expect(html).not.toContain('Crear cliente');expect(html).toContain('aria-label="PIKAS Admin, inicio"');expect(html).toContain('action="/api/auth/logout"');expect(html).toContain('Operador de PIKAS');
  expect(new Set(currentLabels(html))).toEqual(new Set(['Clientes']));});
 it('sandbox-only operator gets Inicio · Demo only',async()=>{mocks.session.mockResolvedValue({identity:{person:{displayName:'Operador'}},capabilities:['platform:sandbox:pov:enter']});expect(sideNav(renderToStaticMarkup(await PlatformLayout({children:'x'})))).toEqual(['Inicio','Demo']);});
});
