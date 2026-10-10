import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { resolveCafeteriaAccess } from "./cafeteria-access";
const id = "4d200000-0000-4000-8000-000000000001";
const context = { person_id: id, display_name: "Real administrator", cafeterias: [{ cafeteria_id: id, cafeteria_name: "School", school_name:"School", location_name:"Campus", account_name: "Account", tenant_kind: "customer" }] };
function client(data: unknown = context, user: unknown = { id }, error: unknown = null) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error }) }, rpc: vi.fn().mockResolvedValue({ data, error: null }) } as unknown as Pick<SupabaseClient, "auth" | "rpc">;
}
describe("authoritative cafeteria access", () => {
  it.each(["customer", "sandbox"])("uses explicit DB tenant authority for %s", async tenant_kind => {
    const db = client({ ...context, cafeterias: [{ ...context.cafeterias[0], tenant_kind }] });
    expect((await resolveCafeteriaAccess(db)).status).toBe("authorized");
    expect(db.rpc).toHaveBeenCalledWith("get_cafeteria_admin_context");
  });
  it("rejects unauthenticated without reading context", async () => {
    const db = client(context, null); expect((await resolveCafeteriaAccess(db)).status).toBe("unauthenticated"); expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([null, { ...context, cafeterias: [] }])("denies platform-only/unlinked/inactive authority", async data => { expect((await resolveCafeteriaAccess(client(data))).status).toBe("forbidden"); });
  it.each([{}, { ...context, cafeterias: [{ ...context.cafeterias[0], tenant_kind: "other" }] }, { ...context, role: "platform_admin" }])("fails closed on malformed authority", async data => { expect((await resolveCafeteriaAccess(client(data))).status).toBe("unavailable"); });
  it("fails closed on unavailable DB", async () => { const db = client(); vi.mocked(db.rpc).mockRejectedValue(new Error("network")); expect((await resolveCafeteriaAccess(db)).status).toBe("unavailable"); });
});
