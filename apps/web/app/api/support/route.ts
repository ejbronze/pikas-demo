import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { pagePath, reporterCommandSchema, reporterResultSchema, supportRejections } from "../../../lib/support/contracts";

// «Reportar un problema»: create a ticket or answer one. The Idempotency-Key is the database request key, so a retry
// with the same key and body replays. Authority (real person, active membership, never a Demo POV) is the database's.
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "same_origin_required" }, 403);
  const key = z.uuid().safeParse(request.headers.get("Idempotency-Key"));
  if (!key.success) return json({ error: "invalid_idempotency_key" }, 400);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid_payload" }, 400); }
  const parsed = reporterCommandSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_payload" }, 400);
  const c = parsed.data;
  try {
    const client = await createSupabaseServerClient();
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) return json({ error: "authentication_required" }, 401);
    const { data, error } = c.operation === "create"
      ? await client.rpc("support_create_ticket", { p_request_key: key.data, p_account_id: c.account_id, p_school_id: c.school_id, p_cafeteria_id: c.cafeteria_id,
          p_category: c.category, p_subject: c.subject, p_description: c.description, p_page_path: pagePath(c.page_path) })
      : await client.rpc("support_reporter_reply", { p_request_key: key.data, p_ticket_id: c.ticket_id, p_body: c.body });
    if (error) {
      if (error.message && supportRejections.has(error.message)) return json({ error: error.message }, error.message === "demo_mode_active" || error.message === "support_scope_required" ? 403 : 422);
      if (error.code === "23505") return json({ error: "request_key_conflict" }, 409);
      if (error.code === "42501") return json({ error: "support_scope_required" }, 403);
      return json({ error: "operation_uncertain" }, 502);
    }
    const result = reporterResultSchema.safeParse(data);
    if (!result.success || (c.operation === "reply" && result.data.id !== c.ticket_id)) return json({ error: "operation_uncertain" }, 502);
    return json({ result: result.data });
  } catch { return json({ error: "operation_uncertain" }, 502); }
}
