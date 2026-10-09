import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServerClient, resolvePikasIdentity, rpc, supabaseClient } =
  vi.hoisted(() => {
    const rpc = vi.fn();
    return {
      createSupabaseServerClient: vi.fn(),
      resolvePikasIdentity: vi.fn(),
      rpc,
      supabaseClient: { rpc, from: vi.fn() },
    };
  });

vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));

import { POST } from "./route";

const authorizedIdentity = {
  status: "ready",
  user: { id: "auth-user-id" },
  person: { id: "person-id", displayName: "Platform Operator" },
  memberships: [],
  platform: {
    role: "platform_admin",
    roles: ["platform_admin"],
    capabilities: [
      "platform:tenant:provision",
      "platform:identity:link",
      "platform:customer_admin:provision",
      "platform:tenant:lifecycle:read",
      "platform:audit:read",
    ],
  },
};

const validPayload = {
  accountCode: "ACCOUNT-1",
  accountName: "Pilot Account",
  schoolCode: "SCHOOL-1",
  schoolName: "Pilot School",
  businessTimezone: "America/Santo_Domingo",
  locationCode: "CAMPUS-1",
  locationName: "Pilot Campus",
  cafeteriaCode: "CAFETERIA-1",
  cafeteriaName: "Pilot Cafeteria",
};

const rpcResult = {
  account_id: "11111111-1111-4111-8111-111111111111",
  school_id: "22222222-2222-4222-8222-222222222222",
  location_id: "33333333-3333-4333-8333-333333333333",
  cafeteria_id: "44444444-4444-4444-8444-444444444444",
};

const idempotencyKey = "8c7c98e2-93bd-4f5e-8b3d-8d786c2aa81f";

