import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), user: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
import { POST } from "./route";

const key = "5c000000-0000-4000-8000-000000000001", acct = "5c000000-0000-4000-8000-000000000002", school = "5c000000-0000-4000-8000-000000000003", ticket = "5c000000-0000-4000-8000-000000000004";
const create = { operation: "create", account_id: acct, school_id: school, cafeteria_id: null, category: "pikas_cash", subject: "Saldo no coincide", description: "El saldo ficticio no coincide.", page_path: "/admin/escuela/pikas-cash" };
const view = { id: ticket, reference: "SOP-000001", category: "pikas_cash", subject: "Saldo no coincide", description: "El saldo ficticio no coincide.", status: "received",
  created_at: "2026-10-25T12:00:00Z", updated_at: "2026-10-25T12:00:00Z", scope: { account_name: "Cliente Ficticio", school_name: "Colegio Ficticio", cafeteria_name: null }, events: [], replayed: false };
const req = (body: unknown = create, origin = "http://localhost", k: string | null = key) => new Request("http://localhost/api/support",
  { method: "POST", headers: { origin, "Content-Type": "application/json", ...(k ? { "Idempotency-Key": k } : {}) }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc, auth: { getUser: mocks.user } }); mocks.user.mockResolvedValue({ data: { user: { id: key } } }); mocks.rpc.mockResolvedValue({ data: view, error: null }); });

describe("Reportar un problema API", () => {
  it("creates with the Idempotency-Key as the database request key, server-side scope check, no-store", async () => {
    const r = await POST(req()); expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("support_create_ticket", { p_request_key: key, p_account_id: acct, p_school_id: school, p_cafeteria_id: null, p_category: "pikas_cash",
      p_subject: "Saldo no coincide", p_description: "El saldo ficticio no coincide.", p_page_path: "/admin/escuela/pikas-cash" });
  });
  it("never forwards a query string or fragment as the page path", async () => {
    await POST(req({ ...create, page_path: "/admin/escuela?token=abc" })); expect(mocks.rpc).toHaveBeenCalledWith("support_create_ticket", expect.objectContaining({ p_page_path: null }));
  });
  it("answers a ticket", async () => {
    await POST(req({ operation: "reply", ticket_id: ticket, body: "Más detalle" })); expect(mocks.rpc).toHaveBeenCalledWith("support_reporter_reply", { p_request_key: key, p_ticket_id: ticket, p_body: "Más detalle" });
  });
  it.each([["cross-site", req(create, "https://evil.example"), 403], ["no key", req(create, "http://localhost", null), 400], ["bad category", req({ ...create, category: "billing" }), 400],
    ["short description", req({ ...create, description: "corto" }), 400], ["extra operation", req({ operation: "close", ticket_id: ticket }), 400]])
    ("refuses %s before the database", async (_, request, status) => { expect((await POST(request)).status).toBe(status); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("requires a signed-in user", async () => { mocks.user.mockResolvedValue({ data: { user: null } }); expect((await POST(req())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it.each([["support_secret_detected", "22023", 422], ["demo_mode_active", "42501", 403], ["support_scope_required", "42501", 403], ["support_ticket_closed", "55000", 422], ["request_key_conflict", "23505", 409]])
    ("maps %s", async (message, code, status) => { mocks.rpc.mockResolvedValue({ data: null, error: { code, message } }); const r = await POST(req()); expect(r.status).toBe(status); });
  it("an unknown failure or an unreadable result is uncertain (the client replays the same key)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } }); expect((await POST(req())).status).toBe(502);
    mocks.rpc.mockResolvedValue({ data: { id: ticket }, error: null }); expect((await POST(req())).status).toBe(502);
    mocks.rpc.mockResolvedValue({ data: { ...view, id: key }, error: null }); expect((await POST(req({ operation: "reply", ticket_id: ticket, body: "x" }))).status).toBe(502);
  });
});
