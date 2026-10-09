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

import { POST as prepare } from "./prepare/route";
import { POST as link } from "./link/route";
import { POST as grant } from "./grant/route";

const ids = {
  accountId: "03e71159-69e9-4387-9b3b-65799d49faf0",
  schoolId: "df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488",
  cafeteriaId: "b9496342-5079-46ae-83b8-05c39bcbd7fe",
  intentId: "11111111-1111-4111-8111-111111111111",
  personId: "82af93c4-730f-468c-9e4c-2c5238f226f1",
  authUserId: "ec08ad21-4020-4b0d-b041-ee4a1fe09471",
  membershipId: "22222222-2222-4222-8222-222222222222",
};

const requestId = "8c7c98e2-93bd-4f5e-8b3d-8d786c2aa81f";
const expiresAt = "2026-10-09T23:00:00.000Z";
const platformCapabilities = [
  "platform:tenant:provision",
  "platform:identity:link",
  "platform:customer_admin:provision",
  "platform:tenant:lifecycle:read",
  "platform:audit:read",
];

const preparePayload = {
  accountId: ids.accountId,
  scopeKind: "cafeteria",
  schoolId: ids.schoolId,
  cafeteriaId: ids.cafeteriaId,
  roleCode: "cafeteria_admin",
  intendedEmail: "operator@example.com",
  expiresAt,
};

const linkPayload = {
  intentId: ids.intentId,
  authUserId: ids.authUserId,
  displayName: "Existing Platform Operator",
};

const grantPayload = { intentId: ids.intentId };

const rpcResults: Record<string, unknown> = {
  platform_prepare_customer_admin: { intent_id: ids.intentId, status: "pending" },
  platform_link_customer_admin_identity: {
    intent_id: ids.intentId,
    person_id: ids.personId,
    status: "linked",
  },
  platform_grant_customer_admin: {
    intent_id: ids.intentId,
    membership_id: ids.membershipId,
    person_id: ids.personId,
    role_code: "cafeteria_admin",
    scope_kind: "cafeteria",
    status: "granted",
  },
};

type Endpoint = (request: NextRequest) => Promise<Response>;

