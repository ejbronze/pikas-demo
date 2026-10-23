import { describe, expect, it } from "vitest";
import { attentionItems, completeCount, launchStatus, networkSummary, nextStep, readinessSchema, readinessSteps, type Step } from "./readiness";
import { readinessFixture as fx, request } from "./readiness-fixtures";

const state = (steps: Step[], key: Step["key"]) => steps.find(s => s.key === key)!;
// A customer shaped like CEPOINT today: 1 colegio / sede / cafetería, no caja, nobody active,
// a pending initial-administrator request whose activation link expired unused. Not hardcoded.
const cepointLike = () => fx(1, "empty", { administrators: { active: 0, requests: [request({ link_state: "expired" })] } });

describe("readiness contract", () => {
  it("accepts the read and refuses unknown fields", () => {
    expect(readinessSchema.safeParse({ customers: [fx(1)], sandbox: [], truncated: false }).success).toBe(true);
    expect(readinessSchema.safeParse({ customers: [{ ...fx(1), total_minor: "1" }], sandbox: [], truncated: false }).success).toBe(true); // object() strips; values never rendered
    expect(readinessSchema.safeParse({ customers: [{ ...fx(1), products: { available: -1 } }], sandbox: [], truncated: false }).success).toBe(false);
  });
});

describe("UX 13 step owners", () => {
  it("provisioning steps belong to PIKAS; staff, cajas, products and the first sale belong to the cafetería", () => {
    expect(readinessSteps(fx(1, "empty")).map(s => [s.key, s.owner])).toEqual([["perfil", "PIKAS"], ["estructura", "PIKAS"], ["administrador", "PIKAS"], ["personal", "cafetería"], ["cajas", "cafetería"], ["productos", "cafetería"], ["venta", "cafetería"]]);
  });
});

describe("step rules", () => {
  it("almost-empty customer: profile and structure complete, everything else pending or attention", () => {
    const steps = readinessSteps(fx(1, "empty"));
    expect(steps.map(s => [s.key, s.state])).toEqual([["perfil", "complete"], ["estructura", "complete"], ["administrador", "attention"], ["personal", "pending"], ["cajas", "pending"], ["productos", "pending"], ["venta", "pending"]]);
    expect(state(steps, "administrador").detail).toBe("Sin administrador ni solicitud de acceso.");
    expect(completeCount(steps)).toBe(2); expect(nextStep(steps)?.key).toBe("administrador");
  });
  it("CEPOINT-like state needs attention for the expired activation and shows no caja", () => {
    const steps = readinessSteps(cepointLike());
    expect(state(steps, "administrador")).toMatchObject({ state: "attention", detail: "El enlace de activación venció sin usarse. Genera uno nuevo." });
    expect(state(steps, "personal").state).toBe("pending"); expect(state(steps, "cajas").detail).toBe("Crea la primera caja.");
    expect(launchStatus(cepointLike())).toBe("configuring");
  });
  it("administrator states: active completes; expired request needs attention; pending states explain", () => {
    expect(state(readinessSteps(fx(1, "empty", { administrators: { active: 1, requests: [request({ request_expired: true })] } })), "administrador").state).toBe("complete");
    expect(state(readinessSteps(fx(1, "empty", { administrators: { active: 0, requests: [request({ request_expired: true })] } })), "administrador")).toMatchObject({ state: "attention", detail: "La solicitud de administrador venció. Prepara una nueva." });
    expect(state(readinessSteps(fx(1, "empty", { administrators: { active: 0, requests: [request({ identity_state: "ready", link_state: "expired" })] } })), "administrador").state).toBe("pending");
    expect(state(readinessSteps(fx(1, "empty", { administrators: { active: 0, requests: [request({ link_state: "active" })] } })), "administrador").detail).toContain("esperando que la persona lo use");
    expect(state(readinessSteps(fx(1, "empty", { administrators: { active: 0, requests: [request()] } })), "administrador")).toMatchObject({ state: "pending", detail: "Acceso preparado: falta generar el enlace de activación." });
  });
  it("cajas need an assigned active POS member; staff invitations are explained, expired ones need attention", () => {
    expect(state(readinessSteps(fx(1, "configured", { registers: { active: 2, staffed: 0 } })), "cajas")).toMatchObject({ state: "pending", detail: "Hay cajas, pero ninguna tiene personal de caja asignado." });
    expect(state(readinessSteps(fx(1, "empty", { staff: { pending_invitations: 2 } })), "personal").detail).toBe("2 invitaciones esperando activación.");
    expect(state(readinessSteps(fx(1, "empty", { staff: { expired_invitations: 1 } })), "personal").state).toBe("attention");
  });
  it("products absent / present, and optional profile fields never block", () => {
    expect(state(readinessSteps(fx(1, "configured", { products: { available: 0 } })), "productos").state).toBe("pending");
    expect(state(readinessSteps(fx(1)), "productos").detail).toBe("12 productos disponibles");
    expect(state(readinessSteps(fx(1, "configured", { profile: { missing_tax_id: 1, missing_province: 1 } })), "perfil")).toMatchObject({ state: "complete", detail: "Colegio registrado. RNC, dirección o provincia sin registrar (opcional)." });
    expect(state(readinessSteps(fx(1, "configured", { structure: { operating_cafeterias: 0, first_cafeteria_id: null } })), "cajas").action?.href).toBe("/platform/clientes/7e00d000-0000-4000-8000-000000000001?seccion=estructura#estructura");
  });
  it("links go to existing controls; the caja and product links open the first operating cafetería", () => {
    const steps = readinessSteps(fx(1));
    expect(state(steps, "administrador").action?.href).toBe("/platform/clientes/7e00d000-0000-4000-8000-000000000001?seccion=personas#administrador-inicial");
    expect(state(steps, "personal").action?.href).toBe("/platform/clientes/7e00d000-0000-4000-8000-000000000001?seccion=personas#customer-access");
    expect(state(steps, "cajas").action?.href).toBe("/platform/clientes/7e00d000-0000-4000-8000-000000000001/gestion/cafeterias/7e00d000-0000-4000-8000-000000000101?seccion=cajas");
    expect(state(steps, "venta").action).toBeNull();
  });
});

