import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerHeading, CustomerHierarchy, ReadFailure } from "./console-views";
import { customerOverviewSchema } from "../../lib/platform/customer-contracts";
(globalThis as { React?: typeof React }).React = React;
const id = "00000000-0000-4000-8000-000000000001";
const entity = (name: string) => ({ id, name, code: name.toUpperCase(), status: "active" });
describe("authoritative customer presentation", () => {
  it("renders names, hierarchy and statuses without raw IDs or technical contracts", () => {
    const customer = customerOverviewSchema.parse({ account: entity("Cliente"), tenant_kind: "customer", schools: [{ ...entity("Escuela"), business_timezone: "America/Santo_Domingo", locations: [{ ...entity("Ubicación"), cafeterias: [entity("Cafetería")] }] }], administrators: [], administrator_intents: [], customer_admin_onboarding: [] });
    const html = renderToStaticMarkup(<CustomerHierarchy customer={customer} />);
    for (const name of ["Escuela", "Ubicación", "Cafetería", "Activo"]) expect(html).toContain(name);
    expect(html).not.toContain(id); expect(html).not.toContain("platform:"); expect(html).not.toContain("RPC");
  });
  it("clearly differentiates sandbox from real customers", () => {
    const html = renderToStaticMarkup(<CustomerHeading name="Horizonte" code="H" status="active" kind="sandbox" />);
    expect(html).toContain("Sandbox · Demostración"); expect(html).toContain("Horizonte");
  });
  it("handles empty hierarchy and read failures honestly", () => {
    const customer = customerOverviewSchema.parse({ account: entity("Cliente"), tenant_kind: "customer", schools: [], administrators: [], administrator_intents: [], customer_admin_onboarding: [] });
    expect(renderToStaticMarkup(<CustomerHierarchy customer={customer} />)).toContain("No hay escuelas registradas");
    expect(renderToStaticMarkup(<ReadFailure kind="forbidden" />)).toContain("No tienes permiso");
    expect(renderToStaticMarkup(<ReadFailure kind="unavailable" />)).toContain("No pudimos cargar");
  });
});