function post(
  body: unknown,
  origin = "https://pikas-pikas.app",
  key: string | null = idempotencyKey,
) {
  const headers = new Headers({
    origin,
    "content-type": "application/json",
  });
  if (key !== null) headers.set("Idempotency-Key", key);
  return POST(
    new NextRequest("https://pikas-pikas.app/api/platform/tenants", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe("authenticated platform tenant provisioning route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: rpcResult, error: null });
    createSupabaseServerClient.mockResolvedValue(supabaseClient);
    resolvePikasIdentity.mockResolvedValue(authorizedIdentity);
  });

  it("rejects a missing Origin header before auth or RPC", async () => {
    const request = new NextRequest(
      "https://pikas-pikas.app/api/platform/tenants",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validPayload),
      },
    );
    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "same_origin_required" });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing Idempotency-Key before invoking the RPC", async () => {
    const response = await post(validPayload, "https://pikas-pikas.app", null);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_idempotency_key" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed Idempotency-Key before invoking the RPC", async () => {
    const response = await post(validPayload, "https://pikas-pikas.app", "not-a-uuid");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_idempotency_key" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request before auth or RPC", async () => {
    const response = await post(validPayload, "https://attacker.example");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "same_origin_required" });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    resolvePikasIdentity.mockResolvedValue({
      status: "unauthenticated",
      user: null,
      person: null,
      memberships: [],
      platform: null,
    });

    const response = await post(validPayload);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication_required" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects authenticated users without platform authority", async () => {
    resolvePikasIdentity.mockResolvedValue({
      ...authorizedIdentity,
      memberships: [],
      platform: null,
    });

    const response = await post(validPayload);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "platform_authorization_required" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not let tenant membership alone authorize provisioning", async () => {
    resolvePikasIdentity.mockResolvedValue({
      ...authorizedIdentity,
      memberships: [
        {
          id: "tenant-membership",
          accountId: "tenant-account",
          schoolId: null,
          cafeteriaId: null,
          roleCode: "account_admin",
          scopeKind: "account",
        },
      ],
      platform: null,
    });

    const response = await post(validPayload);

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires the tenant provisioning capability even for platform admins", async () => {
    resolvePikasIdentity.mockResolvedValue({
      ...authorizedIdentity,
      platform: {
        role: "platform_admin",
    roles: ["platform_admin"],
        capabilities: ["platform:audit:read"],
      },
    });

    const response = await post(validPayload);

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a valid payload to the authenticated RPC and returns its result", async () => {
    const response = await post(validPayload);

    expect(createSupabaseServerClient).toHaveBeenCalledOnce();
    expect(resolvePikasIdentity).toHaveBeenCalledOnce();
    expect(resolvePikasIdentity).toHaveBeenCalledWith(supabaseClient);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "platform_provision_tenant",
      expect.objectContaining({
        p_account_code: "ACCOUNT-1",
        p_account_name: "Pilot Account",
        p_school_code: "SCHOOL-1",
        p_school_name: "Pilot School",
        p_business_timezone: "America/Santo_Domingo",
        p_location_code: "CAMPUS-1",
        p_location_name: "Pilot Campus",
        p_cafeteria_code: "CAFETERIA-1",
        p_cafeteria_name: "Pilot Cafeteria",
      }),
    );
    const rpcParameters = rpc.mock.calls[0][1];
    expect(Object.keys(rpcParameters).sort()).toEqual([
      "p_account_code",
      "p_account_name",
      "p_business_timezone",
      "p_cafeteria_code",
      "p_cafeteria_name",
      "p_location_code",
      "p_location_name",
      "p_request_id",
      "p_school_code",
      "p_school_name",
    ]);
    expect(rpcParameters.p_request_id).toBe(idempotencyKey);
    expect(await response.json()).toEqual({ result: rpcResult });
    expect(response.status).toBe(200);
  });

  it("passes the supplied idempotency key unchanged to the database for retries", async () => {
    const firstResponse = await post(validPayload, "https://pikas-pikas.app", idempotencyKey);
    const retryResponse = await post(validPayload, "https://pikas-pikas.app", idempotencyKey);

    expect(firstResponse.status).toBe(200);
    expect(retryResponse.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_request_id).toBe(idempotencyKey);
    expect(rpc.mock.calls[1][1].p_request_id).toBe(idempotencyKey);
    expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[1][1]);
  });

  it("forwards the same supplied key with changed payload for database conflict handling", async () => {
    const changedPayload = { ...validPayload, accountName: "Changed Account" };

    await post(validPayload, "https://pikas-pikas.app", idempotencyKey);
    await post(changedPayload, "https://pikas-pikas.app", idempotencyKey);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_request_id).toBe(idempotencyKey);
    expect(rpc.mock.calls[1][1].p_request_id).toBe(idempotencyKey);
    expect(rpc.mock.calls[0][1].p_account_name).not.toBe(
      rpc.mock.calls[1][1].p_account_name,
    );
  });

  it.each([
    [{ ...validPayload, accountName: "" }],
    [{ ...validPayload, schoolName: "x".repeat(201) }],
    [{ ...validPayload, businessTimezone: "x".repeat(101) }],
    [{ ...validPayload, unexpectedField: "not accepted" }],
    [null],
  ])("rejects malformed payloads before invoking the RPC", async (payload) => {
    const response = await post(payload);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_payload" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before invoking the RPC", async () => {
    const response = await POST(
      new NextRequest("https://pikas-pikas.app/api/platform/tenants", {
        method: "POST",
        headers: {
          origin: "https://pikas-pikas.app",
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_payload" });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("returns a safe conflict for RPC rejection without exposing database details", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "sensitive database detail" },
    });

    const response = await post(validPayload);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({ error: "provisioning_conflict" });
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });

  it("returns safe authorization failure if the database denies the RPC", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "not_authorized" },
    });

    const response = await post(validPayload);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "platform_authorization_required" });
  });

  it("returns a safe upstream error if the RPC transport throws", async () => {
    rpc.mockRejectedValue(new Error("sensitive transport detail"));

    const response = await post(validPayload);

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: "provisioning_unavailable" });
    expect(JSON.stringify(body)).not.toContain("sensitive transport detail");
  });

  it("does not use the service-role client or insert tenant memberships", async () => {
    const response = await post(validPayload);

    expect(response.status).toBe(200);
    expect(createSupabaseServerClient).toHaveBeenCalledOnce();
    expect(supabaseClient.from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("rejects a sandbox-only operator through the capability check", async () => {
    resolvePikasIdentity.mockResolvedValue({
      ...authorizedIdentity,
      platform: {
        role: "platform_sandbox_operator",
        roles: ["platform_sandbox_operator"],
        capabilities: ["platform:sandbox:pov:enter"],
      },
    });
    const response = await post(validPayload);
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not let a dual-role Person bypass the required capability", async () => {
    resolvePikasIdentity.mockResolvedValue({
      ...authorizedIdentity,
      platform: {
        role: "platform_admin",
        roles: ["platform_admin", "platform_sandbox_operator"],
        capabilities: ["platform:sandbox:pov:enter", "platform:audit:read"],
      },
    });
    const response = await post(validPayload);
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
