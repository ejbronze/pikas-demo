import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { resolveSchoolAccess } from "../../../lib/auth/school-access";
import { commandSchema, commandResultSchema } from "../../../lib/school/contracts";
import { isUsernameRejection } from "../../../lib/identity/provisioning";
export async function POST(request: NextRequest) {
  const fail = (error: string, status: number) => NextResponse.json({ error }, { status });
  if (request.headers.get("origin") !== request.nextUrl.origin) return fail("same_origin_required", 403);
  const key = z.uuid().safeParse(request.headers.get("Idempotency-Key"));
  if (!key.success) return fail("invalid_request_key", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("invalid_payload", 400); }
  const parsed = commandSchema.safeParse(body);
  if (!parsed.success) return fail("invalid_payload", 400);
  try {
    const client = await createSupabaseServerClient();
    const access = await resolveSchoolAccess(client);
    if (access.status === "unauthenticated") return fail("authentication_required", 401);
    if (access.status === "unavailable") return fail("authorization_unavailable", 503);
    if (access.status !== "authorized" || !access.context.schools.some(s => s.school_id === parsed.data.schoolId)) return fail("school_authority_required", 403);
    const delegation = parsed.data.operation.startsWith("cafeteria_admin_");
    // Phase 6A: a username at preparation is reserved in the same transaction as the existing command.
    const op = parsed.data;
    const reserve = (op.operation === "admin_prepare" || op.operation === "cafeteria_admin_prepare") && op.payload.username !== undefined ? op : null;
    const { data: raw, error } = reserve && (reserve.operation === "admin_prepare" || reserve.operation === "cafeteria_admin_prepare")
      ? await client.rpc("provisioning_prepare_with_username", { p_flow: reserve.operation === "admin_prepare" ? "school_admin" : "cafeteria_admin", p_request_id: key.data, p_school_id: reserve.schoolId,
          p_cafeteria_id: reserve.operation === "cafeteria_admin_prepare" ? reserve.payload.cafeteria_id : null,
          p_payload: Object.fromEntries(Object.entries(reserve.payload).filter(([k]) => k !== "username")), p_username: reserve.payload.username })
      : await client.rpc(delegation ? "cafeteria_delegation_command" : "school_admin_command", { p_school_id: parsed.data.schoolId, p_request_id: key.data, p_operation: parsed.data.operation, p_payload: parsed.data.payload, ...(delegation ? {p_cafeteria_id: (parsed.data.payload as {cafeteria_id:string}).cafeteria_id} : {}) });
    const data = reserve && raw && typeof raw === "object" ? Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "username")) : raw;
    if (error) {
      if (error.code === "42501") return fail("school_authority_required", 403);
      if (isUsernameRejection(error.message)) return fail(error.message, 422);
      if (error.code === "23505") return fail("school_operation_conflict", 409);
      if (["23514", "23503", "22023", "22007", "22P02", "23502"].includes(error.code)) return fail(error.message === "confirmed_identity_pending" ? "confirmed_identity_pending" : "school_state_invalid", 422);
      return fail("operation_uncertain", 502);
    }
    const result = commandResultSchema.safeParse(data);
    if (!result.success) return fail("operation_uncertain", 502);
    return NextResponse.json({ result: result.data });
  } catch { return fail("operation_uncertain", 502); }
}
