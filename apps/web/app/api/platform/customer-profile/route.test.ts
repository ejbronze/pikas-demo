import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServerClient, resolvePikasIdentity, rpc } = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn(), resolvePikasIdentity: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
import { POST as profile } from "./route";
import { POST as structure } from "../customer-structure/route";

const identity = (capabilities: string[]) => ({ status: "ready", user: { id: "auth-user-id" }, person: { id: "person-id", displayName: "Operador ficticio" }, memberships: [],
  platform: { role: "platform_admin", roles: ["platform_admin"], capabilities } });
const key = "7d000000-0000-4000-8000-0000000000d1", account = "7d000000-0000-4000-8000-0000000000a1", school = "7d000000-0000-4000-8000-0000000000b1", caf = "7d000000-0000-4000-8000-0000000000c1";
const expected = { name: "Colegio Ficticio", rnc: null, address: null, province: null };
const body = { accountId: account, schoolId: school, expected, name: "Colegio Ficticio Renombrado", taxId: "1-01-23456-7", addressLine: "Calle Ficticia 1", countryCode: "DO", provinceCode: "DO-25" };
const rename = { accountId: account, kind: "cafeteria", targetId: caf, expectedName: "Cafetería principal", name: "Cafetería Norte" };
const post = (route: (request: NextRequest) => Promise<Response>, payload: unknown, headers: Record<string, string> = {}) => route(new NextRequest("https://pikas.test/api/x", { method: "POST",
  headers: { origin: "https://pikas.test", "Content-Type": "application/json", "Idempotency-Key": key, ...headers }, body: JSON.stringify(payload) }));

describe("Backoffice customer profile routes", () => {
  beforeEach(() => { vi.clearAllMocks(); createSupabaseServerClient.mockResolvedValue({ rpc }); resolvePikasIdentity.mockResolvedValue(identity(["platform:customer:profile:manage"])); });
  it("profile edit calls only the profile RPC with normalized RNC, expected values and the locked country", async () => {
    rpc.mockResolvedValue({ data: { account_id: account, school_id: school, account_renamed: true, changed: ["name", "rnc", "address", "province"] }, error: null });
    expect((await post(profile, body)).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("platform_update_colegio_profile", { p_request_id: key, p_account_id: account, p_school_id: school, p_expected: expected,
      p_name: "Colegio Ficticio Renombrado", p_tax_id: "101234567", p_address_line: "Calle Ficticia 1", p_country_code: "DO", p_subdivision_code: "DO-25" });
  });
  it("optional profile fields may be cleared, but codes, other countries, free-text provinces and bad RNCs never reach the RPC", async () => {
    rpc.mockResolvedValue({ data: { account_id: account, school_id: school, account_renamed: false, changed: ["rnc"] }, error: null });
    expect((await post(profile, { ...body, taxId: "", addressLine: "", provinceCode: "" })).status).toBe(200);
    rpc.mockClear();
    for (const patch of [{ countryCode: "US" }, { provinceCode: "Santiago" }, { taxId: "12" }, { name: " " }, { schoolCode: "MINE" }, { accountCode: "MINE" }]) expect((await post(profile, { ...body, ...patch })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rename accepts only sede/cafetería and calls only the structure RPC", async () => {
    rpc.mockResolvedValue({ data: { account_id: account, kind: "cafeteria", target_id: caf, name: "Cafetería Norte" }, error: null });
    expect((await post(structure, rename)).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("platform_rename_customer_structure", { p_request_id: key, p_account_id: account, p_kind: "cafeteria", p_target_id: caf, p_expected_name: "Cafetería principal", p_name: "Cafetería Norte" });
    rpc.mockClear(); expect((await post(structure, { ...rename, kind: "school" })).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("requires the profile capability: operations, provisioning and lifecycle capabilities are not enough", async () => {
    resolvePikasIdentity.mockResolvedValue(identity(["platform:customer:operations:manage", "platform:tenant:provision", "platform:tenant:lifecycle:manage", "platform:customer:operations:read"]));
    expect((await post(profile, body)).status).toBe(403); expect((await post(structure, rename)).status).toBe(403); expect(rpc).not.toHaveBeenCalled();
  });
  it("maps stale edits and closed customers to definite 422s, conflicts to 409, and never trusts an invalid result", async () => {
    for (const message of ["customer_profile_changed", "customer_profile_closed", "unsupported_school_region"]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code: message === "unsupported_school_region" ? "22023" : "23514", message } });
      const r = await post(profile, body); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: message });
    }
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "platform_request_conflict" } }); expect((await post(profile, body)).status).toBe(409);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "customer_profile_scope_required" } }); expect((await post(structure, rename)).status).toBe(403);
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null }); expect((await post(profile, body)).status).toBe(502);
    expect((await post(profile, body, { origin: "https://evil.test" })).status).toBe(403);
    expect((await post(profile, body, { "Idempotency-Key": "nope" })).status).toBe(400);
  });
});
