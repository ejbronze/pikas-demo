import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { resolvePikasIdentity } from "../../../../../lib/auth/pikas-context";
import { demoMutationBlock } from "../../../../../lib/auth/demo-guard";
import { invitationProvider } from "../../../../../lib/auth/activation";
import { SANDBOX_MANAGE, isResetRejection, resetRequestSchema, resetResultSchema } from "../../../../../lib/platform/demo-lab";

// Restaurar escenario inicial. The database (platform_reset_sandbox) owns authority, the sandbox-only
// boundary, the exact-key journal, the deletes and the re-seed; it returns the Auth users of the people the
// sandbox created, which only the service role can remove. A failed Auth purge never undoes the reset: it
// is reported, and the exact same request may be sent again (the journal replays, the purge retries).
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status: number) => json({ error }, status);

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return fail("same_origin_required", 403);
  const key = z.uuid().safeParse(request.headers.get("Idempotency-Key"));
  if (!key.success) return fail("invalid_idempotency_key", 400);
  let body: unknown; try { body = await request.json(); } catch { return fail("invalid_payload", 400); }
  const parsed = resetRequestSchema.safeParse(body); if (!parsed.success) return fail("invalid_payload", 400);
  try {
    const client = await createSupabaseServerClient(); const identity = await resolvePikasIdentity(client);
    if (identity.status === "unauthenticated") return fail("authentication_required", 401);
    if (identity.status !== "ready" || !identity.platform?.capabilities.includes(SANDBOX_MANAGE)) return fail("platform_authorization_required", 403);
    const block = await demoMutationBlock(client, identity); if (block) return fail(block.error, block.status);
    const { data, error } = await client.rpc("platform_reset_sandbox", { p_request_id: key.data, p_account_id: parsed.data.accountId });
    if (error) {
      if (isResetRejection(error.message)) return fail(error.message, error.message === "sandbox_required" || error.message === "demo_mode_active" ? 403 : 422);
      if (error.code === "42501") return fail("platform_authorization_required", 403);
      if (error.code === "23505") return fail("request_key_reused", 409);
      return fail("operation_uncertain", 502);
    }
    const result = resetResultSchema.safeParse(data);
    if (!result.success || result.data.request_id !== key.data || result.data.account_id !== parsed.data.accountId) return fail("operation_uncertain", 502);
    // Auth users of the retired sandbox people: the database already dropped their logins and memberships.
    let purged = 0, failed = 0;
    if (result.data.auth_user_ids.length) {
      const provider = invitationProvider();
      for (const authId of result.data.auth_user_ids) {
        const removed = await provider.auth.admin.deleteUser(authId);
        if (!removed.error || /not found/i.test(removed.error.message)) purged++; else failed++;
      }
    }
    return json({ result: { ...result.data, auth_purged: purged, auth_failed: failed } });
  } catch { return fail("operation_uncertain", 502); }
}