function post(endpoint: Endpoint, body: unknown, key: string | null = requestId) {
  const headers = new Headers({
    origin: "https://pikas-pikas.app",
    "content-type": "application/json",
  });
  if (key !== null) headers.set("Idempotency-Key", key);

  return endpoint(
    new NextRequest("https://pikas-pikas.app/api/platform/customer-admins", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe("authenticated customer-admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSupabaseServerClient.mockResolvedValue(supabaseClient);
    resolvePikasIdentity.mockResolvedValue({
      status: "ready",
      user: { id: "platform-auth-user" },
      person: { id: "platform-person", displayName: "Platform Operator" },
      memberships: [],
      platform: {
        role: "platform_admin",
    roles: ["platform_admin"],
        capabilities: platformCapabilities,
      },
    });
    rpc.mockImplementation(async (name: string) => ({
      data: rpcResults[name],
      error: null,
    }));
  });

  it.each([
    ["prepare", prepare, preparePayload],
    ["link", link, linkPayload],
    ["grant", grant, grantPayload],
  ] as const)("rejects unauthenticated %s requests", async (_name, endpoint, body) => {
    resolvePikasIdentity.mockResolvedValue({
      status: "unauthenticated",
      user: null,
      person: null,
      memberships: [],
      platform: null,
    });

    const response = await post(endpoint, body);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication_required" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before creating the authenticated client", async () => {
    const response = await prepare(
      new NextRequest("https://pikas-pikas.app/api/platform/customer-admins", {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "content-type": "application/json",
          "Idempotency-Key": requestId,
        },
        body: JSON.stringify(preparePayload),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "same_origin_required" });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["prepare", prepare, preparePayload, "platform:identity:link"],
    ["link", link, linkPayload, "platform:customer_admin:provision"],
    ["grant", grant, grantPayload, "platform:identity:link"],
  ] as const)("requires the endpoint capability for %s", async (_name, endpoint, body, otherCapability) => {
    resolvePikasIdentity.mockResolvedValue({
      status: "ready",
      user: { id: "platform-auth-user" },
      person: { id: "platform-person", displayName: "Platform Operator" },
      memberships: [],
      platform: { role: "platform_admin",
    roles: ["platform_admin"], capabilities: [otherCapability] },
    });

    const response = await post(endpoint, body);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "platform_authorization_required",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["prepare", prepare, preparePayload],
    ["link", link, linkPayload],
    ["grant", grant, grantPayload],
  ] as const)("does not authorize %s from tenant membership alone", async (_name, endpoint, body) => {
    resolvePikasIdentity.mockResolvedValue({
      status: "ready",
      user: { id: "tenant-auth-user" },
      person: { id: "tenant-person", displayName: "Tenant Admin" },
      memberships: [
        {
          id: "tenant-membership",
          accountId: ids.accountId,
          schoolId: ids.schoolId,
          cafeteriaId: ids.cafeteriaId,
          roleCode: "cafeteria_admin",
          scopeKind: "cafeteria",
        },
      ],
      platform: null,
    });

    const response = await post(endpoint, body);

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["prepare", prepare, preparePayload],
    ["link", link, linkPayload],
    ["grant", grant, grantPayload],
  ] as const)("requires a valid Idempotency-Key for %s", async (_name, endpoint, body) => {
    for (const key of [null, "not-a-uuid"]) {
      const response = await post(endpoint, body, key);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid_idempotency_key",
      });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("maps prepare exactly and accepts the supported cafeteria_admin cafeteria scope", async () => {
    const response = await post(prepare, preparePayload);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: rpcResults.platform_prepare_customer_admin,
    });
    expect(resolvePikasIdentity).toHaveBeenCalledWith(supabaseClient);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("platform_prepare_customer_admin", {
      p_request_id: requestId,
      p_account_id: ids.accountId,
      p_scope_kind: "cafeteria",
      p_school_id: ids.schoolId,
      p_cafeteria_id: ids.cafeteriaId,
      p_role_code: "cafeteria_admin",
      p_intended_email: "operator@example.com",
      p_expires_at: expiresAt,
    });
  });

  it("maps a valid account-scoped prepare request with nullable parents", async () => {
    const response = await post(prepare, {
      ...preparePayload,
      scopeKind: "account",
      schoolId: null,
      cafeteriaId: null,
      roleCode: "account_admin",
    });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("platform_prepare_customer_admin", {
      p_request_id: requestId,
      p_account_id: ids.accountId,
      p_scope_kind: "account",
      p_school_id: null,
      p_cafeteria_id: null,
      p_role_code: "account_admin",
      p_intended_email: "operator@example.com",
      p_expires_at: expiresAt,
    });
  });

  it("accepts and maps the supported school_admin school scope", async () => {
    const response = await post(prepare, {
      ...preparePayload,
      scopeKind: "school",
      schoolId: ids.schoolId,
      cafeteriaId: null,
      roleCode: "school_admin",
    });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("platform_prepare_customer_admin", {
      p_request_id: requestId,
      p_account_id: ids.accountId,
      p_scope_kind: "school",
      p_school_id: ids.schoolId,
      p_cafeteria_id: null,
      p_role_code: "school_admin",
      p_intended_email: "operator@example.com",
      p_expires_at: expiresAt,
    });
  });

  it("maps link exactly without requiring a new identity or changing the Person", async () => {
    const response = await post(link, linkPayload);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: rpcResults.platform_link_customer_admin_identity,
    });
    expect(rpc).toHaveBeenCalledWith(
      "platform_link_customer_admin_identity",
      {
        p_request_id: requestId,
        p_intent_id: ids.intentId,
        p_auth_user_id: ids.authUserId,
        p_display_name: "Existing Platform Operator",
      },
    );
    expect(supabaseClient.from).not.toHaveBeenCalled();
  });

  it("maps grant exactly", async () => {
    const response = await post(grant, grantPayload);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: rpcResults.platform_grant_customer_admin,
    });
    expect(rpc).toHaveBeenCalledWith("platform_grant_customer_admin", {
      p_request_id: requestId,
      p_intent_id: ids.intentId,
    });
  });

  it.each([
    [prepare, { ...preparePayload, scopeKind: "school", roleCode: "cafeteria_admin" }],
    [prepare, { ...preparePayload, scopeKind: "cafeteria", roleCode: "school_admin" }],
    [prepare, { ...preparePayload, scopeKind: "account", schoolId: ids.schoolId }],
    [prepare, { ...preparePayload, roleCode: "pos_operator" }],
    [link, { ...linkPayload, authUserId: "not-a-uuid" }],
    [link, { ...linkPayload, displayName: " " }],
    [grant, { ...grantPayload, extra: true }],
  ] as const)("rejects unsupported or malformed payload before RPC", async (endpoint, body) => {
    const response = await post(endpoint, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_payload" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps database authorization and conflict errors without exposing internals", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "private authorization detail" },
    });
    const denied = await post(prepare, preparePayload);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: "platform_authorization_required",
    });

    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "private conflict detail" },
    });
    const conflict = await post(grant, grantPayload);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: "platform_operation_conflict",
    });
  });

  it("uses only the authenticated client and never writes membership tables directly", async () => {
    const response = await post(grant, grantPayload);

    expect(response.status).toBe(200);
    expect(createSupabaseServerClient).toHaveBeenCalledOnce();
    expect(resolvePikasIdentity).toHaveBeenCalledOnce();
    expect(supabaseClient.from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
  });
});
