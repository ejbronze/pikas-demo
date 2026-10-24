import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { resolveCafeteriaAccess } from "../../../../lib/auth/cafeteria-access";
import { cashRejections, collectResultSchema, readSchema, requestSchema } from "../../../../lib/cafeteria/cash-collection";

// FIN 4 Cafetería cash collection: history read and the cash posting. The database re-checks scope, capability,
// lifecycle, Demo and sharing; this route only refuses obviously wrong requests and never retries a posting.
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "same_origin_required" }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid_payload" }, 400); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_payload" }, 400);
  const input = parsed.data;
  if (input.operation === "collect" && request.headers.get("Idempotency-Key") !== input.request_key) return json({ error: "invalid_request_key" }, 400);
  try {
    const client = await createSupabaseServerClient();
    const access = await resolveCafeteriaAccess(client);
    if (access.status === "unauthenticated") return json({ error: "authentication_required" }, 401);
    if (access.status === "unavailable") return json({ error: "authority_unavailable" }, 503);
    if (access.status !== "authorized" || !access.context.cafeterias.some(c => c.cafeteria_id === input.cafeteria_id)) return json({ error: "cafeteria_authority_required" }, 403);
    if (access.context.pov) return json({ error: "demo_mode_active" }, 403);
    if (input.operation === "read") {
      const { data, error } = await client.rpc("cafeteria_cash_collections_read", { p_cafeteria_id: input.cafeteria_id, p_before: input.before });
      if (error) return json({ error: cashRejections.has(error.message) ? error.message : "cash_unavailable" }, error.code === "42501" ? 403 : 502);
      const result = readSchema.safeParse(data);
      if (!result.success || result.data.cafeteria_id !== input.cafeteria_id) return json({ error: "cash_unavailable" }, 502);
      return json({ result: result.data });
    }
    const { data, error } = await client.rpc("cafeteria_wallet_collect_cash", { p_cafeteria_id: input.cafeteria_id, p_student_id: input.student_id,
      p_gross_minor: input.gross_minor, p_payer_name: input.payer_name || null, p_request_key: input.request_key });
    // Named business refusals are authoritative (nothing posted); anything else may or may not have posted.
    if (error) return cashRejections.has(error.message) ? json({ error: error.message }, 422) : json({ error: "cash_uncertain" }, 502);
    const result = collectResultSchema.safeParse(data);
    if (!result.success || result.data.request_key !== input.request_key || result.data.cafeteria_id !== input.cafeteria_id || result.data.student_id !== input.student_id
      || result.data.gross_minor !== input.gross_minor) return json({ error: "cash_uncertain" }, 502);
    return json({ result: result.data });
  } catch { return json({ error: "cash_uncertain" }, 502); }
}
