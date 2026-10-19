import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ create: vi.fn(), access: vi.fn(), rpc: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
vi.mock("../../../lib/auth/cafeteria-access", () => ({ resolveCafeteriaAccess: mocks.access }));
import { POST } from "./route";
const id = "4d200000-0000-4000-8000-000000000001";
const body = { cafeteriaId: id, operation: "staff_prepare", payload: { email: "admin@example.invalid", role:"pos_cashier" } };
const request = (payload: unknown = body, origin = "http://localhost", key = id) => new NextRequest("http://localhost/api/cafeteria", { method: "POST", headers: { origin, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(payload) });
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.access.mockResolvedValue({ status: "authorized", context: { cafeterias: [{ cafeteria_id: id }] } }); mocks.rpc.mockResolvedValue({ data: { request_id:id,operation:"staff_prepare",target_id:id }, error: null }); });
describe("authenticated cafeteria adapter", () => {
  it("passes only validated data and preserves request key", async () => { expect((await POST(request())).status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith("cafeteria_admin_command", { p_cafeteria_id: id, p_request_id: id, p_operation: "staff_prepare", p_payload: { email: "admin@example.invalid", role:"pos_cashier" } }); });
  it.each([["unauthenticated", 401], ["forbidden", 403], ["unavailable", 503]])("rejects %s server authority", async (status, code) => { mocks.access.mockResolvedValue({ status }); expect((await POST(request())).status).toBe(code); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("rejects arbitrary cafeteria despite valid UUID", async () => { expect((await POST(request({ ...body, cafeteriaId: "4d200000-0000-4000-8000-000000000002" }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it.each(["role", "actor_id", "persona_id", "account_id", "auth_id"])("rejects browser authority %s", async key => { expect((await POST(request({ ...body, payload: { ...body.payload, [key]: id } }))).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled(); });
  it("rejects cross origin", async () => { expect((await POST(request(body, "https://other.invalid"))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled(); });
  it("requires stable valid key", async () => { expect((await POST(request(body, "http://localhost", ""))).status).toBe(400); });
  it("database remains final authority after server precheck", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } }); expect((await POST(request())).status).toBe(403); });
  it("does not expose raw database/security errors", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret-internals" } }); const response = await POST(request()); expect(response.status).toBe(502); expect(await response.text()).not.toContain("secret-internals"); });
  it("invalid success result fails closed", async () => { mocks.rpc.mockResolvedValue({ data: { auth_id: id }, error: null }); expect((await POST(request())).status).toBe(502); });
});

it.each(["23505","40001","40P01"])("first attempt definitive DB rollback %s reports rejection without exposing internals",async code=>{mocks.rpc.mockResolvedValue({data:null,error:{code,message:"secret-internals"}});const response=await POST(request());expect(response.status).toBe(422);expect(await response.text()).not.toContain("secret-internals");});
it("an authoritative result must match both the original key and operation",async()=>{mocks.rpc.mockResolvedValue({data:{request_id:id,operation:"register_save",target_id:id},error:null});expect((await POST(request())).status).toBe(502);});

describe("Phase 6A username at provisioning", () => {
  const withUser = { ...body, payload: { ...body.payload, username: " Jeanne.Norte " } };
  it("reserves through the transactional wrapper with the normalized username; the command payload is unchanged", async () => {
    mocks.rpc.mockResolvedValue({ data: { request_id: id, operation: "staff_prepare", target_id: id, username: "jeanne.norte" }, error: null });
    const response = await POST(request(withUser)); expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("provisioning_prepare_with_username", { p_flow: "cafeteria_staff", p_request_id: id, p_school_id: null, p_cafeteria_id: id, p_payload: { email: "admin@example.invalid", role: "pos_cashier" }, p_username: "jeanne.norte" });
    expect((await response.json()).result).toEqual({ request_id: id, operation: "staff_prepare", target_id: id });
  });
  it.each(["username_unavailable", "username_reserved", "identity_has_username", "email_has_other_username", "invalid_username"])("%s is a definite, explained rejection", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: code.startsWith("username_un") || code.includes("has") ? "23505" : "22023", message: code } });
    const response = await POST(request(withUser)); expect(response.status).toBe(422); expect(await response.json()).toEqual({ error: code });
  });
  it.each(["a..b", "x@y.com", "ab"])("malformed username %s never reaches the database", async username => {
    expect((await POST(request({ ...body, payload: { ...body.payload, username } }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
