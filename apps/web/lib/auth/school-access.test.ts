import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { resolveSchoolAccess } from "./school-access";
const id = "4d200000-0000-4000-8000-000000000001";
const context = { person_id: id, display_name: "Real administrator", schools: [{ school_id: id, school_name: "School", account_id: id, account_name: "Account", tenant_kind: "customer" }] };
function client(data: unknown = context, user: unknown = { id }, error: unknown = null) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error }) }, rpc: vi.fn().mockResolvedValue({ data, error: null }) } as unknown as Pick<SupabaseClient, "auth" | "rpc">;
}
describe("authoritative school access", () => {
  it.each(["customer", "sandbox"])("uses explicit DB tenant authority for %s", async tenant_kind => {
    const db = client({ ...context, schools: [{ ...context.schools[0], tenant_kind }] });
    expect((await resolveSchoolAccess(db)).status).toBe("authorized");
    expect(db.rpc).toHaveBeenCalledWith("get_school_admin_context");
  });
  it("rejects unauthenticated without reading context", async () => {
    const db = client(context, null); expect((await resolveSchoolAccess(db)).status).toBe("unauthenticated"); expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([null, { ...context, schools: [] }])("denies platform-only/unlinked/inactive authority", async data => { expect((await resolveSchoolAccess(client(data))).status).toBe("forbidden"); });
  it.each([{}, { ...context, schools: [{ ...context.schools[0], tenant_kind: "other" }] }, { ...context, role: "platform_admin" }])("fails closed on malformed authority", async data => { expect((await resolveSchoolAccess(client(data))).status).toBe("unavailable"); });
  it("fails closed on unavailable DB", async () => { const db = client(); vi.mocked(db.rpc).mockRejectedValue(new Error("network")); expect((await resolveSchoolAccess(db)).status).toBe("unavailable"); });
});
