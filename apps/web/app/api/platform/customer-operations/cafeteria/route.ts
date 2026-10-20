import { z } from "zod";
import { commandResultSchema, commandSchema } from "../../../../../lib/cafeteria/contracts";
import { supportRequestSchema } from "../../../../../lib/platform/customer-operations";
import { supportJson, supportManager, supportRpcFailure } from "../../../../../lib/platform/support-read-route";

const requestSchema = supportRequestSchema(commandSchema);
const allowed = new Set(["product_save", "category_save", "menu_save", "shift_save", "settings_save", "register_save", "assignment_save"]);
const keySchema = z.uuid();
const definite = ["23514", "23503", "23505", "40001", "40P01", "22023", "22007", "22P02", "23502"];
export async function POST(request: Request) {
  const auth = await supportManager(request); if ("response" in auth) return auth.response;
  let parsed; try { parsed = requestSchema.safeParse(await request.json()); } catch { return supportJson({ error: "invalid_payload" }, 400); }
  const key = keySchema.safeParse(request.headers.get("Idempotency-Key"));
  if (!parsed.success || !key.success || !allowed.has(parsed.data.request.operation)) return supportJson({ error: "invalid_payload" }, 400);
  const { account_id, request: command } = parsed.data;
  try {
    const { data, error } = await auth.client.rpc("platform_support_cafeteria_command", { p_account_id: account_id, p_cafeteria_id: command.cafeteriaId,
      p_request_id: key.data, p_operation: command.operation, p_payload: command.payload });
    // Same definite domain rejections as the tenant /api/cafeteria route (e.g. staff without an
    // active confirmed POS identity cannot be assigned): rejected, not an uncertain outcome.
    if (error) return definite.includes(error.code ?? "") ? supportJson({ error: "cafeteria_state_invalid" }, 422) : supportRpcFailure(error, {});
    const result = commandResultSchema.safeParse(data);
    if (!result.success || result.data.request_id !== key.data || result.data.operation !== command.operation) return supportJson({ error: "operation_uncertain" }, 502);
    return supportJson({ result: result.data });
  } catch { return supportJson({ error: "operation_uncertain" }, 502); }
}
