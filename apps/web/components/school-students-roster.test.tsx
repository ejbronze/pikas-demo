import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/admin/escuela/estudiantes" }));
vi.mock("next/link", () => ({ default: ({ children, href, className, ...rest }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className} {...rest}>{children}</a> }));
// eslint-disable-next-line @next/next/no-img-element
vi.mock("next/image", () => ({ default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} /> }));
(globalThis as { React?: typeof React }).React = React;
import { SchoolStudents } from "./school-students";
import type { SchoolRead, SchoolStudent } from "../lib/school/contracts";

// PIKAS UX 5 roster. Fictional data only.
const id = "4d500000-0000-4000-8000-000000000001", L1 = "4d500000-0000-4000-8000-0000000000a1", L2 = "4d500000-0000-4000-8000-0000000000a2";
const data = (patch: Partial<SchoolRead> = {}): SchoolRead => ({ scope: { actor_id: id, membership_id: id, role: "school_admin", account_id: id, school_id: id, account_name: "Cuenta ficticia", school_name: "Colegio Ficticio Atlántico", tenant_kind: "customer" },
  locations: [{ id: L1, name: "Sede Santiago" }], grades: [], next_cursor: null, ...patch });
const student = (n: number, patch: Partial<SchoolStudent> = {}): SchoolStudent => ({ id: `4d500000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`, first_name: "Estudiante", last_name: `Ficticio ${n}`,
  display_name: `Estudiante Ficticio ${n}`, student_code: `EST-${n}`, status: "active", enrollment: { id, starts_on: "2026-08-20", location_id: L1, grade: "4to", class: "A", homeroom: null }, ...patch });
const counts = { students: 14, active: 12, suspended: 1, inactive: 1, cafeterias: 1 };
type Props = Partial<React.ComponentProps<typeof SchoolStudents>>;
const render = (p: Props = {}) => renderToStaticMarkup(<SchoolStudents data={data()} students={[student(1), student(2)]} query="" status="" location="" grade="" paged={false} walletRead actorId={id} counts={counts} {...p} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const commercial = /ventas|ticket|efectivo|producto|cajer|reembolso|compr[oó]|gast[oó]|saldo/i;

describe("Estudiantes roster", () => {
  it("header with school context and the two real actions, Crear estudiante primary", () => {
    const html = render();
    expect(html).toMatch(/<h1[^>]*>Estudiantes<\/h1>/); expect(html).toContain("Colegio Ficticio Atlántico · 12 activos de 14");
    expect(html).toMatch(/class="btn-secondary"[^>]*>Importar CSV<\/button><button type="button" class="btn"[^>]*>Crear estudiante<\/button>/);
  });
  it("search first, status chips with the school's counts, campus/grade only when they exist", () => {
    const html = render();
    expect(html).toContain('role="search" aria-label="Filtros de estudiantes"'); expect(html).toContain('placeholder="Buscar por nombre o código"');
    expect(text(html)).toMatch(/Todos 14 Activos 12 Suspendidos 1 Inactivos 1/);
    expect(html).not.toContain("Más filtros");
    const multi = render({ data: data({ locations: [{ id: L1, name: "Sede Santiago" }, { id: L2, name: "Sede Tamboril" }], grades: ["4to", "5to"] }) });
    expect(multi).toContain("Más filtros"); expect(multi).toContain("Todos los campus"); expect(multi).toContain("Todos los grados"); expect(multi).toContain("4to · A · Sede Santiago");
  });
  it("status chips hide empty states, mark the current one and keep the other filters", () => {
    const html = render({ counts: { ...counts, suspended: 0, inactive: 0 }, status: "active", query: "Luna" });
    expect(text(html)).not.toContain("Suspendidos"); expect(text(html)).not.toContain("Inactivos");
    expect(html).toMatch(/href="[^"]*status=active[^"]*" class="stu-chip" aria-current="page">Activos/);
    expect(html).toMatch(/href="[^"]*q=Luna&amp;status=&amp;[^"]*" class="stu-chip">Todos/); // chips keep the search
    expect(html).toContain('value="active"'); expect(html).toContain("con estos filtros"); expect(html).toContain("Limpiar filtros");
  });
  it("one row per student: the name opens the profile, one utility for PIKAS Cash, status as text", () => {
    const html = render({ students: [student(1), student(2, { status: "suspended" }), student(3, { status: "inactive", enrollment: null })] });
    expect(html.match(/class="stu-name"/g)).toHaveLength(3); expect(html).toContain('aria-label="Ver perfil de Estudiante Ficticio 2"');
    expect(html).toMatch(/data-status="suspended">Suspendido</); expect(html).toMatch(/data-status="inactive">Inactivo</); expect(html).toContain("Sin matrícula activa");
    expect(html.match(/>PIKAS Cash<span class="sr-only"> de /g)).toHaveLength(3);
    expect(html).not.toContain('class="btn-secondary" aria-label="Ver perfil');
  });
  it("without wallet authority: no PIKAS Cash links and no empty slot", () => {
    const html = render({ walletRead: false });
    expect(html).not.toContain("PIKAS Cash"); expect(html).not.toContain("/pikas-cash");
  });
  it("zero students: invitation with both real actions; no tools, chips or export", () => {
    const html = render({ students: [], counts: { students: 0, active: 0, suspended: 0, inactive: 0, cafeterias: 0 } });
    expect(html).toContain("Aún no hay estudiantes en este colegio."); expect(html.match(/>Crear estudiante<\/button>/g)?.length).toBe(2); expect(html.match(/>Importar CSV<\/button>/g)?.length).toBe(2);
    expect(html).not.toContain("Filtros de estudiantes"); expect(html).not.toContain("Exportar estudiantes"); expect(html).not.toContain("0 activos de 0");
  });
  it("no search results is distinct from an empty school", () => {
    const html = render({ students: [], query: "Zzz" });
    expect(html).toContain("No encontramos estudiantes con estos filtros."); expect(html).not.toContain("Aún no hay estudiantes");
  });
  it("many students and long names: wrap, no internal IDs or commercial data in visible text", () => {
    const many = Array.from({ length: 50 }, (_, i) => student(i + 1, i === 0 ? { display_name: "Estudiante Ficticia con un Nombre Extraordinariamente Largo de Santiago de los Caballeros" } : {}));
    const html = render({ students: many, data: data({ next_cursor: id }) });
    expect(html.match(/<li [^>]*data-status=/g)).toHaveLength(50); expect(html).toContain("Siguiente página"); expect(html).toContain("50 estudiantes en esta página");
    const visible = text(html);
    expect(visible).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); expect(visible.replace(/PIKAS Cash/g, "")).not.toMatch(commercial);
  });
});
