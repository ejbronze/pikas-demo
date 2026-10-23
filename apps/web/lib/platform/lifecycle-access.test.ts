import { describe, expect, it } from "vitest";
import { assignmentRequestSchema, isLifecycleAccessRejection, lifecycleAccessMessages, lifecycleRejections, membershipConsequences, membershipStatusRequestSchema, membershipTransitions, posAccessRequestSchema, structureConsequences, structureStatusRequestSchema, structureTransitions } from "./lifecycle-access";

// Lifecycle & Access Management vocabulary: Suspender (temporary, reversible), Desactivar (kept,
// unavailable), Reactivar. Never "Eliminar"; no "Archivar" for sedes, cafeterías, cajas or accesses.
const id = "7a000000-0000-4000-8000-000000000001";
describe("lifecycle & access contracts", () => {
  it("sede: Desactivar/Reactivar only; cafetería: Suspender, Desactivar, Reactivar; nothing is ever deleted", () => {
    expect(structureTransitions("location", "active").map(t => t.label)).toEqual(["Desactivar sede"]);
    expect(structureTransitions("location", "inactive").map(t => t.label)).toEqual(["Reactivar sede"]);
    expect(structureTransitions("cafeteria", "active").map(t => t.label)).toEqual(["Suspender cafetería", "Desactivar cafetería"]);
    expect(structureTransitions("cafeteria", "suspended").map(t => t.label)).toEqual(["Reactivar cafetería", "Desactivar cafetería"]);
    expect(structureTransitions("cafeteria", "inactive").map(t => t.label)).toEqual(["Reactivar cafetería"]);
    for (const kind of ["location", "cafeteria"] as const) for (const s of ["active", "suspended", "inactive"] as const) {
      const text = structureConsequences(kind, "Cafetería Santiago", s).join(" ");
      expect(text).not.toMatch(/elimina(?!\.)|borra|Archivar/i); expect(text).toMatch(/Nada se (elimina|recrea)/);
    }
    expect(structureConsequences("location", "Sede Norte", "inactive").join(" ")).toContain("Todas las cafeterías de Sede Norte dejan de estar disponibles");
    expect(structureConsequences("cafeteria", "Cafetería Santiago", "suspended").join(" ")).toContain("Es temporal y reversible");
    expect(structureConsequences("cafeteria", "Cafetería Santiago", "inactive").join(" ")).toContain("la sede debe estar activa para reactivar una cafetería");
  });
  it("accesses: scope-named actions, consequences name what stops, what remains and reversibility; the login is untouched", () => {
    expect(membershipTransitions("active").map(t => t.label("Cafetería Santiago"))).toEqual(["Suspender acceso a Cafetería Santiago", "Desactivar acceso a Cafetería Santiago"]);
    expect(membershipTransitions("suspended").map(t => t.label("Colegio Ficticio"))).toEqual(["Reactivar acceso a Colegio Ficticio", "Desactivar acceso a Colegio Ficticio"]);
    expect(membershipTransitions("inactive").map(t => t.label("X"))).toEqual(["Reactivar acceso a X"]);
    const pos = membershipConsequences("Cafetería Santiago", "suspended", true).join(" ");
    expect(pos).toContain("temporalmente"); expect(pos).toContain("no podrá abrir cajas ni vender allí"); expect(pos).toContain("su inicio de sesión en PIKAS y sus accesos en otros lugares no cambian"); expect(pos).toContain("Es temporal y reversible");
    expect(membershipConsequences("Colegio", "inactive", false).join(" ")).toContain("La persona sigue existiendo en PIKAS");
    expect(membershipConsequences("Cafetería", "active", true).join(" ")).toContain("Requiere un inicio de sesión activo y confirmado");
  });
  it("requests: reason 3..500 for lifecycle changes, strict shapes, POS roles only for cross-cafetería access", () => {
    const base = { accountId: id, kind: "cafeteria", targetId: id, expectedStatus: "active", status: "suspended" } as const;
    expect(structureStatusRequestSchema.safeParse({ ...base, reason: "ok" }).success).toBe(false);
    expect(structureStatusRequestSchema.safeParse({ ...base, reason: "Obra en la sede" }).success).toBe(true);
    expect(structureStatusRequestSchema.safeParse({ ...base, reason: "x".repeat(501) }).success).toBe(false);
    expect(structureStatusRequestSchema.safeParse({ ...base, kind: "register", reason: "Obra" }).success).toBe(false);
    expect(membershipStatusRequestSchema.safeParse({ accountId: id, scope: "cafeteria", membershipId: id, expectedStatus: "active", status: "inactive", reason: "Dejó el puesto" }).success).toBe(true);
    expect(membershipStatusRequestSchema.safeParse({ accountId: id, scope: "account", membershipId: id, expectedStatus: "active", status: "inactive", reason: "Dejó el puesto" }).success).toBe(false);
    expect(posAccessRequestSchema.safeParse({ accountId: id, personId: id, cafeteriaId: id, roleCode: "pos_cashier" }).success).toBe(true);
    expect(posAccessRequestSchema.safeParse({ accountId: id, personId: id, cafeteriaId: id, roleCode: "cafeteria_admin" }).success).toBe(false);
    expect(posAccessRequestSchema.safeParse({ accountId: id, personId: id, cafeteriaId: id, roleCode: "pos_cashier", username: "x" }).success).toBe(false);
    expect(assignmentRequestSchema.safeParse({ accountId: id, cafeteriaId: id, membershipId: id, registerId: id, status: "inactive" }).success).toBe(true);
    expect(assignmentRequestSchema.safeParse({ accountId: id, cafeteriaId: id, membershipId: id, registerId: id, status: "archived" }).success).toBe(false);
  });
  it("every named rejection has an operator message; unknown codes are not rejections", () => {
    for (const code of lifecycleRejections) { expect(isLifecycleAccessRejection(code)).toBe(true); expect(lifecycleAccessMessages[code]).toBeTruthy(); }
    expect(isLifecycleAccessRejection("platform_request_conflict")).toBe(false); expect(isLifecycleAccessRejection(null)).toBe(false);
  });
});
