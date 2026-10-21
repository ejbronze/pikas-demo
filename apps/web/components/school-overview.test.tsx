import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({ default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
// eslint-disable-next-line @next/next/no-img-element
vi.mock("next/image", () => ({ default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} /> }));
(globalThis as { React?: typeof React }).React = React;
import { SchoolOverview } from "./school-overview";
import { inputs, readData, schoolId, service, wallet } from "../lib/school/overview-fixtures";
import type { OverviewInputs } from "../lib/school/overview";

const render = (o: OverviewInputs, data = readData) => renderToStaticMarkup(<SchoolOverview data={data} overview={o} />);
const figures = (html: string) => [...html.matchAll(/<dt>([^<]+)<\/dt>/g)].map(m => m[1]);
// Cafetería Hoy vocabulary that must never reach a School Admin.
const commercial = /ventas|venta de|ticket|efectivo|cr[eé]dito de personal|m[aá]s vendido|producto|cajas? |cajer|faltante|sobrante|reembolso|ingresos|crecimiento/i;

describe("School Overview", () => {
  it("students first, wallet aggregates with explicit period, service status, cafeterías as relationships", () => {
    const html = render(inputs());
    expect(html).toMatch(/<h1[^>]*>Resumen<\/h1>/); expect(html).toContain("Colegio Ficticio Atlántico");
    expect(figures(html)).toEqual(["Estudiantes activos", "Con PIKAS Cash", "Monederos con movimiento", "Saldo de estudiantes"]);
    expect(html).toContain(">412<"); expect(html).toContain("6 suspendidos"); expect(html).toContain("RD$ 214,380.00");
    expect(html).toContain("monederos con recargas, compras o ajustes · 15/10 al 21/10");
    expect(html).toContain("Listo para atender estudiantes"); expect(html).toContain("Todo en orden");
    expect(html).toContain("Cafeterías que atienden al colegio"); expect(html).toContain("Compartición activa"); expect(html).toContain("114 estudiantes habilitados");
    expect(html).not.toContain(`href="/admin/escuela/pikas-cash?school=${schoolId}"`); // in the bottom bar and sidebar already
    expect(html).toMatch(/<nav aria-label="Más secciones del colegio" class="sch-next md:hidden">.*Cafeterías conectadas.*Actividad.*<\/nav>/);
    expect(html).not.toMatch(/Usaron PIKAS Cash|Compradores|Estudiantes que compraron/);
    expect(html.replace(/PIKAS Cash/g, "")).not.toMatch(commercial);
  });
  it("without wallet authority: no wallet figures, no balance, no PIKAS Cash link, and no empty slots", () => {
    const html = render(inputs({ wallet: null }));
    expect(figures(html)).toEqual(["Estudiantes activos"]); expect(html).not.toContain("RD$"); expect(html).not.toContain("PIKAS Cash");
    expect(html).not.toContain("monedero"); expect(html).toContain("No hay invitaciones vencidas, comparticiones pendientes.");
    expect(html).not.toContain("Más secciones del colegio"); // five destinations: the bottom bar shows them all
  });
  it("new / low-data school: explanatory empty states instead of a wall of zeros", () => {
    const html = render(inputs({ counts: { students: 0, active: 0, suspended: 0, inactive: 0, cafeterias: 0 }, cafeterias: [], wallet: wallet({ active_wallets: 0, total_balance_minor: "0", wallets_with_movement: 0 }) }));
    expect(html).toContain("Aún no hay estudiantes en este colegio."); expect(html).not.toContain("RD$ 0.00"); expect(figures(html)).toEqual([]);
    expect(html).toContain("Todavía no hay cafeterías en este colegio."); expect(html).toContain("Servicio a estudiantes"); expect(html.match(/data-done="false"/g)).toHaveLength(3);
  });
  it("one cafetería without active sharing is stated, and attention links to the place to act", () => {
    const html = render(inputs({ cafeterias: [service(1, { sharing: false })], invitations: [{ status: "expired" }] }));
    expect(html).toContain("Ninguna cafetería tiene compartición activa con el colegio todavía."); expect(html).toContain("Sin compartición activa");
    expect(html).toContain("Requiere atención · 2"); expect(html).toMatch(new RegExp(`href="/admin/escuela/administradores\\?school=${schoolId}" class="sch-action">Ver administradores`));
    expect(html).toMatch(new RegExp(`href="/admin/escuela/cafeterias\\?school=${schoolId}" class="sch-action">Revisar cafetería<`));
  });
  it("without the sharing read, the cafeterías and service sections are simply absent", () => {
    const html = render(inputs({ cafeterias: null }));
    expect(html).not.toContain("Cafeterías que atienden"); expect(html).not.toContain("Servicio a estudiantes"); expect(html).not.toContain("Cafeterías conectadas");
  });
  it("long names wrap and no student is named or ranked", () => {
    const html = render(inputs({ cafeterias: [service(1, { name: "Cafetería Bilingüe Ficticia Internacional de Santiago de los Caballeros", enabled_capped: true, enabled_students: 100 })] }),
      { ...readData, scope: { ...readData.scope, school_name: "Colegio Bilingüe Ficticio Internacional de Santiago de los Caballeros" } });
    expect(html).toContain("break-words"); expect(html).toContain("100 o más estudiantes habilitados");
    expect(html).not.toMatch(/Estudiante \d|ranking|más compr/i);
  });
});
