import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServerClient, resolvePikasIdentity, rpc } = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(), resolvePikasIdentity: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
import { POST } from "./route";

const identity = (capabilities: string[]) => ({ status: "ready", user: { id: "auth-user-id" }, person: { id: "person-id", displayName: "Operador ficticio" }, memberships: [],
  platform: { role: "platform_admin", roles: ["platform_admin"], capabilities } });
const key = "7c000000-0000-4000-8000-0000000000d1";
const payload = { schoolName: "Colegio Ficticio", taxId: "1-01-23456-7", addressLine: "Calle Ficticia 1", countryCode: "DO", provinceCode: "DO-01" };
const result = { account_id: "7c000000-0000-4000-8000-0000000000a1", school_id: "7c000000-0000-4000-8000-0000000000b1", location_id: "7c000000-0000-4000-8000-0000000000c1", cafeteria_id: "7c000000-0000-4000-8000-0000000000e1", school_code: "COL-0A1B2C3D4E" };
const post = (body: unknown, headers: Record<string, string> = {}) => POST(new NextRequest("https://pikas.test/api/platform/schools/onboard", { method: "POST",
  headers: { origin: "https://pikas.test", "Content-Type": "application/json", "Idempotency-Key": key, ...headers }, body: JSON.stringify(body) }));

describe("POST /api/platform/schools/onboard", () => {
  beforeEach(() => { vi.clearAllMocks(); createSupabaseServerClient.mockResolvedValue({ rpc }); resolvePikasIdentity.mockResolvedValue(identity(["platform:tenant:provision"])); });
  it("calls only the onboarding RPC with normalized RNC, locked country and province; codes never come from the browser", async () => {
    rpc.mockResolvedValue({ data: result, error: null });
    const response = await post(payload); expect(response.status).toBe(200); expect(await response.json()).toEqual({ result });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("platform_onboard_school", { p_request_id: key, p_school_name: "Colegio Ficticio", p_tax_id: "101234567",
      p_address_line: "Calle Ficticia 1", p_country_code: "DO", p_subdivision_code: "DO-01" });
  });
  it("rejects other countries, free-text provinces, invalid RNC and operator-chosen codes before any RPC", async () => {
    for (const patch of [{ countryCode: "US" }, { provinceCode: "Santiago" }, { provinceCode: "DO-40" }, { taxId: "12" }, { schoolCode: "MINE" }, { accountCode: "MINE" }])
      expect((await post({ ...payload, ...patch })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires tenant provisioning authority; customer-operations management is not enough", async () => {
    resolvePikasIdentity.mockResolvedValue(identity(["platform:customer:operations:read", "platform:customer:operations:manage", "platform:customer_admin:provision"]));
    expect((await post(payload)).status).toBe(403); expect(rpc).not.toHaveBeenCalled();
  });
  it("requires same origin and an idempotency key; maps conflicts and never trusts an invalid result", async () => {
    expect((await post(payload, { origin: "https://evil.test" })).status).toBe(403);
    expect((await post(payload, { "Idempotency-Key": "nope" })).status).toBe(400);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "platform_request_conflict" } });
    expect((await post(payload)).status).toBe(409);
    rpc.mockResolvedValueOnce({ data: { ...result, school_code: "anything" }, error: null });
    expect((await post(payload)).status).toBe(502);
  });
});
