import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
vi.mock("../../../lib/auth/school-access", () => ({ resolveSchoolAccess: mocks.access }));
import { POST } from "./route";
const id = "4d200000-0000-4000-8000-000000000001";
const body = { schoolId: id, operation: "admin_prepare", payload: { email: "admin@example.invalid" } };
const request = (payload: unknown = body, origin = "http://localhost", key = id) => new NextRequest("http://localhost/api/school", { method: "POST", headers: { origin, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(payload) });
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.access.mockResolvedValue({ status: "authorized", context: { schools: [{ school_id: id }] } }); mocks.rpc.mockResolvedValue({ data: { invitation_id: id, status: "pending" }, error: null }); });
describe("authenticated school adapter", () => {
  it("passes only validated data and preserves request key", async () => { expect((await POST(request())).status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith("school_admin_command", { p_school_id: id, p_request_id: id, p_operation: "admin_prepare", p_payload: { email: "admin@example.invalid" } }); });
  it.each([["unauthenticated", 401], ["forbidden", 403], ["unavailable", 503]])("rejects %s server authority", async (status, code) => { mocks.access.mockResolvedValue({ status }); expect((await POST(request())).status).toBe(code); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("rejects arbitrary school despite valid UUID", async () => { expect((await POST(request({ ...body, schoolId: "4d200000-0000-4000-8000-000000000002" }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it.each(["role", "actor_id", "persona_id", "account_id", "auth_id"])("rejects browser authority %s", async key => { expect((await POST(request({ ...body, payload: { ...body.payload, [key]: id } }))).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled(); });
  it("rejects cross origin", async () => { expect((await POST(request(body, "https://other.invalid"))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled(); });
  it("requires stable valid key", async () => { expect((await POST(request(body, "http://localhost", ""))).status).toBe(400); });
  it("database remains final authority after server precheck", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } }); expect((await POST(request())).status).toBe(403); });
  it("does not expose raw database/security errors", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret-internals" } }); const response = await POST(request()); expect(response.status).toBe(502); expect(await response.text()).not.toContain("secret-internals"); });
  it("invalid success result fails closed", async () => { mocks.rpc.mockResolvedValue({ data: { auth_id: id }, error: null }); expect((await POST(request())).status).toBe(502); });
});

it('dispatches explicit delegation to its separate scoped RPC',async()=>{const payload={cafeteria_id:id};mocks.rpc.mockResolvedValue({data:{membership_id:id,status:'accepted'},error:null});expect((await POST(request({schoolId:id,operation:'cafeteria_admin_self',payload}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('cafeteria_delegation_command',{p_school_id:id,p_cafeteria_id:id,p_request_id:id,p_operation:'cafeteria_admin_self',p_payload:payload});});

describe("Phase 6A username at provisioning", () => {
  const caf = "4d200000-0000-4000-8000-000000000003";
  it("school admin preparation reserves through the wrapper", async () => {
    mocks.rpc.mockResolvedValue({ data: { invitation_id: id, status: "pending", username: "escuela.admin" }, error: null });
    const response = await POST(request({ ...body, payload: { email: "admin@example.invalid", username: "Escuela.Admin" } })); expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("provisioning_prepare_with_username", { p_flow: "school_admin", p_request_id: id, p_school_id: id, p_cafeteria_id: null, p_payload: { email: "admin@example.invalid" }, p_username: "escuela.admin" });
    expect((await response.json()).result).toEqual({ invitation_id: id, status: "pending" });
  });
  it("cafeteria admin delegation reserves through the wrapper", async () => {
    await POST(request({ schoolId: id, operation: "cafeteria_admin_prepare", payload: { cafeteria_id: caf, email: "caf@example.invalid", username: "caf.admin" } }));
    expect(mocks.rpc).toHaveBeenCalledWith("provisioning_prepare_with_username", { p_flow: "cafeteria_admin", p_request_id: id, p_school_id: id, p_cafeteria_id: caf, p_payload: { cafeteria_id: caf, email: "caf@example.invalid" }, p_username: "caf.admin" });
  });
  it("a taken username is a definite, explained rejection", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "username_unavailable" } });
    const response = await POST(request({ ...body, payload: { email: "admin@example.invalid", username: "taken" } })); expect(response.status).toBe(422); expect(await response.json()).toEqual({ error: "username_unavailable" });
  });
});
