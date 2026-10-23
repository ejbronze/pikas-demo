import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: async () => ({ status: "unauthenticated" }), hasPlatformAuthority: () => false }));
import { readPlatform, type PlatformSession } from "./customer-console";

// UX 14: a Platform read's failure says what it is. The kind travels with the result so pages never
// present a refusal, a missing customer or an unreadable response as a temporary failure.
const schema = z.object({ ok: z.literal(true) });
const session = (rpc: (name: string) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>, capabilities = ["cap"]) =>
  ({ supabase: { rpc } as unknown as PlatformSession["supabase"], identity: {} as PlatformSession["identity"], capabilities, demo: null }) as PlatformSession;
describe("readPlatform results", () => {
  it("missing capability: forbidden/permission before any call", async () => {
    const rpc = vi.fn(); expect(await readPlatform(session(rpc, []), "cap", "x", {}, schema)).toEqual({ kind: "forbidden", failure: "permission" }); expect(rpc).not.toHaveBeenCalled();
  });
  it("42501 is forbidden/permission; a suspended or closed customer is forbidden/lifecycle", async () => {
    expect(await readPlatform(session(async () => ({ data: null, error: { code: "42501", message: "customer_operations_scope_required" } })), "cap", "x", {}, schema)).toEqual({ kind: "forbidden", failure: "permission" });
    expect(await readPlatform(session(async () => ({ data: null, error: { code: "42501", message: "customer_suspended" } })), "cap", "x", {}, schema)).toEqual({ kind: "forbidden", failure: "lifecycle" });
  });
  it("P0002 is missing/not_found", async () => {
    expect(await readPlatform(session(async () => ({ data: null, error: { code: "P0002", message: "no_data_found" } })), "cap", "x", {}, schema)).toEqual({ kind: "missing", failure: "not_found" });
  });
  it("other errors, unreadable responses and thrown calls are unavailable with a reason", async () => {
    expect(await readPlatform(session(async () => ({ data: null, error: { code: "40001", message: "retry" } })), "cap", "x", {}, schema)).toEqual({ kind: "unavailable", failure: "temporary", reason: "rpc", code: "40001" });
    expect(await readPlatform(session(async () => ({ data: { ok: false }, error: null })), "cap", "x", {}, schema)).toEqual({ kind: "unavailable", failure: "temporary", reason: "invalid_response" });
    expect(await readPlatform(session(async () => { throw new Error("boom"); }), "cap", "x", {}, schema)).toEqual({ kind: "unavailable", failure: "temporary", reason: "exception" });
    expect(await readPlatform(session(async () => ({ data: { ok: true }, error: null })), "cap", "x", {}, schema)).toEqual({ kind: "ready", value: { ok: true } });
  });
});
