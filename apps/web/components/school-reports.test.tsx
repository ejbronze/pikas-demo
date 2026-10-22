import React from "react";
import { describe, expect, it } from "vitest";
(globalThis as { React?: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { BarList, ReportHeader } from "./report-frame";
import { ServiceReportBody, StudentsReportBody } from "./school-reports";
import { SchoolWalletReport } from "./school-wallet-report";
import { walletReport } from "../lib/school/report-fixtures";
import type { WalletReportView } from "../lib/school/wallet-report";

const school = "4d800000-0000-4000-8000-000000000001";
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const view = (over: Record<string, unknown> = {}, movements: Record<string, unknown> = {}) => { const { cafeterias, ...r } = walletReport(over); void cafeterias; return { ...r, movements: { ...r.movements, ...movements } } as unknown as WalletReportView; };
const empty = { rows: [], counts: { total: 0, active: 0, suspended: 0, inactive: 0 }, byGrade: [], locations: [], grades: [] };
const st = (code: string, grade: string | null) => ({ student_code: code, first_name: "A", last_name: "B", display_name: `Estudiante ${code}`, status: "active" as const, campus: null, grade, class: null, homeroom: null });

describe("report frame", () => {
  it("header: name, scope, active filters, generated date for print, output actions hidden in print", () => {
    const h = renderToStaticMarkup(<ReportHeader back={{ href: "/r", label: "Reportes" }} title="Estudiantes" scope="Colegio Ficticio" purpose="P" filters={[{ label: "Estado", value: "Activo" }]} generated="21 oct 2026" csvHref="/r/csv?x=1" />);
    expect(text(h)).toMatch(/Reportes Estudiantes Colegio Ficticio .*Exportar CSV .*Imprimir/); expect(h).toContain('class="rpt-generated"'); expect(h).toContain('download=""');
    expect(h).toMatch(/<h1 class="rpt-title">Estudiantes<\/h1>/); expect(h).toContain('class="rpt-actions"');
  });
  it("bars write each count out; links only where a filter exists", () => {
    const h = renderToStaticMarkup(<BarList label="Por grado" unit={["estudiante", "estudiantes"]} items={[{ key: "a", label: "4to", count: 1, href: "/r?grade=4to" }, { key: "", label: "Sin grado asignado", count: 3 }]} />);
    expect(text(h)).toMatch(/4to .*1 estudiante .*Sin grado asignado .*3 estudiantes/); expect(h.match(/<a /g)).toHaveLength(1); expect(h).toContain('aria-label="4to: 1 estudiante. Ver solo este grupo"');
  });
});
describe("School report bodies: low data", () => {
  it("Estudiantes: no students vs nothing matching; one grade draws no chart", () => {
    expect(text(renderToStaticMarkup(<StudentsReportBody schoolId={school} filters={{ status: "", location: null, grade: null }} report={empty} />))).toContain("Aún no hay estudiantes en este colegio");
    expect(text(renderToStaticMarkup(<StudentsReportBody schoolId={school} filters={{ status: "inactive", location: null, grade: null }} report={empty} />))).toContain("Ningún estudiante coincide");
    const one = renderToStaticMarkup(<StudentsReportBody schoolId={school} filters={{ status: "", location: null, grade: null }} report={{ ...empty, rows: [st("E1", "4to")], counts: { total: 1, active: 1, suspended: 0, inactive: 0 }, byGrade: [{ grade: "4to", count: 1 }] }} />);
    expect(one).not.toContain("rpt-bars"); expect(one).toContain(`href="/admin/escuela/estudiantes?school=${school}&amp;q=E1"`);
  });
  it("PIKAS Cash: an empty period says so; the table's lines and net movement are the server's", () => {
    expect(text(renderToStaticMarkup(<SchoolWalletReport report={view({}, { entry_count: 0, wallets_with_movement: 0 })} />))).toContain("Sin movimientos de PIKAS Cash en este período");
    const t = text(renderToStaticMarkup(<SchoolWalletReport report={view()} />));
    expect(t).toMatch(/Recargas 3 \+RD\$ 225\.00 .*Reversiones de recarga 1 −RD\$ 25\.00 .*Recargas netas — \+RD\$ 200\.00 .*Compras con PIKAS Cash 2 −RD\$ 115\.00/);
    expect(t).toMatch(/Movimiento neto del período 10 \+RD\$ 134\.00/); expect(t).toContain("No depende del período"); expect(t).not.toContain("Ajustes históricos");
  });
  it("Cafeterías: none yet", () => {
    expect(text(renderToStaticMarkup(<ServiceReportBody rows={[]} />))).toContain("Ninguna cafetería atiende todavía a este colegio");
  });
});
