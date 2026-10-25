import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn(), identity: vi.fn() }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.identity }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
import { POST } from "./route";

const key = "5d000000-0000-4000-8000-000000000001", ticket = "5d000000-0000-4000-8000-000000000002";
const detail = { id: ticket, reference: "SOP-000001", category: "pos", subject: "Impresora", status: "info_requested", account_id: key, account_name: "Cliente Ficticio", school_name: null, location_name: null, cafeteria_name: null,
  register_name: "Caja 1", reporter_name: "Cajera Ficticia", reporter_role: "pos_cashier", is_demo: false, created_at: "2026-10-25T12:00:00Z", updated_at: "2026-10-25T12:00:00Z", description: "No imprime.", page_path: null,
  app_version: "local", user_agent: null, can_manage: true, events: [], replayed: false };
const caps = (...c: string[]) => mocks.identity.mockResolvedValue({ status: "ready", platform: { capabilities: c } });
const req = (body: unknown) => new NextRequest("http://localhost:3000/api/platform/support", { method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); caps("platform:support:read", "platform:support:manage"); });

describe("Soporte API", () => {
  it("acts with the Idempotency-Key as the database request key", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => fn === "platform_support_act" ? { data: detail, error: null } : { data: null, error: null });
    const r = await POST(req({ ticket_id: ticket, action: "request_info", body: "¿Qué caja?" })); expect(r.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("platform_support_act", { p_request_key: key, p_ticket_id: ticket, p_action: "request_info", p_body: "¿Qué caja?" });
  });
  it("read-only support authority cannot act", async () => { caps("platform:support:read"); expect((await POST(req({ ticket_id: ticket, action: "note", body: "x" }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalledWith("platform_support_act", expect.anything()); });
  it("refuses an unknown action before the database", async () => { expect((await POST(req({ ticket_id: ticket, action: "delete", body: null }))).status).toBe(400); });
  it("a transition the database refuses is a correctable 422", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => fn === "platform_support_act" ? { data: null, error: { code: "55000", message: "invalid_transition" } } : { data: null, error: null });
    const r = await POST(req({ ticket_id: ticket, action: "reopen", body: "x" })); expect(r.status).toBe(422); expect(await r.json()).toEqual({ error: "invalid_transition" });
  });
});