describe("launch status", () => {
  it("configured without a sale is ready; first sale is operating; lifecycle is separate", () => {
    expect(launchStatus(fx(1))).toBe("ready");
    expect(state(readinessSteps(fx(1)), "venta").state).toBe("pending");
    const sold = fx(1, "configured", { sales: { first_at: "2026-10-17T14:00:00Z", last_at: "2026-10-20T14:00:00Z" } });
    expect(launchStatus(sold)).toBe("operating"); expect(completeCount(readinessSteps(sold))).toBe(7);
    expect(state(readinessSteps(sold), "venta").detail).toMatch(/^Primera venta el /);
    expect(launchStatus(fx(1, "configured", { status: "suspended" }))).toBe("inactive");
  });
});

describe("network summary and attention", () => {
  it("counts active customers by launch status and leaves suspended/closed out", () => {
    const sold = fx(3, "configured", { sales: { first_at: "2026-10-17T14:00:00Z", last_at: "2026-10-17T14:00:00Z" } });
    expect(networkSummary([cepointLike(), fx(2), sold, fx(4, "empty", { status: "closed" })])).toEqual({ active: 3, configuring: 1, ready: 1, operating: 1, inactive: 1 });
    expect(networkSummary([])).toEqual({ active: 0, configuring: 0, ready: 0, operating: 0, inactive: 0 });
  });
  it("one item per active customer with open steps; attention leads, ready and operating-complete customers are calm", () => {
    const items = attentionItems([fx(2, "empty", { name: "Academia Ficticia", administrators: { active: 1, requests: [] } }), cepointLike(), fx(3), fx(4, "empty", { status: "suspended" })]);
    expect(items.map(i => [i.customer.name, i.severity, i.step.key])).toEqual([["Colegio Ficticio 1", "attention", "administrador"], ["Academia Ficticia", "pending", "personal"]]);
    expect(items[0].others.map(s => s.key)).toEqual(["personal", "cajas", "productos"]);
    expect(attentionItems([fx(3), fx(5, "configured", { sales: { first_at: "2026-10-17T14:00:00Z", last_at: null } })])).toEqual([]);
  });
  it("an operating customer that lost its last staffed caja needs attention", () => {
    const items = attentionItems([fx(5, "configured", { sales: { first_at: "2026-10-17T14:00:00Z", last_at: null }, registers: { active: 1, staffed: 0 } })]);
    expect(items.map(i => i.step.key)).toEqual(["cajas"]);
  });
});
