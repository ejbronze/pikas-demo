import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServerClient, resolvePikasIdentity, rpc } = vi.hoisted(
  () => ({
    createSupabaseServerClient: vi.fn(),
    resolvePikasIdentity: vi.fn(),
    rpc: vi.fn(),
  }),
);

vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));

import { POST as enter } from "./enter/route";
import { POST as exit } from "./exit/route";

const key = "8c7c98e2-93bd-4f5e-8b3d-8d786c2aa81f";
const target = {
  accountId: "03e71159-69e9-4387-9b3b-65799d49faf0",
  cafeteriaId: "b9496342-5079-46ae-83b8-05c39bcbd7fe",
};
const sessionId = "11111111-1111-4111-8111-111111111111";

function identity(role: string, capabilities: string[]) {
  return {
    status: "ready",
    user: { id: "u" },
    person: { id: "p", displayName: "Operador" },
    memberships: [],
    platform: { role, roles: [role], capabilities },
  };
}
const sandboxOnly = identity("platform_sandbox_operator", [
  "platform:sandbox:pov:enter",
]);
const adminOnly = identity("platform_admin", [
  "platform:tenant:provision",
  "platform:audit:read",
]);

function call(
  handler: (request: NextRequest) => Promise<Response>,
  path: string,
  body: unknown,
  opts: { origin?: string; key?: string | null } = {},
) {
  const headers = new Headers({
    origin: opts.origin ?? "https://pikas-pikas.app",
    "content-type": "application/json",
  });
  const k = opts.key === undefined ? key : opts.key;
  if (k !== null) headers.set("Idempotency-Key", k);
  return handler(
    new NextRequest("https://pikas-pikas.app" + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}
const doEnter = (body: unknown, opts = {}) =>
  call(enter, "/api/platform/sandbox-pov/enter", body, opts);
const doExit = (body: unknown, opts = {}) =>
  call(exit, "/api/platform/sandbox-pov/exit", body, opts);

describe("sandbox POV routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSupabaseServerClient.mockResolvedValue({ rpc });
    resolvePikasIdentity.mockResolvedValue(sandboxOnly);
  });

  it("lets a sandbox-only operator enter with a server-fixed cashier POV and returns minimal data", async () => {
    rpc.mockResolvedValue({
      data: {
        session_id: sessionId,
        expires_at: "2026-10-09T20:00:00Z",
        persona_person_id: "secret",
        persona_membership_id: "secret",
      },
      error: null,
    });
    const response = await doEnter(target);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: { session_id: sessionId, expires_at: "2026-10-09T20:00:00Z" },
    });
    expect(rpc).toHaveBeenCalledWith("platform_enter_sandbox_pov", {
      p_request_id: key,
      p_account_id: target.accountId,
      p_cafeteria_id: target.cafeteriaId,
      p_pov_code: "cashier",
    });
  });

  it.each([
    ["pov code", { ...target, povCode: "admin" }],
    ["pov_code", { ...target, pov_code: "admin" }],
    ["persona id", { ...target, personaId: target.accountId }],
    ["person id", { ...target, personId: target.accountId }],
    ["membership id", { ...target, membershipId: target.accountId }],
    ["role", { ...target, role: "platform_admin" }],
  ])("rejects caller-supplied %s as authority", async (_n, body) => {
    const response = await doEnter(body);
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["empty body", {}],
    ["non-uuid account", { ...target, accountId: "x" }],
    ["missing cafeteria", { accountId: target.accountId }],
  ])("rejects malformed enter payload: %s", async (_n, body) => {
    expect((await doEnter(body)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["enter", doEnter, target],
    ["exit", doExit, {}],
  ] as const)("rejects missing/invalid idempotency key and foreign origin on %s", async (_n, run, body) => {
    expect((await run(body, { key: null })).status).toBe(400);
    expect((await run(body, { key: "nope" })).status).toBe(400);
    expect((await run(body, { origin: "https://evil.example" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["enter", doEnter, target],
    ["exit", doExit, {}],
  ] as const)("returns 403 on %s without the sandbox capability", async (_n, run, body) => {
    resolvePikasIdentity.mockResolvedValue(adminOnly);
    expect((await run(body)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    resolvePikasIdentity.mockResolvedValue({ status: "unauthenticated" });
    expect((await doEnter(target)).status).toBe(401);
  });

  it("exits without caller-supplied identity", async () => {
    rpc.mockResolvedValue({
      data: { session_id: sessionId, status: "exited" },
      error: null,
    });
    const response = await doExit({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { status: "exited" } });
    expect(rpc).toHaveBeenCalledWith("platform_exit_sandbox_pov", {
      p_request_id: key,
    });
    for (const body of [{ sessionId }, { personaId: sessionId }, { pov_code: "cashier" }]) {
      expect((await doExit(body)).status).toBe(400);
    }
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("surfaces database denial as 403 without a result", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const response = await doEnter(target);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "platform_authorization_required" });
  });
});
