import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReconciliationDifference } from "./reconciliation-difference";
(globalThis as { React?: typeof React }).React = React;
it.each([["2500", "Sobrante", "+RD$"], ["-2500", "Faltante", "−RD$"], ["0", "Cuadrada", "Cuadrada"]])("discrepancy %s communicates meaning and sign", (minor, label, sign) => {
 const html = renderToStaticMarkup(<ReconciliationDifference minor={minor} />); expect(html).toContain(label); expect(html).toContain(sign);
});
