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
 it.each(["summary","students","administrators","cafeterias","activity"] as const)("renders authoritative %s without demo identity", section => { const html=renderToStaticMarkup(<ConnectedSchoolPages section={section} data={data} />); expect(html).toContain("Real school"); expect(html).not.toContain("Instituto Nueva Generación"); expect(html).not.toContain("DemoReset"); expect(html).not.toContain("auth_user_id"); });
 it("retains five navigation sections and authoritative sandbox identification", () => { const html=renderToStaticMarkup(<ConnectedSchoolShell schoolId={id} context={{person_id:id,display_name:"Real admin",schools:[{school_id:id,school_name:"Horizonte",account_id:id,account_name:"Sandbox account",tenant_kind:"sandbox"}]}}><p>Workspace</p></ConnectedSchoolShell>); for(const label of ["Resumen","Estudiantes","Administradores","Cafeterías conectadas","Actividad","DEMO / SANDBOX","Horizonte","Real admin"]) expect(html).toContain(label); });
 it("CSV preview cannot import and no financial operation is mounted", () => { const html=renderToStaticMarkup(<ConnectedSchoolPages section="students" data={data} />); expect(html).toContain("Importar — no disponible"); expect(html).toMatch(/<button[^>]+disabled[^>]*>Importar/); expect(html).not.toContain("/api/menu"); expect(html).not.toContain("Recargar saldo"); });
 it("administrator preparation does not claim email delivery or expose IDs", () => { const html=renderToStaticMarkup(<ConnectedSchoolPages section="administrators" data={data} />); expect(html).toContain("No se envía un correo"); expect(html).toContain("correo confirmado"); expect(html).not.toContain("token_hash"); });
});
