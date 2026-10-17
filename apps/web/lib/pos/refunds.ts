import { z } from "zod";

// Same integer minor-unit contract as ./contracts (kept local to avoid an import cycle).
const minorSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/).pipe(z.string().refine((s) => BigInt(s) <= 9223372036854775807n));
const uuid = z.uuid();
// Owner-approved reasons, mapped to the authoritative database codes.
export const refundReasons = [
  ["wrong_product", "Artículo incorrecto"], ["duplicate", "Cobro duplicado"], ["unavailable", "Artículo no disponible"],
  ["quality_issue", "Problema de calidad"], ["wrong_quantity", "Cantidad incorrecta"],
  ["customer_requested", "Estudiante cambió de opinión"], ["other", "Otro"],
] as const;
export const refundReasonSchema = z.enum(["wrong_product", "duplicate", "unavailable", "quality_issue", "wrong_quantity", "customer_requested", "other"]);
export const refundItemsSchema = z.array(z.object({ purchase_item_id: uuid, quantity: z.number().int().min(1).max(999999) }).strict())
  .min(1).max(50).refine((items) => new Set(items.map((i) => i.purchase_item_id)).size === items.length);
const refundBase = { purchase_id: uuid, items: refundItemsSchema, reason: refundReasonSchema, notes: z.string().trim().max(500) };
const otherNeedsNotes = (v: { reason: string; notes: string }) => v.reason !== "other" || v.notes.length >= 3;
export const refundRequestSchema = z.object({ ...refundBase, request_key: uuid, approval_id: uuid.nullable() }).strict().refine(otherNeedsNotes);
export type RefundRequest = z.infer<typeof refundRequestSchema>;
export const approvalRequestSchema = z.object({ ...refundBase, issuance_key: uuid, approver_email: z.email().max(254),
  approver_password: z.string().min(4).max(128) }).strict().refine(otherNeedsNotes);
export const approvalResultSchema = z.object({ approval_id: uuid, purchase_id: uuid, amount_minor: minorSchema,
  approver_role: z.enum(["pos_supervisor", "cafeteria_admin"]), issued_at: z.string(), expires_at: z.string() }).strict();
export const overrideReasonSchema = z.enum(["sale_age", "count_limit", "amount_limit", "cash_shortfall"]);
export const overrideLabels: Record<z.infer<typeof overrideReasonSchema>, string> = {
  sale_age: "Pasaron más de 5 minutos desde la venta", count_limit: "Se alcanzó el límite diario de reembolsos del cajero",
  amount_limit: "Este reembolso supera el monto diario permitido al cajero",
  cash_shortfall: "El efectivo esperado de esta caja quedaría en negativo",
};
export const refundabilitySchema = z.object({
  purchase_id: uuid, purchase_number: minorSchema, purchased_at: z.string(), sale_age_seconds: minorSchema, customer_name: z.string(),
  tender_type: z.string(), currency_code: z.string().length(3), total_minor: minorSchema, refunded_minor: minorSchema, remaining_minor: minorSchema,
  itemizable: z.boolean(),
  items: z.array(z.object({ purchase_item_id: uuid, name: z.string(), unit_price_minor: minorSchema, quantity: z.number().int().positive(),
    refunded_quantity: z.number().int().nonnegative() }).strict()),
  refunds: z.array(z.object({ refund_ordinal: minorSchema, amount_minor: minorSchema, occurred_at: z.string(), reason: z.string(),
    authorization_mode: z.string() }).strict()),
  actor_role: z.enum(["pos_cashier", "pos_supervisor"]), window_seconds: z.literal(300), cashier_count_limit: z.number().int(),
  cashier_amount_limit_minor: minorSchema, cashier_used_count: z.number().int(), cashier_used_amount_minor: minorSchema,
}).strict();
export type Refundability = z.infer<typeof refundabilitySchema>;
export const refundResultSchema = z.object({
  refund_id: uuid, purchase_id: uuid, refund_ordinal: minorSchema, amount_minor: minorSchema, currency_code: z.string(),
  tender_type: z.enum(["cash", "student_wallet"]), occurred_at: z.string(), business_date: z.string(), business_timezone: z.string(),
  purchase_number: minorSchema, approval_used: z.boolean(), reason: z.string(), notes: z.string().nullable(), authorization_mode: z.string(),
  approval_id: uuid.nullable(), remaining_after_minor: minorSchema, sale_age_seconds: minorSchema, override_required: z.boolean(),
  override_reasons: z.array(overrideReasonSchema), approver_role: z.enum(["pos_supervisor", "cafeteria_admin"]).nullable(),
  register_session_id: uuid.nullable(),
  items: z.array(z.object({ purchase_item_id: uuid, name: z.string(), quantity: z.number().int().positive(), amount_minor: minorSchema }).strict()),
}).strict();
export type RefundResult = z.infer<typeof refundResultSchema>;
export const limitsRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("read"), cafeteria_id: uuid }).strict(),
  z.object({ operation: z.literal("configure"), cafeteria_id: uuid, expected_version: z.number().int().positive(),
    count_limit: z.number().int().min(0).max(10000), amount_limit_minor: minorSchema }).strict(),
]);
export const limitsSchema = z.object({ cafeteria_id: uuid, version: z.number().int().positive(), count_limit: z.number().int(),
  amount_limit_minor: minorSchema, window_seconds: z.literal(300).optional() }).strict();
// Rejections that prove no refund was written; anything else keeps the exact request for retry.
export const definiteRefundRejections = new Set(["REFUND_APPROVAL_REQUIRED", "REFUND_EXCEEDS_REMAINING", "NOT_REFUNDABLE",
  "REFUND_ITEMS_UNAVAILABLE", "APPROVAL_INVALID", "APPROVAL_EXPIRED", "APPROVAL_ALREADY_USED", "SESSION_CLOSED", "CASH_INSUFFICIENT",
  "INVALID_REFUND_ITEMS", "INVALID_REFUND_REASON", "INVALID_REFUND_NOTES", "SELF_APPROVAL_NOT_ALLOWED", "REGISTER_INACTIVE",
  "ASSIGNMENT_INACTIVE", "CURRENCY_DISABLED", "IDEMPOTENCY_CONFLICT"]);
