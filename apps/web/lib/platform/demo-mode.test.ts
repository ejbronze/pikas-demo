import { describe, expect, it } from "vitest";
import { DEMO_CONFLICT_PATH, demoConflictHref, isDemoRoute, platformReturnTarget } from "./demo-mode";

describe("UX 11 return-target validation", () => {
  it.each([
    "/platform", "/platform/clientes", "/platform/clientes/4d400000-0000-4000-8000-000000000001/gestion/cafeterias/4d400000-0000-4000-8000-000000000002?seccion=cajas",
    "/platform/finanzas?vista=historial&estado=rechazadas", "/platform/identidades", "/platform?x=1",
  ])("keeps the internal Platform route %s", (next) => expect(platformReturnTarget(next)).toBe(next));
  it.each([
    ["external", "https://evil.invalid/platform"], ["protocol-relative", "//evil.invalid/platform"], ["scheme-like", "/platform//evil.invalid"],
    ["other area", "/admin/escuela"], ["tenant", "/pos"], ["prefix trick", "/platformx/clientes"], ["dot segment", "/platform/../admin"],
    ["Demo route", "/platform/demostracion"], ["conflict route", "/platform/demostracion/salir?next=/platform/clientes"],
    ["whitespace", "/platform/clientes\n/evil"], ["backslash", "/platform\\evil.invalid"], ["missing", null], ["array", ["/platform/clientes"]], ["too long", "/platform/" + "a".repeat(600)],
  ])("falls back to the Platform home for %s", (_label, next) => expect(platformReturnTarget(next)).toBe("/platform"));
  it("builds the conflict link with the validated route only", () => {
    expect(demoConflictHref("/platform/clientes?q=x")).toBe(`${DEMO_CONFLICT_PATH}?next=${encodeURIComponent("/platform/clientes?q=x")}`);
    expect(demoConflictHref("https://evil.invalid")).toBe(DEMO_CONFLICT_PATH);
    expect(demoConflictHref("/platform")).toBe(DEMO_CONFLICT_PATH);
  });
  it("names the routes that stay reachable in Demo", () => {
    expect(isDemoRoute("/platform/demostracion")).toBe(true); expect(isDemoRoute("/platform/demostracion/salir")).toBe(true);
    expect(isDemoRoute("/platform/demostracionx")).toBe(false); expect(isDemoRoute("/platform/clientes")).toBe(false);
  });
});
