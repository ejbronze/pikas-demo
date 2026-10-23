import { describe, expect, it } from "vitest";
import { accessState, afterChange } from "./post-change-access";

// Lifecycle & Access Management: the message after a forced password change tells the truth about the
// person's own accesses. A suspended cafetería access is never "ya puedes iniciar sesión", and a
// scoped suspension is never described as a global login suspension.
const m = (status: string, name: string, scope = "cafeteria") => ({ scope, role: "pos_cashier", status, name });
describe("post-change access", () => {
  it("organization state wins over memberships", () => {
    expect(accessState({ organization: "suspended", memberships: [m("active", "Cafetería Santiago")] }).kind).toBe("organization_suspended");
    expect(accessState({ organization: "closed", memberships: [] }).kind).toBe("organization_closed");
  });
  it("suspended before inactive, names deduplicated, none when nothing is assigned", () => {
    expect(accessState({ organization: "active", memberships: [m("inactive", "Cafetería Norte"), m("suspended", "Cafetería Santiago"), m("suspended", "Cafetería Santiago")] })).toEqual({ kind: "suspended", names: ["Cafetería Santiago"] });
    expect(accessState({ organization: "active", memberships: [m("inactive", "Cafetería Norte")] })).toEqual({ kind: "inactive", names: ["Cafetería Norte"] });
    expect(accessState({ organization: "active", memberships: [] })).toEqual({ kind: "none", names: [] });
    expect(accessState(null)).toEqual({ kind: "none", names: [] });
  });
  it("messages: scoped, truthful, never claiming the login is suspended or that everything works", () => {
    const suspended = afterChange({ kind: "suspended", names: ["Cafetería Santiago"] });
    expect(suspended).toContain("Tu acceso a Cafetería Santiago está suspendido"); expect(suspended).toContain("Tu usuario y tu contraseña siguen siendo válidos"); expect(suspended).not.toContain("Ya puedes iniciar sesión");
    expect(afterChange({ kind: "suspended", names: ["A", "B"] })).toContain("cada cafetería o colegio");
    expect(afterChange({ kind: "inactive", names: ["Cafetería Norte"] })).toContain("fue desactivado");
    expect(afterChange({ kind: "none", names: [] })).toContain("Todavía no tienes un acceso asignado");
    expect(afterChange({ kind: "organization_suspended", names: [] })).toContain("organización está suspendido");
    expect(afterChange({ kind: "organization_closed", names: [] })).toContain("cerrada");
    expect(afterChange(undefined)).toBe("Contraseña actualizada. Ya puedes iniciar sesión.");
  });
});
