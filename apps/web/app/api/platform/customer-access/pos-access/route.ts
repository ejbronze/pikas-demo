import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { resolvePikasIdentity } from "../../../../../lib/auth/pikas-context";
import { demoMutationBlock } from "../../../../../lib/auth/demo-guard";
import { CUSTOMER_ACCESS_PROVISION } from "../../../../../lib/platform/customer-provisioning";
import { CUSTOMER_OPERATIONS_MANAGE } from "../../../../../lib/platform/customer-operations";
import { isLifecycleAccessRejection, posAccessRequestSchema } from "../../../../../lib/platform/lifecycle-access";
import { isUsernameRejection } from "../../../../../lib/identity/provisioning";

// "Agregar a otra cafetería" (audit A-14): the SAME known customer Person (same Person, same login,
// no new identity, no synthetic address shown) receives a POS role in another cafetería of the SAME
// customer through platform_grant_customer_pos_access, then optionally one caja through the existing
// support command (its own authority). A refused caja never undoes the access.
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status: number) => json({ error }, status);
const deriveKey = (key: string, step: string) => { const h = createHash("sha256").update(`${key}:${step}`).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${(parseInt(h[16], 16) & 0x3 | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`; };
type RpcError = { code?: string; message?: string } | null;

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return fail("same_origin_required", 403);
  const key = z.uuid().safeParse(request.headers.get("Idempotency-Key"));
  if (!key.success) return fail("invalid_idempotency_key", 400);
  let body: unknown; try { body = await request.json(); } catch { return fail("invalid_payload", 400); }
  const parsed = posAccessRequestSchema.safeParse(body); if (!parsed.success) return fail("invalid_payload", 400);
  const p = parsed.data;
  try {
    const client = await createSupabaseServerClient(); const identity = await resolvePikasIdentity(client);
    if (identity.status === "unauthenticated") return fail("authentication_required", 401);
    if (identity.status !== "ready" || !identity.platform?.capabilities.includes(CUSTOMER_ACCESS_PROVISION)) return fail("customer_access_provision_required", 403);
    const block = await demoMutationBlock(client); if (block) return fail(block.error, block.status);
    const rpc = (name: string, args: Record<string, unknown>) => client.rpc(name, args) as unknown as Promise<{ data: unknown; error: RpcError }>;
    const granted = await rpc("platform_grant_customer_pos_access", { p_request_id: key.data, p_account_id: p.accountId, p_person_id: p.personId, p_cafeteria_id: p.cafeteriaId, p_role_code: p.roleCode });
    if (granted.error) {
      if (granted.error.code === "42501") return fail(granted.error.message === "customer_person_required" ? "customer_person_required" : "customer_access_scope_required", granted.error.message === "customer_person_required" ? 422 : 403);
      if (isLifecycleAccessRejection(granted.error.message) || isUsernameRejection(granted.error.message)) return fail(granted.error.message!, 422);
      if (granted.error.code === "23505" && granted.error.message === "platform_request_conflict") return fail("request_key_reused", 409);
      return fail("operation_uncertain", 502);
    }
    const result = z.object({ membership_id: z.guid(), person_id: z.guid(), cafeteria_id: z.guid(), role_code: z.string(), already_granted: z.boolean() }).safeParse(granted.data);
    if (!result.success) return fail("operation_uncertain", 502);
    let register: { register_id: string; assigned: boolean } | null = null;
    if (p.registerId && identity.platform.capabilities.includes(CUSTOMER_OPERATIONS_MANAGE)) {
      const assigned = await rpc("platform_support_cafeteria_command", { p_account_id: p.accountId, p_cafeteria_id: p.cafeteriaId, p_request_id: deriveKey(key.data, "assign"), p_operation: "assignment_save",
        p_payload: { membership_id: result.data.membership_id, register_id: p.registerId, status: "active", version: null } });
      register = { register_id: p.registerId, assigned: !assigned.error };
    } else if (p.registerId) register = { register_id: p.registerId, assigned: false };
    return json({ result: { ...result.data, register } });
  } catch { return fail("operation_uncertain", 502); }
}
