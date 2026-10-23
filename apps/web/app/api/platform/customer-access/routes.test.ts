import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServerClient, resolvePikasIdentity, rpc } = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn(), resolvePikasIdentity: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
import { POST as grant } from "./cafeteria-admin/route";
import { POST as staff } from "./staff/route";
import { POST as rename } from "./person-name/route";

const identity = (capabilities: string[]) => ({ status: "ready", user: { id: "auth-user-id" }, person: { id: "person-id", displayName: "Operador ficticio" }, memberships: [],
  platform: { role: "platform_admin", roles: ["platform_admin"], capabilities } });
const U = (n: number) => `7e000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const key = U(1), account = U(2), person = U(3), caf = U(4), invitation = U(5);
const post = (route: (r: NextRequest) => Promise<Response>, body: unknown) => route(new NextRequest("https://pikas.test/api/x", { method: "POST",
  headers: { origin: "https://pikas.test", "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) }));
const prepare = { operation: "staff_prepare", accountId: account, cafeteriaId: caf, displayName: "Jeanne Ficticia", email: "jeanne@example.invalid", username: "jeanne.ficticia" };

describe("Platform customer provisioning routes", () => {
  beforeEach(() => { vi.clearAllMocks(); createSupabaseServerClient.mockResolvedValue({ rpc }); resolvePikasIdentity.mockResolvedValue(identity(["platform:customer:access:provision"])); });
  it("cafeteria-admin grant calls only the grant command for an existing Person", async () => {
    rpc.mockResolvedValue({ data: { membership_id: U(6), person_id: person, cafeteria_id: caf, already_granted: false }, error: null });
    expect((await post(grant, { accountId: account, personId: person, cafeteriaId: caf })).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("platform_grant_cafeteria_admin", { p_request_id: key, p_account_id: account, p_person_id: person, p_cafeteria_id: caf });
    rpc.mockClear(); expect((await post(grant, { accountId: account, personId: person, cafeteriaId: caf, roleCode: "account_admin" })).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("Lifecycle & Access Management: the deprecated link-based staff prepare is no longer accepted by the Platform route", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const r = await post(staff, prepare); expect(r.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("staff completion sends the invitation and the Person name", async () => {
    rpc.mockResolvedValue({ data: { request_id: key, operation: "staff_complete", target_id: U(7) }, error: null });
    expect((await post(staff, { operation: "staff_complete", accountId: account, cafeteriaId: caf, invitationId: invitation, displayName: "Jeanne Ficticia" })).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("platform_customer_staff_command", { p_account_id: account, p_cafeteria_id: caf, p_request_id: key, p_operation: "staff_complete",
      p_payload: { invitation_id: invitation, display_name: "Jeanne Ficticia" } });
  });
  it("name correction sends the expected current name for stale-edit protection", async () => {
    rpc.mockResolvedValue({ data: { person_id: person, display_name: "Manuel Ficticio" }, error: null });
    expect((await post(rename, { accountId: account, personId: person, expectedName: "Manuel", name: "Manuel Ficticio" })).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("platform_rename_customer_person", { p_request_id: key, p_account_id: account, p_person_id: person, p_expected_name: "Manuel", p_name: "Manuel Ficticio" });
  });
  it("requires the provisioning capability: operations, access-read, identity support and admin provisioning are not enough", async () => {
    resolvePikasIdentity.mockResolvedValue(identity(["platform:customer:operations:manage", "platform:customer:access:read", "platform:identity:support", "platform:customer_admin:provision"]));
    expect((await post(grant, { accountId: account, personId: person, cafeteriaId: caf })).status).toBe(403);
    expect((await post(staff, { operation: "staff_complete", accountId: account, cafeteriaId: caf, invitationId: invitation, displayName: "X" })).status).toBe(403);
    expect((await post(rename, { accountId: account, personId: person, expectedName: "a", name: "b" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps definite refusals to readable 422s and never trusts an invalid result", async () => {
    for (const message of ["customer_person_required", "active_confirmed_pos_identity_required", "customer_provisioning_inactive", "confirmed_identity_pending"]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message } });
      const r = await post(message === "confirmed_identity_pending" ? staff : grant, message === "confirmed_identity_pending"
        ? { operation: "staff_complete", accountId: account, cafeteriaId: caf, invitationId: invitation, displayName: "X" } : { accountId: account, personId: person, cafeteriaId: caf });
      expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: message });
    }
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null }); expect((await post(grant, { accountId: account, personId: person, cafeteriaId: caf })).status).toBe(502);
  });
});
