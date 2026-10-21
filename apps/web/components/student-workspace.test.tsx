import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/admin/escuela/estudiantes" }));
vi.mock("next/link", () => ({ default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
(globalThis as { React?: typeof React }).React = React;
import { StudentWorkspace } from "./student-workspace";
import type { WorkspaceInputs } from "../lib/school/student-workspace";
import type { SchoolStudent } from "../lib/school/contracts";

const id = "4d600000-0000-4000-8000-000000000001", L1 = "4d600000-0000-4000-8000-0000000000a1";
const data = (locations = [{ id: L1, name: "Sede Santiago" }]) => ({ scope: { actor_id: id, membership_id: id, role: "school_admin" as const, account_id: id, school_id: id, account_name: "Cuenta", school_name: "Colegio Ficticio", tenant_kind: "customer" as const }, locations });
const student = (patch: Partial<SchoolStudent> = {}): SchoolStudent => ({ id: "4d600000-0000-4000-8000-000000000101", first_name: "Ana", last_name: "Ficticia", display_name: "Ana Ficticia", student_code: "EST-1", status: "active",
  enrollment: { id: "4d600000-0000-4000-8000-000000000201", starts_on: "2026-08-20", location_id: L1, grade: "4to", class: "A", homeroom: "Aula 3" }, ...patch });
const inputs = (patch: Partial<WorkspaceInputs> = {}): WorkspaceInputs => ({ student: student(), wallet: { status: "active", balance_minor: "15000" },
  service: [{ name: "Cafetería Santiago", location: "Sede Santiago", serving: true }], restrictions: [{ kind: "allergen", label: "Maní", until: null }], ...patch });
const render = (i: WorkspaceInputs, walletRead = true, d = data()) => renderToStaticMarkup(<StudentWorkspace data={d} inputs={i} walletRead={walletRead} actorId={id} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const commercial = /ventas|ticket|efectivo|producto|cajer|reembolso|compr[oó]|gast|empanada|recibo/i;

describe("Student workspace", () => {
  it("identity first: back to the roster, name, status as text, code and placement; Editar información primary", () => {
    const html = render(inputs());
    expect(html).toContain(`href="/admin/escuela/estudiantes?school=${id}"`); expect(html).toMatch(/<h1[^>]*>Ana Ficticia<\/h1>/);
    expect(html).toMatch(/data-status="active">Activo</); expect(html).toContain("Código EST-1"); expect(html).toContain("4to · A");
    expect(html).toMatch(/<button type="button" class="btn">Editar información<\/button>/);
    expect(html).toContain("Aula 3"); expect(html).toContain("20/08/2026"); expect(html).not.toContain("Requiere atención");
  });
  it("PIKAS Cash with wallet authority: state and balance only, history stays on its page", () => {
    const html = render(inputs());
    expect(html).toContain("PIKAS Cash"); expect(html).toContain("RD$ 150.00"); expect(html).toContain(">Activo<");
    expect(html).toContain(`href="/admin/escuela/estudiantes/4d600000-0000-4000-8000-000000000101/pikas-cash?school=${id}"`);
    expect(render(inputs({ wallet: null }))).toContain("aún no tiene monedero"); expect(render(inputs({ wallet: undefined }))).toContain("No pudimos cargar PIKAS Cash");
  });
  it("without wallet authority the PIKAS Cash section does not exist", () => {
    const html = render(inputs({ wallet: undefined }), false);
    expect(html).not.toContain("PIKAS Cash"); expect(html).not.toContain("monedero"); expect(html).not.toContain("RD$");
  });
  it("attention: suspended, frozen and negative wallet are explained, never scored", () => {
    const html = render(inputs({ student: student({ status: "suspended" }), wallet: { status: "frozen", balance_minor: "-2500" } }));
    expect(html).toContain("Requiere atención"); expect(html).toContain("está suspendido"); expect(html).toContain("congelado"); expect(html).toContain("saldo negativo");
    expect(html).toContain("−RD$ 25.00"); expect(html).toMatch(/data-status="suspended">Suspendido</);
  });
  it("minimal record: no enrollment means Matricular and no withdrawal; empty sections are calm", () => {
    const html = render(inputs({ student: student({ enrollment: null }), service: [], restrictions: [] }));
    expect(html).toContain(">Matricular<"); expect(html).not.toContain("Retirar matrícula"); expect(html).toContain("Sin matrícula activa. Matricúlalo");
    expect(html).toContain("No está habilitado en ninguna cafetería"); expect(html).toContain("Sin restricciones registradas.");
  });
  it("service and restrictions: only when readable; status changes sit apart from routine edits", () => {
    const html = render(inputs({ service: null, restrictions: null }));
    expect(html).not.toContain("Cafeterías"); expect(html).not.toContain("Restricciones");
    const full = render(inputs());
    expect(full).toContain("Habilitado"); expect(full).toContain("Maní"); expect(full).toContain("Alérgeno");
    const zone = full.slice(full.indexOf("Estado y matrícula"));
    expect(zone).toContain(">Cambiar estado<"); expect(zone).toContain("Retirar matrícula"); expect(zone).not.toContain('class="btn"');
  });
  it("long names wrap; no IDs or commercial data in visible text", () => {
    const html = render(inputs({ student: student({ display_name: "Ana Ficticia con un Nombre Extraordinariamente Largo de Santiago de los Caballeros" }) }), true, data([{ id: L1, name: "Sede Santiago" }, { id: "4d600000-0000-4000-8000-0000000000a2", name: "Sede Tamboril" }]));
    expect(html).toContain("break-words"); expect(html).toContain("4to · A · Sede Santiago");
    const visible = text(html); expect(visible).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); expect(visible.replace(/PIKAS Cash/g, "")).not.toMatch(commercial);
  });
});
