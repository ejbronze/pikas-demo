import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { resolveCafeteriaAccess } from "../../../../lib/auth/cafeteria-access";
import { cafeteriaSettlementDetailSchema, cafeteriaSettlementsSchema, settlementReference } from "../../../../lib/platform/settlements";

// The Cafetería's own settlements, read only. The database re-checks scope, capability, lifecycle and Demo; no tenant
// request can change settlement state.
const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("read"), cafeteria_id: z.guid() }).strict(),
  z.object({ operation: z.literal("detail"), cafeteria_id: z.guid(), reference: settlementReference }).strict(),
]);
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "same_origin_required" }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid_payload" }, 400); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_payload" }, 400);
  const input = parsed.data;
  try {
    const client = await createSupabaseServerClient();
    const access = await resolveCafeteriaAccess(client);
    if (access.status === "unauthenticated") return json({ error: "authentication_required" }, 401);
    if (access.status === "unavailable") return json({ error: "authority_unavailable" }, 503);
    if (access.status !== "authorized" || !access.context.cafeterias.some(c => c.cafeteria_id === input.cafeteria_id)) return json({ error: "cafeteria_authority_required" }, 403);
    if (access.context.pov) return json({ error: "demo_mode_active" }, 403);
    const { data, error } = input.operation === "read"
      ? await client.rpc("cafeteria_settlements_read", { p_cafeteria_id: input.cafeteria_id })
      : await client.rpc("cafeteria_settlement_detail", { p_cafeteria_id: input.cafeteria_id, p_reference: input.reference });
    if (error) return error.code === "42501" ? json({ error: "finance_authority_required" }, 403)
      : error.message === "SETTLEMENT_NOT_FOUND" ? json({ error: "SETTLEMENT_NOT_FOUND" }, 404) : json({ error: "settlements_unavailable" }, 502);
    const result = input.operation === "read" ? cafeteriaSettlementsSchema.safeParse(data) : cafeteriaSettlementDetailSchema.safeParse(data);
    if (!result.success || (input.operation === "read" && (result.data as { cafeteria_id: string }).cafeteria_id !== input.cafeteria_id)
      || (input.operation === "detail" && (result.data as { reference: string }).reference !== input.reference)) return json({ error: "settlements_unavailable" }, 502);
    return json({ result: result.data });
  } catch { return json({ error: "settlements_unavailable" }, 502); }
}
