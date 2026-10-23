import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, replace() {}, push() {} }), usePathname: () => "/platform/clientes" }));
(globalThis as { React?: typeof React }).React = React;
import { PersonSheet } from "./person-sheet";
import { StructureStatusAction } from "./structure-status-action";
import { AddPosAccessAction, AssignmentActions, MembershipStatusActions } from "./access-lifecycle-actions";
import type { AccessPerson } from "../../lib/platform/customer-access";

// Lifecycle & Access Management on the Platform: server markup of the actions offered (the dialogs
// mount client-side). Scope-named actions, no deletion, no "Archivar", the global login elsewhere.
const P = (n: number) => `6e000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const grant = (over: Partial<AccessPerson["grants"][number]> = {}): AccessPerson["grants"][number] => ({ membership_id: P(50), scope: "cafeteria", role_code: "pos_cashier", status: "active", created_at: "2026-10-20T12:00:00Z", updated_at: null,
  school_id: P(90), school_name: "Colegio Ficticio", cafeteria_id: P(91), cafeteria_name: "Cafetería Santiago", location_name: "Sede Norte", registers: [{ register_id: P(70), name: "Caja 01", code: "C1", register_status: "active", assignment_status: "active" }], ...over });
const person = (over: Partial<AccessPerson> = {}): AccessPerson => ({ person_id: P(1), display_name: "María Pérez Ficticia", person_status: "active", created_at: null, has_login: true, username: "maria.perez", email: "maria.perez.6e000000@cajeros.pikas.invalid", phone: null,
  email_confirmed: true, last_sign_in_at: null, must_change_password: false, login_suspended: false, email_change_pending: false, temporary_issued_at: null, grants: [grant()], ...over });
const cafeterias = [{ id: P(91), name: "Cafetería Santiago", location: "Sede Norte", registers: [{ id: P(70), name: "Caja 01", code: "C1" }, { id: P(71), name: "Caja 02", code: "C2" }] }, { id: P(92), name: "Cafetería Tamboril", location: "Sede Sur", registers: [] }];
const actions = { accountId: P(10), provision: true, rename: true, lifecycle: true, assign: true, cafeterias };

describe("sede / cafetería lifecycle actions", () => {
  it("offers only the valid transitions in the locked words; never Eliminar or Archivar", () => {
    const activeCaf = renderToStaticMarkup(<StructureStatusAction accountId={P(10)} kind="cafeteria" targetId={P(91)} name="Cafetería Santiago" status="active" />);
    expect(activeCaf).toContain(">Suspender cafetería<"); expect(activeCaf).toContain(">Desactivar cafetería<"); expect(activeCaf).not.toContain("Reactivar"); expect(activeCaf).toContain('aria-label="Suspender cafetería: Cafetería Santiago"');
    const suspended = renderToStaticMarkup(<StructureStatusAction accountId={P(10)} kind="cafeteria" targetId={P(91)} name="Cafetería Santiago" status="suspended" />);
    expect(suspended).toContain(">Reactivar cafetería<"); expect(suspended).toContain(">Desactivar cafetería<"); expect(suspended).not.toContain("Suspender");
    const sede = renderToStaticMarkup(<StructureStatusAction accountId={P(10)} kind="location" targetId={P(80)} name="Sede Norte" status="active" />);
    expect(sede).toContain(">Desactivar sede<"); expect(sede).not.toContain("Suspender");
    expect(renderToStaticMarkup(<StructureStatusAction accountId={P(10)} kind="location" targetId={P(80)} name="Sede Norte" status="inactive" />)).toContain(">Reactivar sede<");
    for (const html of [activeCaf, suspended, sede]) expect(html).not.toMatch(/Eliminar|Archivar|Borrar/);
  });
});

describe("access lifecycle on the person sheet", () => {
  it("every action names its scope; the global login is not offered here", () => {
    const html = renderToStaticMarkup(<MembershipStatusActions accountId={P(10)} grant={grant()} customerName="Colegio Ficticio" personName="María Pérez Ficticia" />);
    expect(html).toContain(">Suspender acceso a Cafetería Santiago<"); expect(html).toContain(">Desactivar acceso a Cafetería Santiago<"); expect(html).not.toMatch(/inicio de sesión|Eliminar|Archivar/);
    const suspended = renderToStaticMarkup(<MembershipStatusActions accountId={P(10)} grant={grant({ status: "suspended" })} customerName="C" personName="M" />);
    expect(suspended).toContain(">Reactivar acceso a Cafetería Santiago<"); expect(suspended).toContain(">Desactivar acceso a Cafetería Santiago<");
    expect(renderToStaticMarkup(<MembershipStatusActions accountId={P(10)} grant={grant({ status: "inactive" })} customerName="C" personName="M" />)).toBe('<div class="flex flex-wrap gap-2"><button type="button" class="btn-secondary">Reactivar acceso a Cafetería Santiago</button></div>');
    const school = renderToStaticMarkup(<MembershipStatusActions accountId={P(10)} grant={grant({ scope: "school", role_code: "school_admin", cafeteria_id: null, cafeteria_name: null })} customerName="C" personName="M" />);
    expect(school).toContain(">Suspender acceso a Colegio Ficticio<");
    expect(renderToStaticMarkup(<MembershipStatusActions accountId={P(10)} grant={grant({ scope: "account", role_code: "account_admin" })} customerName="C" personName="M" />)).toBe("");
  });
  it("caja assignment: Quitar asignación de {caja} for assigned cajas, Asignar {caja} for the rest while the access is active; nothing for non-POS roles", () => {
    const html = renderToStaticMarkup(<AssignmentActions accountId={P(10)} grant={grant()} personName="M" cafeterias={cafeterias} />);
    expect(html).toContain(">Quitar asignación de Caja 01<"); expect(html).toContain(">Asignar Caja 02<"); expect(html).not.toContain(">Asignar Caja 01<");
    const suspended = renderToStaticMarkup(<AssignmentActions accountId={P(10)} grant={grant({ status: "suspended" })} personName="M" cafeterias={cafeterias} />);
    expect(suspended).toContain("Quitar asignación de Caja 01"); expect(suspended).not.toContain("Asignar Caja 02");
    expect(renderToStaticMarkup(<AssignmentActions accountId={P(10)} grant={grant({ role_code: "cafeteria_admin" })} personName="M" cafeterias={cafeterias} />)).toBe("");
    expect(renderToStaticMarkup(<AssignmentActions accountId={P(10)} grant={grant({ registers: [] })} personName="M" cafeterias={[{ id: P(91), name: "Cafetería Santiago", registers: [] }]} />)).toBe("");
  });
  it("Agregar a otra cafetería appears only while another cafetería of this customer is available", () => {
    expect(renderToStaticMarkup(<AddPosAccessAction accountId={P(10)} personId={P(1)} personName="M" grants={[grant()]} cafeterias={cafeterias} canAssign />)).toContain(">Agregar a otra cafetería<");
    expect(renderToStaticMarkup(<AddPosAccessAction accountId={P(10)} personId={P(1)} personName="M" grants={[grant(), grant({ membership_id: P(51), cafeteria_id: P(92), cafeteria_name: "Cafetería Tamboril" })]} cafeterias={cafeterias} canAssign />)).toBe("");
    // a cafetería_admin there does not block a POS access there
    expect(renderToStaticMarkup(<AddPosAccessAction accountId={P(10)} personId={P(1)} personName="M" grants={[grant(), grant({ membership_id: P(51), cafeteria_id: P(92), role_code: "cafeteria_admin" })]} cafeterias={cafeterias} canAssign />)).toContain("Agregar a otra cafetería");
  });
  it("PersonSheet: lifecycle actions for active or suspended customers, grants only for active ones, the status line for non-active accesses", () => {
    const full = renderToStaticMarkup(<PersonSheet person={person()} customerName="Colegio Ficticio" identities actions={actions} onClose={() => {}} />);
    expect(full).toContain("Suspender acceso a Cafetería Santiago"); expect(full).toContain("Quitar asignación de Caja 01"); expect(full).toContain("Agregar a otra cafetería"); expect(full).toContain("Dar acceso de administrador de cafetería");
    const suspendedCustomer = renderToStaticMarkup(<PersonSheet person={person()} customerName="Colegio Ficticio" identities actions={{ ...actions, provision: false, assign: false }} onClose={() => {}} />);
    expect(suspendedCustomer).toContain("Suspender acceso a Cafetería Santiago"); expect(suspendedCustomer).not.toContain("Quitar asignación"); expect(suspendedCustomer).not.toContain("Agregar a otra cafetería"); expect(suspendedCustomer).not.toContain("Dar acceso de administrador de cafetería");
    const readOnly = renderToStaticMarkup(<PersonSheet person={person({ grants: [grant({ status: "suspended" })] })} customerName="Colegio Ficticio" identities={false} actions={{ ...actions, provision: false, rename: false, lifecycle: false, assign: false }} onClose={() => {}} />);
    expect(readOnly).toContain("Suspendido"); expect(readOnly).not.toContain("Reactivar acceso"); expect(readOnly).not.toMatch(/<button[^>]*>(Suspender|Desactivar|Quitar)/);
  });
});
