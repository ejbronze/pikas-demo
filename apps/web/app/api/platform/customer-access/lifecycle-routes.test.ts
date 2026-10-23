import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lifecycle & Access Management routes: sede/cafetería status, access (membership) status, "Agregar a
// otra cafetería" (same Person, same login) and caja assignment. Capability gates, argument mapping,
// readable refusals and never trusting an unexpected result. Fictional identifiers only.
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), identity: vi.fn(), demo: vi.fn() }));
vi.mock("../../../../lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock("../../../../lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.identity }));
vi.mock("../../../../lib/auth/demo-guard", () => ({ demoMutationBlock: mocks.demo }));
// the shared Platform handler factory imports through the "@/" alias, which vitest does not resolve; mock both spellings
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.identity }));
import { POST as structure } from "../customer-structure/status/route";
import { POST as membership } from "./membership-status/route";
import { POST as posAccess } from "./pos-access/route";
import { POST as assignment } from "./assignment/route";
import { cafeteriaRead } from "../../../../lib/cafeteria/test-fixtures";

const U = (n: number) => `7b000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const key = U(1), account = U(2), person = U(3), caf = U(4), member = U(5), reg = U(6), location = U(7);
const operator = (caps: string[]) => ({ status: "ready", user: { id: "auth-user" }, person: { id: U(9), displayName: "Operador Ficticio" }, memberships: [], platform: { role: "platform_admin", roles: ["platform_admin"], capabilities: caps } });
const post = (route: (r: NextRequest) => Promise<Response>, body: unknown, k = key) => route(new NextRequest("https://pikas.test/api/x", { method: "POST",
  headers: { origin: "https://pikas.test", "Content-Type": "application/json", "Idempotency-Key": k }, body: JSON.stringify(body) }));
const calls = () => mocks.rpc.mock.calls.map(c => c[0]);
const ALL = ["platform:tenant:lifecycle:manage", "platform:customer:access:provision", "platform:customer:operations:manage"];

beforeEach(() => { vi.resetAllMocks(); mocks.identity.mockResolvedValue(operator(ALL)); mocks.demo.mockResolvedValue(null); });

describe("sede / cafetería status", () => {
  const body = { accountId: account, kind: "cafeteria", targetId: caf, expectedStatus: "active", status: "suspended", reason: "Cierre temporal por obra" };
  it("maps the request to platform_set_customer_structure_status and returns the authoritative result", async () => {
    mocks.rpc.mockResolvedValue({ data: { account_id: account, kind: "cafeteria", target_id: caf, status: "suspended", previous_status: "active" }, error: null });
    const r = await post(structure, body); expect(r.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("platform_set_customer_structure_status", { p_request_id: key, p_account_id: account, p_kind: "cafeteria", p_target_id: caf, p_expected_status: "active", p_status: "suspended", p_reason: "Cierre temporal por obra" });
    expect((await r.json()).result.status).toBe("suspended");
  });
  it("requires the lifecycle capability (provisioning and operations are not enough) and refuses Demo", async () => {
    mocks.identity.mockResolvedValue(operator(["platform:customer:access:provision", "platform:customer:operations:manage"]));
    expect((await post(structure, body)).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.identity.mockResolvedValue(operator(ALL)); mocks.demo.mockResolvedValue({ error: "demo_mode_active", status: 409 });
    const demo = await post(structure, body); expect(demo.status).toBe(409); expect(await demo.json()).toEqual({ error: "demo_mode_active" }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("a short reason, an unknown kind or a sede 'suspended' never reach the database", async () => {
    expect((await post(structure, { ...body, reason: "no" })).status).toBe(400);
    expect((await post(structure, { ...body, kind: "register" })).status).toBe(400);
    expect((await post(structure, { ...body, status: "archived" })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    // a sede is never "suspended": the contract refuses it before the database does
    expect((await post(structure, { ...body, kind: "location", targetId: location })).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { account_id: account, kind: "location", target_id: location, status: "inactive", previous_status: "active" }, error: null });
    expect((await post(structure, { ...body, kind: "location", targetId: location, status: "inactive" })).status).toBe(200);
  });
  it("definite refusals are readable 422s; stale state, open cajas and an inactive sede each keep their name", async () => {
    for (const message of ["lifecycle_state_changed", "open_register_sessions_block_lifecycle", "location_inactive", "customer_lifecycle_inactive", "lifecycle_customer_only", "invalid_lifecycle_transition"]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message } });
      const r = await post(structure, body); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: message });
    }
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "customer_access_scope_required" } });
    expect((await post(structure, body)).status).toBe(422);
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null }); expect((await post(structure, body)).status).toBe(502);
  });
});

describe("access (membership) status", () => {
  const body = { accountId: account, scope: "cafeteria", membershipId: member, expectedStatus: "active", status: "suspended", reason: "Ausencia temporal" };
  it("maps to platform_set_customer_membership_status with the provisioning capability", async () => {
    mocks.rpc.mockResolvedValue({ data: { account_id: account, scope: "cafeteria", membership_id: member, person_id: person, role_code: "pos_cashier", status: "suspended", previous_status: "active" }, error: null });
    expect((await post(membership, body)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("platform_set_customer_membership_status", { p_request_id: key, p_account_id: account, p_scope: "cafeteria", p_membership_id: member, p_expected_status: "active", p_status: "suspended", p_reason: "Ausencia temporal" });
    mocks.identity.mockResolvedValue(operator(["platform:tenant:lifecycle:manage", "platform:customer:operations:manage", "platform:identity:support"]));
    expect((await post(membership, body)).status).toBe(403);
  });
  it("account-scope accesses, missing reasons and unknown states never reach the database; refusals are named", async () => {
    expect((await post(membership, { ...body, scope: "account" })).status).toBe(400);
    expect((await post(membership, { ...body, reason: "" })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    for (const message of ["customer_provisioning_inactive", "customer_person_required", "active_confirmed_pos_identity_required", "lifecycle_state_changed"]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message } });
      const r = await post(membership, body); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: message });
    }
  });
});

describe("Agregar a otra cafetería (same Person, same login)", () => {
  const body = { accountId: account, personId: person, cafeteriaId: caf, roleCode: "pos_cashier", registerId: reg };
  const granted = { membership_id: member, person_id: person, cafeteria_id: caf, role_code: "pos_cashier", already_granted: false };
  it("grants through platform_grant_customer_pos_access, then assigns the caja with a derived key through the existing support command", async () => {
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "platform_grant_customer_pos_access" ? { data: granted, error: null } : { data: { request_id: args.p_request_id, operation: "assignment_save", target_id: reg }, error: null });
    const r = await post(posAccess, body); expect(r.status).toBe(200);
    expect(calls()).toEqual(["platform_grant_customer_pos_access", "platform_support_cafeteria_command"]);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "platform_grant_customer_pos_access", { p_request_id: key, p_account_id: account, p_person_id: person, p_cafeteria_id: caf, p_role_code: "pos_cashier" });
    const assign = mocks.rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(assign.p_operation).toBe("assignment_save"); expect(assign.p_request_id).not.toBe(key); expect(assign.p_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(assign.p_payload).toEqual({ membership_id: member, register_id: reg, status: "active", version: null });
    expect(await r.json()).toEqual({ result: { ...granted, register: { register_id: reg, assigned: true } } });
    // no new identity: no Auth, no invitation, no staff command
    expect(calls()).not.toContain("platform_customer_staff_command");
  });
  it("a refused caja never undoes the access; without operations:manage the caja is left for the cafetería", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "platform_grant_customer_pos_access" ? { data: granted, error: null } : { data: null, error: { code: "23514", message: "register_inactive" } });
    const r = await post(posAccess, body); expect(r.status).toBe(200); expect((await r.json()).result.register).toEqual({ register_id: reg, assigned: false });
    mocks.rpc.mockClear(); mocks.identity.mockResolvedValue(operator(["platform:customer:access:provision"]));
    mocks.rpc.mockResolvedValue({ data: granted, error: null });
    const noManage = await post(posAccess, body); expect(noManage.status).toBe(200); expect(calls()).toEqual(["platform_grant_customer_pos_access"]); expect((await noManage.json()).result.register).toEqual({ register_id: reg, assigned: false });
  });
  it("same customer only, POS roles only, Demo refused, replay detected, invalid results never trusted", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "customer_person_required" } });
    let r = await post(posAccess, body); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: "customer_person_required" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "customer_access_scope_required" } });
    expect((await post(posAccess, body)).status).toBe(403);
    for (const message of ["existing_membership_not_active", "inactive_cafeteria", "customer_provisioning_inactive", "active_confirmed_pos_identity_required"]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message } });
      r = await post(posAccess, body); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: message });
    }
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "platform_request_conflict" } }); expect((await post(posAccess, body)).status).toBe(409);
    mocks.rpc.mockResolvedValueOnce({ data: { membership_id: "not-a-uuid" }, error: null }); expect((await post(posAccess, body)).status).toBe(502);
    expect((await post(posAccess, { ...body, roleCode: "cafeteria_admin" })).status).toBe(400);
    expect((await post(posAccess, { ...body, username: "otra.persona" })).status).toBe(400);
    mocks.demo.mockResolvedValue({ error: "demo_mode_active", status: 409 }); mocks.rpc.mockClear();
    expect((await post(posAccess, body)).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.demo.mockResolvedValue(null); mocks.identity.mockResolvedValue(operator(["platform:customer:operations:manage", "platform:identity:support"]));
    expect((await post(posAccess, body)).status).toBe(403);
  });
});

describe("caja assignment from the person sheet", () => {
  const body = { accountId: account, cafeteriaId: caf, membershipId: member, registerId: reg, status: "inactive" };
  const read = (assignments: unknown[]) => ({ ...cafeteriaRead(), scope: { cafeteria_id: caf, cafeteria_name: "Cafetería Santiago", cafeteria_status: "active", account_id: account, account_name: "Colegio Ficticio", account_status: "active",
    school_name: "Colegio Ficticio", location_name: "Sede Norte", tenant_kind: "customer", actor_id: U(9), membership_id: null, capabilities: [], support: true },
    registers: [{ id: reg, code: "C1", name: "Caja 01", status: "active", version: 1, has_history: false, open: false }], assignments: assignments.map((a, i) => ({ id: U(40 + i), ...(a as object) })) });
  it("Quitar asignación: reads the current version through the support read and runs the existing assignment_save command", async () => {
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "platform_support_cafeteria_read"
      ? { data: read([{ register_id: reg, membership_id: member, status: "active", version: 3 }]), error: null }
      : { data: { request_id: args.p_request_id, operation: "assignment_save", target_id: reg }, error: null });
    const r = await post(assignment, body); expect(r.status).toBe(200);
    expect(calls()).toEqual(["platform_support_cafeteria_read", "platform_support_cafeteria_command"]);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "platform_support_cafeteria_command", { p_account_id: account, p_cafeteria_id: caf, p_request_id: key, p_operation: "assignment_save", p_payload: { membership_id: member, register_id: reg, status: "inactive", version: 3 } });
    expect(await r.json()).toEqual({ result: { membership_id: member, register_id: reg, status: "inactive" } });
  });
  it("removing an assignment that no longer exists is a named refusal; assigning a new caja sends no version", async () => {
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "platform_support_cafeteria_read" ? { data: read([]), error: null } : { data: { request_id: args.p_request_id, operation: "assignment_save", target_id: reg }, error: null });
    const gone = await post(assignment, body); expect(gone.status).toBe(422); expect(await gone.json()).toEqual({ error: "assignment_not_found" }); expect(calls()).toEqual(["platform_support_cafeteria_read"]);
    mocks.rpc.mockClear();
    expect((await post(assignment, { ...body, status: "active" })).status).toBe(200);
    expect((mocks.rpc.mock.calls[1][1] as { p_payload: unknown }).p_payload).toEqual({ membership_id: member, register_id: reg, status: "active", version: null });
  });
  it("needs operations:manage (lifecycle and provisioning are not enough) and maps cafetería refusals", async () => {
    mocks.identity.mockResolvedValue(operator(["platform:tenant:lifecycle:manage", "platform:customer:access:provision"]));
    const r = await post(assignment, body); expect(r.status).toBe(403); expect(await r.json()).toEqual({ error: "customer_operations_manage_required" }); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.identity.mockResolvedValue(operator(ALL));
    mocks.rpc.mockImplementation(async (name: string) => name === "platform_support_cafeteria_read" ? { data: read([{ register_id: reg, membership_id: member, status: "active", version: 1 }]), error: null } : { data: null, error: { code: "23514", message: "register_inactive" } });
    const refused = await post(assignment, body); expect(refused.status).toBe(422); expect(await refused.json()).toEqual({ error: "cafeteria_state_invalid" });
  });
});
