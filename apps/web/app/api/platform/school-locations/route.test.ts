import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.resolve }));
import { POST } from "./route";
const account = "6d000000-0000-4000-8000-0000000000a1", school = "6d000000-0000-4000-8000-0000000000b1", key = "6d000000-0000-4000-8000-000000000001";
const body = { accountId: account, schoolId: school, locationCode: "SEDE-2", locationName: "Sede Ficticia", cafeteriaCode: "CAF-2", cafeteriaName: "Cafetería Ficticia" };
const post = (b: unknown, origin = "https://pikas.test") => POST(new NextRequest("https://pikas.test/api/platform/school-locations", { method: "POST", headers: { origin, "Idempotency-Key": key, "Content-Type": "application/json" }, body: JSON.stringify(b) }));
const overview = (over: Record<string, unknown> = {}) => ({ data: { tenant_kind: "customer", schools: [{ id: school }], ...over }, error: null });

describe("Platform Agregar sede route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.resolve.mockResolvedValue({ status: "ready", platform: { capabilities: ["platform:tenant:provision", "platform:tenant:lifecycle:read"] } });
    mocks.rpc.mockImplementation(async (name: string) => name === "platform_get_customer_overview" ? overview() : { data: { account_id: account, school_id: school, location_id: key, cafeteria_id: key }, error: null }); });
  it("calls the existing command with the request key and the validated input, after confirming a customer school", async () => {
    expect((await post({ ...body, locationCode: "  SEDE-2 " })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "platform_get_customer_overview", { p_account_id: account });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "platform_add_school_location", { p_request_id: key, p_account_id: account, p_school_id: school, p_location_code: "SEDE-2", p_location_name: "Sede Ficticia", p_cafeteria_code: "CAF-2", p_cafeteria_name: "Cafetería Ficticia" });
  });
  it("without codes (the Backoffice UI) the command receives null codes and PIKAS assigns them", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "platform_get_customer_overview" ? overview()
      : { data: { account_id: account, school_id: school, location_id: key, cafeteria_id: key, location_code: "SEDE-02", cafeteria_code: "CAF-01" }, error: null });
    const r = await post({ accountId: account, schoolId: school, locationName: "Sede Tamboril", cafeteriaName: "Cafetería Tamboril" });
    expect(r.status).toBe(200); expect((await r.json()).result).toMatchObject({ location_code: "SEDE-02", cafeteria_code: "CAF-01" });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "platform_add_school_location", { p_request_id: key, p_account_id: account, p_school_id: school, p_location_code: null, p_location_name: "Sede Tamboril", p_cafeteria_code: null, p_cafeteria_name: "Cafetería Tamboril" });
  });
  it("sandbox tenants and schools of another customer are refused before the command runs", async () => {
    mocks.rpc.mockImplementationOnce(async () => overview({ tenant_kind: "sandbox" }));
    let r = await post(body); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: "location_customer_only" });
    mocks.rpc.mockImplementationOnce(async () => overview({ schools: [{ id: account }] }));
    r = await post(body); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: "active_account_school_required" });
    expect(mocks.rpc.mock.calls.map(c => c[0])).not.toContain("platform_add_school_location");
  });
  it("only operators with platform:tenant:provision; tenants and lifecycle-only operators are refused before any read", async () => {
    mocks.resolve.mockResolvedValue({ status: "ready", platform: { capabilities: ["platform:tenant:lifecycle:read", "platform:tenant:lifecycle:manage"] } });
    expect((await post(body)).status).toBe(403);
    mocks.resolve.mockResolvedValue({ status: "ready", platform: null, memberships: [{ roleCode: "account_admin" }] });
    expect((await post(body)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["platform_tenant_code_conflict", "active_account_school_required", "invalid_school_location_input"])("%s is a definite 422 with its code", async code => {
    mocks.rpc.mockImplementation(async (name: string) => name === "platform_get_customer_overview" ? overview() : { data: null, error: { code: code === "invalid_school_location_input" ? "22023" : code.startsWith("platform") ? "23505" : "23503", message: code } });
    const r = await post(body); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: code });
  });
  it("a reused key with different input stays a conflict; unknown errors stay generic", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "platform_get_customer_overview" ? overview() : { data: null, error: { code: "23505", message: "platform_request_conflict" } });
    expect((await post(body)).status).toBe(409);
    mocks.rpc.mockImplementation(async (name: string) => name === "platform_get_customer_overview" ? overview() : { data: null, error: { code: "XX000", message: "internal detail" } });
    const r = await post(body); expect(r.status).toBe(502); expect(await r.text()).not.toContain("internal detail");
  });
  it.each([{ ...body, locationCode: "" }, { ...body, cafeteriaName: "x".repeat(201) }, { ...body, address: "x" }, { ...body, schoolId: "nope" }])("invalid input %# never reaches the database", async b => {
    expect((await post(b)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("cross-origin refused", async () => { expect((await post(body, "https://evil.test")).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
});
