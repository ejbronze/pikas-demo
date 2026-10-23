import { describe, expect, it } from "vitest";
import { demoLabSchema, firstName, isResetRejection, personaRole, resetMessages, resetRejections, resetRequestSchema, resetResultSchema, sandboxReadiness, type DemoSandbox } from "./demo-lab";

// Demo Lab contracts: the authoritative read, the reset request/result and the persona vocabulary.
const id = (n: number) => `7c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
export const sandbox = (over: Partial<DemoSandbox> = {}): DemoSandbox => ({
  account_id: id(1), name: "Colegio Horizonte", code: "COLEGIO-HORIZONTE", status: "active", baseline: "horizonte-v1",
  school: { school_id: id(2), name: "Colegio Horizonte", status: "active" },
  locations: [{ location_id: id(3), name: "Campus principal", status: "active", cafeterias: [{ cafeteria_id: id(4), name: "Cafetería Escolar", status: "active",
    registers: [{ register_id: id(5), name: "Caja demo Horizonte", code: "HZ-01", status: "active" }], products: 6, staff: 1, purchases: 0, open_sessions: 0 }] }],
  students: 4, eligible_students: 4,
  personas: [
    { persona_id: id(21), pov_code: "school_admin", display_name: "María Carey", school_id: id(2), cafeteria_id: id(4), cafeteria_name: "Cafetería Escolar", location_name: "Campus principal", membership_status: "active", valid: true, registers: [] },
    { persona_id: id(22), pov_code: "cafeteria_admin", display_name: "Bruno Mars", school_id: id(2), cafeteria_id: id(4), cafeteria_name: "Cafetería Escolar", location_name: "Campus principal", membership_status: "active", valid: true, registers: [] },
    { persona_id: id(23), pov_code: "cashier", display_name: "José Ramírez", school_id: id(2), cafeteria_id: id(4), cafeteria_name: "Cafetería Escolar", location_name: "Campus principal", membership_status: "active", valid: true, registers: ["Caja demo Horizonte"] },
  ],
  sandbox_staff: [], last_reset: null, last_entered: null, ...over,
});
describe("Demo Lab contracts", () => {
  it("parses the read and refuses an unexpected shape", () => {
    expect(demoLabSchema.safeParse({ can_reset: true, active: null, sandboxes: [sandbox()] }).success).toBe(true);
    expect(demoLabSchema.safeParse({ can_reset: "yes", sandboxes: [] }).success).toBe(false);
    expect(resetRequestSchema.safeParse({ accountId: id(1), force: true }).success).toBe(false);
    expect(resetResultSchema.safeParse({ request_id: id(9), account_id: id(1), baseline: "horizonte-v1", deleted: { purchases: 1 }, seeded: { students: 4 }, auth_user_ids: [], reset_at: "2026-10-23T12:00:00Z" }).success).toBe(true);
  });
  it("readiness: ready only with an active cafetería, an active caja, products, eligible students and valid personas", () => {
    expect(sandboxReadiness(sandbox())).toEqual({ ready: true, label: "Listo para demostrar" });
    const s = sandbox(); s.personas[2] = { ...s.personas[2], valid: false };
    expect(sandboxReadiness(s).label).toBe("Personas no disponibles");
    expect(sandboxReadiness(sandbox({ eligible_students: 0 })).label).toBe("En configuración");
    expect(sandboxReadiness(sandbox({ status: "suspended" })).ready).toBe(false);
  });
  it("vocabulary: every POV has a role, an experience and a first name for the button; every rejection has a message", () => {
    for (const code of ["school_admin", "cafeteria_admin", "cashier"] as const) { expect(personaRole[code].role).toBeTruthy(); expect(personaRole[code].experience).toBeTruthy(); }
    expect(firstName("María Carey")).toBe("María"); expect(firstName("José Ramírez")).toBe("José");
    for (const code of resetRejections) { expect(isResetRejection(code)).toBe(true); expect(resetMessages[code]).toBeTruthy(); }
    expect(isResetRejection("purchase_financial_history_is_immutable")).toBe(false);
  });
});
