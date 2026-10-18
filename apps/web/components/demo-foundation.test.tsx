import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DemoWorkspace } from "./demo-workspace";
import { ReconciliationDifference } from "./reconciliation-difference";
(globalThis as { React?: typeof React }).React = React;
it("groups available experiences and keeps future personas inert", () => {
 const html = renderToStaticMarkup(<DemoWorkspace state={{ kind: "targets", targets: [] }} available={["school_admin", "cafeteria_admin", "cashier"]} />);
 for (const label of ["Administración", "Operaciones", "Experiencias", "Explorar Escuela", "Explorar Cafetería", "Explorar Caja / POS", "Padre", "Estudiante"]) expect(html).toContain(label);
 expect(html.match(/Próximamente/g)).toHaveLength(2); expect(html).not.toContain('href="/familias'); expect(html).not.toMatch(/<button[^>]*>Padre/);
});
it.each([["2500", "Sobrante", "+RD$"], ["-2500", "Faltante", "−RD$"], ["0", "Cuadrada", "Cuadrada"]])("discrepancy %s communicates meaning and sign", (minor, label, sign) => {
 const html = renderToStaticMarkup(<ReconciliationDifference minor={minor} />); expect(html).toContain(label); expect(html).toContain(sign);
});
