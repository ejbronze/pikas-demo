import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolvePosAccess } from "@/lib/auth/pos-access";
import { bootstrapSchema, catalogSchema, checkoutSchema, customerSchema, operationSchema, purchaseContextSchema,
  receiptSchema, registerSchema, sessionSchema, registerResultSchema } from "../../../lib/pos/contracts";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
class PosFailure extends Error {
  constructor(public status: number, public code: string, public definite = false) { super(code); }
}
const rejected = new Set(["PRODUCT_STALE", "TOTAL_STALE", "PRODUCT_UNAVAILABLE", "NO_ACTIVE_SERVICE", "CUSTOMER_INELIGIBLE",
  "TRANSACTION_LIMIT_EXCEEDED", "DAILY_LIMIT_EXCEEDED", "INSUFFICIENT_BALANCE", "WALLET_FROZEN",
  "register_already_has_open_session", "operator_already_has_open_session", "register_or_operator_already_has_open_session",
  "stale_register_session_version", "register_session_already_closed", "active_register_required", "enabled_cafeteria_currency_required",
  "CASH_INSUFFICIENT", "SESSION_CLOSED", "SESSION_CURRENCY_MISMATCH", "REGISTER_INACTIVE", "ASSIGNMENT_INACTIVE", "PURCHASE_COUNTER_MISSING"]);
async function rpc<T>(client: Client, name: string, args: Record<string, unknown> | undefined, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    if (error.code === "42501") throw new PosFailure(403, "pos_authority_required");
    if (rejected.has(error.message)) throw new PosFailure(409, error.message, true);
    // Unknown failures, conflicts and invalid responses cannot prove that a checkout did not commit.
    throw new PosFailure(502, "pos_operation_unavailable");
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new PosFailure(502, "invalid_pos_response");
  return result.data;
}

export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "same_origin_required" }, 403);
  let body;
  try { body = operationSchema.safeParse(await request.json()); } catch { return json({ error: "invalid_payload" }, 400); }
  if (!body.success) return json({ error: "invalid_payload" }, 400);
  try {
    const client = await createSupabaseServerClient();
    const access = await resolvePosAccess(client);
    if (access.status !== "authorized") return json({ error: "pos_access_required" }, access.status === "unauthenticated" ? 401 : access.status === "forbidden" ? 403 : 503);
    const op = body.data;
    if (op.operation === "checkout") {
      if (request.headers.get("Idempotency-Key") !== op.request.request_key) return json({ error: "invalid_idempotency_key" }, 400);
      // Session/customer/product IDs are targets, never authority. The existing checkout RPC resolves
      // actor, membership and scope from Auth/POV and the stored session, including a closed-session replay.
      const receipt = await rpc(client, "checkout_purchase", { p_request: checkoutSchema.parse(op.request) }, receiptSchema);
      if (receipt.register_session_id !== op.request.register_session_id || receipt.cafeteria_customer_id !== op.request.cafeteria_customer_id ||
        receipt.total_minor !== op.request.expected_total_minor || receipt.tender_type !== op.request.tender.type) throw new PosFailure(502, "invalid_pos_response");
      return json({ result: receipt });
    }
    if (op.operation === "close_register") {
      if (request.headers.get("Idempotency-Key") !== op.request_key) return json({ error: "invalid_idempotency_key" }, 400);
      // Read guard also scopes closed-session retries to the current effective membership.
      await rpc(client, "get_pos_register_session", { p_session_id: op.session_id }, z.object({ session_id: z.uuid() }));
      const result = await rpc(client, "close_my_register_session", { p_session_id: op.session_id,
        p_expected_version: op.expected_version, p_counted_cash_minor: op.counted_cash_minor, p_close_request_key: op.request_key }, registerResultSchema);
      if (result[0].session_id !== op.session_id || result[0].status !== "closed") throw new PosFailure(502, "invalid_pos_response");
      return json({ result });
    }
    const [registers, sessions] = await Promise.all([
      rpc(client, "list_my_operable_registers", undefined, z.array(registerSchema)),
      rpc(client, "get_my_open_register_session", undefined, z.array(sessionSchema)),
    ]);
    const scopedRegisters = registers.filter((r) => access.context.memberships.some((m) => m.cafeteria_id === r.cafeteria_id));
    if (op.operation === "open_register") {
      if (request.headers.get("Idempotency-Key") !== op.request_key) return json({ error: "invalid_idempotency_key" }, 400);
      const matches = scopedRegisters.filter((r) => r.register_id === op.register_id);
      if (matches.length !== 1) throw new PosFailure(403, "pos_authority_required");
      const result = await rpc(client, "open_register_session", { p_register_id: matches[0].register_id,
        p_assignment_id: matches[0].assignment_id, p_opening_cash_minor: op.opening_cash_minor, p_open_request_key: op.request_key }, registerResultSchema);
      return json({ result });
    }
    const validSessions = sessions.filter((s) => scopedRegisters.some((r) => r.cafeteria_id === s.cafeteria_id && r.register_id === s.register_id && r.assignment_id === s.assignment_id));
    const session = validSessions.length === 1 && sessions.length === 1 ? validSessions[0] : null;
    if (!session) {
      if (op.operation !== "bootstrap") throw new PosFailure(409, "register_not_ready");
      return json({ result: bootstrapSchema.parse({ context: access.context, registers: scopedRegisters, session: null, catalog: null,
        blocked: "No hay una caja abierta y autorizada. Abre una caja asignada desde Caja para continuar." }) });
    }
    if (op.operation === "search") {
      const customers = await rpc(client, "cafeteria_customer_projection", { p_cafeteria_id: session.cafeteria_id, p_query: op.query }, z.array(customerSchema));
      return json({ result: customers.filter((c) => c.customer_type === "student") });
    }
    if (op.operation === "customer") {
      const result = await rpc(client, "get_pos_customer_purchase_context", {
        p_cafeteria_id: session.cafeteria_id, p_cafeteria_customer_id: op.customer_id,
      }, purchaseContextSchema);
      if (result.customer_id !== op.customer_id || result.currency_code !== session.currency_code) throw new PosFailure(502, "invalid_pos_response");
      return json({ result });
    }
    const catalog = await rpc(client, "get_cafeteria_saleable_catalog", { p_cafeteria_id: session.cafeteria_id }, catalogSchema);
    if (catalog.cafeteria_id !== session.cafeteria_id || catalog.currency_code !== session.currency_code ||
      catalog.products.some((p) => p.currency_code !== session.currency_code)) throw new PosFailure(502, "invalid_pos_response");
    return json({ result: bootstrapSchema.parse({ context: access.context, registers: scopedRegisters, session, catalog,
      blocked: !["manual", "active"].includes(catalog.status) ? "No hay servicio de venta activo." : !catalog.products.length ? "No hay productos disponibles para vender." : null }) });
  } catch (error) {
    return error instanceof PosFailure ? json({ error: error.code, definite: error.definite }, error.status) : json({ error: "pos_operation_unavailable" }, 503);
  }
}
