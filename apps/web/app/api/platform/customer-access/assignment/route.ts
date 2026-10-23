import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supportManager, supportJson } from "../../../../../lib/platform/support-read-route";
import { supportCafeteriaReadSchema } from "../../../../../lib/platform/customer-operations";
import { assignmentRequestSchema } from "../../../../../lib/platform/lifecycle-access";

// "Quitar asignación de {caja}" / "Asignar {caja}" from the Platform person sheet. Reads the cafetería
// through the existing support read to find the assignment's current version, then runs the existing
// assignment_save support command (platform:customer:operations:manage, re-checked by the database).
// Operational caja access only: the membership, the login and the history are untouched.
export async function POST(request: NextRequest) {
  const auth = await supportManager(request); if ("response" in auth) return auth.response;
  const key = z.uuid().safeParse(request.headers.get("Idempotency-Key"));
  let body: unknown; try { body = await request.json(); } catch { return supportJson({ error: "invalid_payload" }, 400); }
  const parsed = assignmentRequestSchema.safeParse(body);
  if (!parsed.success || !key.success) return supportJson({ error: "invalid_payload" }, 400);
  const p = parsed.data;
  try {
    const read = await auth.client.rpc("platform_support_cafeteria_read", { p_account_id: p.accountId, p_cafeteria_id: p.cafeteriaId });
    if (read.error) return supportJson({ error: read.error.code === "42501" ? "customer_operations_scope_required" : "operation_uncertain" }, read.error.code === "42501" ? 403 : 502);
    const cafeteria = supportCafeteriaReadSchema.safeParse(read.data);
    if (!cafeteria.success || cafeteria.data.scope.cafeteria_id !== p.cafeteriaId) return supportJson({ error: "operation_uncertain" }, 502);
    const assignment = cafeteria.data.assignments.find(a => a.membership_id === p.membershipId && a.register_id === p.registerId) ?? null;
    if (!assignment && p.status === "inactive") return supportJson({ error: "assignment_not_found" }, 422);
    const { data, error } = await auth.client.rpc("platform_support_cafeteria_command", { p_account_id: p.accountId, p_cafeteria_id: p.cafeteriaId, p_request_id: key.data, p_operation: "assignment_save",
      p_payload: { membership_id: p.membershipId, register_id: p.registerId, status: p.status, version: assignment?.version ?? null } });
    if (error) return supportJson({ error: ["23514", "23503", "23505", "40001", "22023"].includes(error.code ?? "") ? "cafeteria_state_invalid" : error.code === "42501" ? "customer_operations_scope_required" : "operation_uncertain" }, error.code === "42501" ? 403 : ["23514", "23503", "23505", "40001", "22023"].includes(error.code ?? "") ? 422 : 502);
    const result = z.object({ request_id: z.guid(), operation: z.string(), target_id: z.guid().nullable() }).loose().safeParse(data);
    if (!result.success || result.data.request_id !== key.data || result.data.operation !== "assignment_save") return supportJson({ error: "operation_uncertain" }, 502);
    return NextResponse.json({ result: { membership_id: p.membershipId, register_id: p.registerId, status: p.status } }, { headers: { "Cache-Control": "no-store" } });
  } catch { return supportJson({ error: "operation_uncertain" }, 502); }
}
