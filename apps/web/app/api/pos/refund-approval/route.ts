import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { resolvePosAccess } from "@/lib/auth/pos-access";
import { sessionSchema } from "../../../../lib/pos/contracts";
import { approvalRequestSchema, approvalResultSchema } from "../../../../lib/pos/refunds";

// Same-device supervisor override. The cashier's cookie session stays signed in and remains the
// refund initiator; the approver authenticates with the existing password login primitives on an
// isolated, non-persisted client that is used for this single approval and then signed out.
function authSessionId(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return z.uuid().parse(payload.session_id);
  } catch { return null; }
}

export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "same_origin_required" }, 403);
  let parsed;
  try { parsed = approvalRequestSchema.safeParse(await request.json()); } catch { return json({ error: "invalid_payload" }, 400); }
  if (!parsed.success) return json({ error: "invalid_payload" }, 400);
  const input = parsed.data;
  if (request.headers.get("Idempotency-Key") !== input.issuance_key) return json({ error: "invalid_idempotency_key" }, 400);
  try {
    const cashier = await createSupabaseServerClient();
    const access = await resolvePosAccess(cashier);
    if (access.status !== "authorized") return json({ error: "pos_access_required" }, access.status === "unauthenticated" ? 401 : 403);
    if (access.context.pov) return json({ error: "pos_authority_required" }, 403);
    const sessions = await cashier.rpc("get_my_open_register_session");
    const open = z.array(sessionSchema).safeParse(sessions.data);
    if (sessions.error || !open.success || open.data.length !== 1) return json({ error: "register_not_ready" }, 409);

    const { url, anonKey } = getSupabasePublicConfig();
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const signIn = await auth.auth.signInWithPassword({ email: input.approver_email, password: input.approver_password });
    if (signIn.error || !signIn.data.session) return json({ error: "approver_credentials" }, 401);
    const token = signIn.data.session.access_token;
    const sessionId = authSessionId(token);
    const approver = createClient(url, anonKey, { accessToken: async () => token,
      global: { headers: sessionId ? { "X-Pikas-Session-Id": sessionId } : {} } });
    try {
      if (!sessionId || (await approver.rpc("pikas_session_start")).error) return json({ error: "approver_session_unavailable" }, 503);
      const { data, error } = await approver.rpc("issue_purchase_item_refund_approval", { p_register_session_id: open.data[0].session_id,
        p_purchase_id: input.purchase_id, p_items: input.items, p_reason: input.reason, p_notes: input.notes || null,
        p_issuance_request_key: input.issuance_key });
      if (error) {
        if (error.code === "42501") return json({ error: error.message === "SELF_APPROVAL_NOT_ALLOWED" ? "SELF_APPROVAL_NOT_ALLOWED" : "APPROVER_NOT_AUTHORIZED", definite: true }, 403);
        if (["REFUND_EXCEEDS_REMAINING", "NOT_REFUNDABLE", "SESSION_CLOSED", "INVALID_REFUND_ITEMS", "IDEMPOTENCY_CONFLICT"].includes(error.message))
          return json({ error: error.message, definite: true }, 409);
        return json({ error: "approval_unavailable" }, 502);
      }
      const result = approvalResultSchema.safeParse(data);
      if (!result.success || result.data.purchase_id !== input.purchase_id) return json({ error: "approval_unavailable" }, 502);
      return json({ result: result.data });
    } finally {
      await approver.rpc("pikas_session_end").then(() => undefined, () => undefined);
      await auth.auth.signOut({ scope: "local" }).then(() => undefined, () => undefined);
    }
  } catch { return json({ error: "approval_unavailable" }, 503); }
}
