import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => "/admin/escuela" }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
(globalThis as { React?: typeof React }).React = React;
import { ConnectedSchoolPages } from "./connected-school-pages";
import { ConnectedSchoolShell } from "./connected-school-shell";
import type { SchoolRead } from "../lib/school/contracts";
const id = "4d200000-0000-4000-8000-000000000001";
const data: SchoolRead = { scope: { actor_id:id,membership_id:id,role:"school_admin",account_id:id,school_id:id,account_name:"Real account",school_name:"Real school",tenant_kind:"customer" }, locations: [], counts:{ students:3,active:2,suspended:1,inactive:0,cafeterias:1 }, rows:[],memberships:[],invitations:[] };
describe("connected school presentation", () => {
 it.each(["summary","students","administrators","cafeterias","activity"] as const)("renders authoritative %s without demo identity", section => { const html=renderToStaticMarkup(<ConnectedSchoolPages section={section} data={data} />); expect(html).toMatch(/<h1[^>]*>(Resumen|Estudiantes|Administradores|Cafeterías conectadas|Actividad)<\/h1>/); /* the school name now lives in the shell context bar */ expect(html).not.toContain("Instituto Nueva Generación"); expect(html).not.toContain("DemoReset"); expect(html).not.toContain("auth_user_id"); });
 it("retains five navigation sections and authoritative sandbox identification", () => { const html=renderToStaticMarkup(<ConnectedSchoolShell schoolId={id} context={{person_id:id,display_name:"Real admin",schools:[{school_id:id,school_name:"Horizonte",account_id:id,account_name:"Sandbox account",tenant_kind:"sandbox"}]}}><p>Workspace</p></ConnectedSchoolShell>); for(const label of ["Resumen","Estudiantes","Administradores","Cafeterías conectadas","Actividad","DEMO / SANDBOX","Horizonte","Real admin"]) expect(html).toContain(label); });
 it("CSV import is discoverable and no financial operation is mounted", () => { const html=renderToStaticMarkup(<ConnectedSchoolPages section="students" data={data} />); expect(html).toContain("Importar CSV"); expect(html).not.toMatch(/<button[^>]+disabled[^>]*>Importar/); expect(html).not.toContain("/api/menu"); expect(html).not.toContain("Recargar saldo"); });
 it("roster contains explicit profile actions without embedded student mutation forms", () => { const student={id,first_name:"Luna",last_name:"Castillo",display_name:"Luna Castillo",student_code:"LUNA",status:"active" as const,enrollment:null}; const html=renderToStaticMarkup(<ConnectedSchoolPages section="students" data={data} students={[student]}/>); expect(html).toContain("Ver perfil de Luna Castillo"); expect(html).toContain("Crear estudiante"); expect(html).not.toContain("Editar estudiante"); expect(html).not.toContain("Cambiar estado"); expect(html).not.toContain("name=\"first_name\""); });
 it("administrator preparation does not claim email delivery or expose IDs", () => { const html=renderToStaticMarkup(<ConnectedSchoolPages section="administrators" data={data} />); expect(html).toContain("No se envía un correo"); expect(html).toContain("correo confirmado"); expect(html).not.toContain("token_hash"); });
});

it.each([['account_admin','customer',true],['school_admin','customer',false],['account_admin','sandbox',false]] as const)('delegation surface is restricted for %s/%s',(role,tenant,visible)=>{
 const scoped:SchoolRead={...data,scope:{...data.scope,role,tenant_kind:tenant},rows:[{id,name:'Fictional Cafe',location:'Campus',status:'active',sharing_status:'revoked',categories:[],customer_count:0,customers:[]}]};
 expect(renderToStaticMarkup(<ConnectedSchoolPages section="cafeterias" data={scoped}/>).includes('aria-label="Administración de cafetería"')).toBe(visible);
});

describe('UX 13 Cafeterías conectadas states', () => {
 const row = (patch: Record<string, unknown> = {}) => ({ id, name: 'Cafetería Santiago', location: 'Sede Santiago', status: 'active', sharing_status: 'revoked', categories: [], customer_count: 0, customers: [], ...patch });
 const render = (sharing: Record<string, 'active' | 'revoked'> | null, patch: Record<string, unknown> = {}, students: unknown[] = []) => renderToStaticMarkup(<ConnectedSchoolPages section="cafeterias" data={{ ...data, rows: [row(patch)] } as SchoolRead} sharing={sharing} students={students as never} />);
 it('never shared: "Sin compartir todavía", a share action, basic identification preselected, and "share first" guidance for eligibility', () => {
  const html = render({});
  expect(html).toContain('Sin compartir todavía'); expect(html).not.toContain('revocada'); expect(html).toContain('Compartir con Cafetería Santiago'); expect(html).toContain('Compartir permite que esta cafetería vea únicamente');
  expect(html.match(/<input[^>]*value="basic_identification"[^>]*>/)?.[0]).toContain('checked'); expect(html).toContain('Primero comparte con Cafetería Santiago.'); expect(html).toContain('id="cafeteria-'+id+'"');
 });
 it('revoked after sharing: says revoked and offers to share again', () => {
  const html = render({ [id]: 'revoked' }); expect(html).toContain('Compartición revocada'); expect(html).toContain('Volver a compartir con Cafetería Santiago');
 });
 it('shared with students but none enabled: teaching empty state and the eligibility section open', () => {
  const html = render({ [id]: 'active' }, { sharing_status: 'active' }, [{ id, display_name: 'Sol Ficticia', student_code: 'S-1', status: 'active', enrollment: { id, starts_on: '2026-08-15', location_id: null, grade: null, class: null, homeroom: null } }]);
  expect(html).toContain('Compartición activa'); expect(html).toContain('Ningún estudiante habilitado todavía.'); expect(html).toMatch(/<details open/); expect(html).toContain('Habilitar estudiante');
 });
 it('shared but the school has no students: points to Estudiantes; enabled students show a count and no empty state', () => {
  expect(render({ [id]: 'active' }, { sharing_status: 'active' })).toContain('Aún no hay estudiantes para habilitar.');
  const html = render({ [id]: 'active' }, { sharing_status: 'active', customer_count: 2, customers: [{ student_id: id, display_name: 'Sol Ficticia', status: 'active' }] });
  expect(html).toContain('2 estudiantes habilitados'); expect(html).not.toContain('Ningún estudiante habilitado'); expect(html).not.toMatch(/<details open/);
 });
 it('without the sharing-rows read the wording stays neutral', () => { const html = render(null); expect(html).toContain('Sin compartición activa'); expect(html).not.toContain('revocada'); });
});
