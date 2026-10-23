import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, replace() {}, push() {} }), usePathname: () => "/platform/clientes" }));
(globalThis as { React?: typeof React }).React = React;
import { PersonSheet } from "./person-sheet";
import { PeopleList } from "./people-list";
import { TaskWindow } from "../task-window";
import type { AccessPerson } from "../../lib/platform/customer-access";

// UX 15+16: the person sheet. Server markup only (the dialog mounts client-side): structure, words and
// what is and is not offered. Fictional data.
const P = (n: number) => `6d000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const grant = (over: Partial<AccessPerson["grants"][number]>): AccessPerson["grants"][number] => ({ membership_id: P(50), scope: "cafeteria", role_code: "pos_cashier", status: "active", created_at: "2026-10-20T12:00:00Z", updated_at: null,
  school_id: P(90), school_name: "Colegio Ficticio", cafeteria_id: P(91), cafeteria_name: "Cafetería Santiago", location_name: "Sede Norte", registers: [], ...over });
const person = (over: Partial<AccessPerson> = {}): AccessPerson => ({ person_id: P(1), display_name: "María Pérez Ficticia", person_status: "active", created_at: null, has_login: true, username: "maria.perez", email: "maria.perez.6d000000@cajeros.pikas.invalid", phone: null,
  email_confirmed: true, last_sign_in_at: null, must_change_password: true, login_suspended: false, email_change_pending: false, temporary_issued_at: "2026-10-23T10:00:00Z",
  grants: [grant({ registers: [{ register_id: P(70), name: "Caja 01", code: "C1", register_status: "active", assignment_status: "active" }] }), grant({ membership_id: P(51), role_code: "cafeteria_admin", cafeteria_id: P(92), cafeteria_name: "Cafetería Tamboril", location_name: "Sede Sur" })], ...over });
const actions = { accountId: P(10), provision: true, rename: true, cafeterias: [{ id: P(91), name: "Cafetería Santiago" }, { id: P(92), name: "Cafetería Tamboril" }, { id: P(93), name: "Cafetería Norte" }] };

describe("PersonSheet", () => {
  it("is a sheet in the customer's context: identity, every access in operational words, cajas, and Credenciales right here", () => {
    const html = renderToStaticMarkup(<PersonSheet person={person()} customerName="Colegio Ficticio" identities actions={actions} onClose={() => {}} />);
    expect(html).toContain('data-variant="sheet"'); expect(html).toContain("Colegio Ficticio</span> → Personas → María Pérez Ficticia");
    expect(html).toContain("Sin correo · entra solo con su usuario"); expect(html).not.toContain("cajeros.pikas.invalid"); expect(html).toContain("maria.perez");
    expect(html).toContain("Cafetería Santiago · Personal de caja"); expect(html).toContain("Sede Norte"); expect(html).toContain("Cajas: Caja 01");
    expect(html).toContain("Cafetería Tamboril · Administrador de cafetería"); expect(html).toContain("Temporal emitida");
    expect(html).toContain(">Credenciales<"); expect(html).toContain("Dar acceso de administrador de cafetería"); expect(html).toContain("Corregir nombre");
    expect(html).not.toMatch(/account_admin|cafeteria_admin|pos_cashier|membership row|Auth user|token|password/i);
  });
  it("a cashier without a caja says who assigns one; no credentials without identity support or without a login; nothing to grant when every cafetería is held", () => {
    const noCaja = renderToStaticMarkup(<PersonSheet person={person({ grants: [grant({})] })} customerName="C" identities={false} actions={{ ...actions, cafeterias: [{ id: P(91), name: "Cafetería Santiago" }] }} onClose={() => {}} />);
    expect(noCaja).toContain("Sin caja asignada · la asigna el administrador de la cafetería en Cajas"); expect(noCaja).not.toContain(">Credenciales<"); expect(noCaja).toContain("Dar acceso de administrador de cafetería");
    const held = renderToStaticMarkup(<PersonSheet person={person({ grants: [grant({ role_code: "cafeteria_admin" })] })} customerName="C" identities actions={{ ...actions, cafeterias: [{ id: P(91), name: "Cafetería Santiago" }] }} onClose={() => {}} />);
    expect(held).not.toContain("Dar acceso de administrador de cafetería");
    const noLogin = renderToStaticMarkup(<PersonSheet person={person({ has_login: false, username: null, email: null })} customerName="C" identities actions={{ ...actions, provision: false, rename: false }} onClose={() => {}} />);
    expect(noLogin).toContain("no tiene inicio de sesión"); expect(noLogin).not.toContain(">Credenciales<"); expect(noLogin).not.toContain("Corregir nombre");
  });
  it("PeopleList: one row per person with Abrir; ?persona= opens that person's sheet on load", () => {
    const people = [person(), person({ person_id: P(2), display_name: "Juan Ficticio", must_change_password: false })];
    const closed = renderToStaticMarkup(<PeopleList people={people} customerName="C" identities actions={actions} openPerson={null} />);
    expect(closed.match(/>Abrir<\/button>/g)).toHaveLength(2); expect(closed).not.toContain('data-variant="sheet"'); expect(closed).toContain("Sin correo");
    const open = renderToStaticMarkup(<PeopleList people={people} customerName="C" identities actions={actions} openPerson={P(2)} />);
    expect(open).toContain('data-variant="sheet"'); expect(open).toContain("Personas → Juan Ficticio");
    expect(renderToStaticMarkup(<PeopleList people={people} customerName="C" identities actions={actions} openPerson={P(99)} />)).not.toContain('data-variant="sheet"');
  });
  it("TaskWindow keeps the task layout by default and the side-panel layout as a sheet", () => {
    const task = renderToStaticMarkup(<TaskWindow title="Tarea" onClose={() => {}} footer={null}><p>x</p></TaskWindow>);
    expect(task).toContain('data-variant="task"'); expect(task).toContain("sm:max-w-lg"); expect(task).toContain('aria-labelledby');
    const sheet = renderToStaticMarkup(<TaskWindow variant="sheet" title="Hoja" onClose={() => {}} footer={null}><p>x</p></TaskWindow>);
    expect(sheet).toContain('data-variant="sheet"'); expect(sheet).toContain("sm:ml-auto"); expect(sheet).toContain("sm:max-w-xl"); expect(sheet).not.toContain("sm:max-w-lg");
  });
});
