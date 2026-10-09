import { z } from "zod";
import { posAccessContextSchema } from "./access-context";

const maxAmount = 9223372036854775807n;
export const minorSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine((s) => BigInt(s) <= maxAmount);
const catalogMinor = z.union([minorSchema, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(String)]);
const uuid = z.uuid();
export const registerSchema = z.object({ cafeteria_id: uuid, register_id: uuid, assignment_id: uuid,
  register_code: z.string(), display_name: z.string(), register_version: z.number().int(), assignment_version: z.number().int() });
export const sessionSchema = z.object({ session_id: uuid, cafeteria_id: uuid, register_id: uuid, assignment_id: uuid,
  register_code_snapshot: z.string(), register_name_snapshot: z.string(), currency_code: z.string().length(3), status: z.literal("open") });
export const productSchema = z.object({ product_id: uuid, name: z.string(), description: z.string().nullable(),
  category_id: uuid.nullable(), category_name: z.string().nullable(), price_minor: catalogMinor,
  currency_code: z.string().length(3), version: z.number().int().positive() });
export const catalogSchema = z.object({ cafeteria_id: uuid, status: z.enum(["manual", "active", "no_active_service", "invalid_configuration"]),
  currency_code: z.string().length(3).nullable(), products: z.array(productSchema),
  service_shift: z.object({ id: uuid, name: z.string() }).nullable(), menu: z.object({ id: uuid, name: z.string() }).nullable() });
const restrictionSchema = z.object({ type: z.string(), code: z.string(), label: z.string() });
export const customerSchema = z.object({ customer_id: uuid, customer_type: z.enum(["student", "staff"]), display_name: z.string(),
  student_code: z.string().nullable(), grade_label: z.string().nullable(), class_label: z.string().nullable(), restrictions: z.array(restrictionSchema) });
const limitSchema = z.object({ enabled: z.boolean(), limit_minor: minorSchema.nullable() }).refine((l) => !l.enabled || l.limit_minor !== null);
export const purchaseContextSchema = z.object({ customer_id: uuid, customer_type: z.literal("student"), currency_code: z.string().length(3),
  business_date: z.string(), business_timezone: z.string(), as_of: z.string(),
  wallet: z.object({ status: z.enum(["active", "frozen"]), balance_minor: minorSchema }).nullable(),
  daily_limit: limitSchema, per_transaction_limit: limitSchema, spent_today_minor: minorSchema, available_today_minor: minorSchema,
  restrictions: z.array(restrictionSchema) });
export const checkoutSchema = z.object({ request_key: uuid, register_session_id: uuid, cafeteria_customer_id: uuid,
  items: z.array(z.object({ product_id: uuid, quantity: z.number().int().min(1).max(20), expected_product_version: z.number().int().positive(),
    expected_unit_price_minor: minorSchema }).strict()).min(1).max(30), expected_total_minor: minorSchema,
  tender: z.discriminatedUnion("type", [z.object({ type: z.literal("student_wallet") }).strict(),
    z.object({ type: z.literal("cash"), cash_received_minor: minorSchema }).strict()]) }).strict();
export const receiptSchema = z.object({ purchase_id: uuid, purchase_number: minorSchema, purchased_at: z.string(), business_date: z.string(),
  business_timezone: z.string(), currency_code: z.string().length(3), total_minor: minorSchema, register_id: uuid,
  register_session_id: uuid, cafeteria_customer_id: uuid, customer_type: z.literal("student"), customer_name: z.string(),
  tender_type: z.enum(["student_wallet", "cash"]), cash_received_minor: minorSchema.nullable(), change_due_minor: minorSchema.nullable(),
  wallet_balance_after_minor: minorSchema.nullable(), items: z.array(z.object({ product_id: uuid, name: z.string(), product_version: z.number().int(),
    unit_price_minor: minorSchema, quantity: z.number().int().positive(), line_total_minor: minorSchema })).min(1) }).superRefine((r, ctx) => {
  const sum = r.items.reduce((n, item) => n + BigInt(item.line_total_minor), 0n);
  if (sum !== BigInt(r.total_minor) || r.items.some((i) => BigInt(i.line_total_minor) !== BigInt(i.unit_price_minor) * BigInt(i.quantity)) ||
    (r.tender_type === "cash" && (r.cash_received_minor === null || r.change_due_minor === null || BigInt(r.cash_received_minor) - BigInt(r.total_minor) !== BigInt(r.change_due_minor))) ||
    (r.tender_type === "student_wallet" && r.wallet_balance_after_minor === null)) ctx.addIssue({ code: "custom", message: "Invalid committed receipt" });
});
export const bootstrapSchema = z.object({ context: posAccessContextSchema, registers: z.array(registerSchema), session: sessionSchema.nullable(),
  catalog: catalogSchema.nullable(), blocked: z.string().nullable() });
export const operationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("bootstrap") }).strict(),
  z.object({ operation: z.literal("search"), query: z.string().trim().min(2).max(80).regex(/^[^%_\\]+$/) }).strict(),
  z.object({ operation: z.literal("customer"), customer_id: uuid }).strict(),
  z.object({ operation: z.literal("checkout"), request: checkoutSchema }).strict(),
]);
export type Bootstrap = z.infer<typeof bootstrapSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type PurchaseContext = z.infer<typeof purchaseContextSchema>;
export type Product = z.infer<typeof productSchema>;
export type Checkout = z.infer<typeof checkoutSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type PosOperation = z.infer<typeof operationSchema>;

export function formatMinor(amount: string | bigint, currency: string) {
  const n = BigInt(amount);
  return `${currency === "DOP" ? "RD$" : currency} ${(n / 100n).toLocaleString("es-DO")}.${(n % 100n).toString().padStart(2, "0")}`;
}
export function parseCash(value: string): string | null {
  const match = /^(0|[1-9][0-9]*)(?:[.,]([0-9]{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const n = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return n <= maxAmount ? n.toString() : null;
}
export function paymentIssue(context: PurchaseContext, total: bigint, tender: "cash" | "student_wallet", cash: string) {
  if (total > maxAmount) return "El total excede el importe permitido.";
  if (context.per_transaction_limit.enabled && total > BigInt(context.per_transaction_limit.limit_minor!)) return "Límite por compra excedido.";
  if (context.daily_limit.enabled && total + BigInt(context.spent_today_minor) > BigInt(context.daily_limit.limit_minor!)) return "Límite diario excedido.";
  if (tender === "student_wallet") {
    if (!context.wallet || context.wallet.status !== "active") return "Saldo PIKAS no disponible.";
    if (total === 0n) return "El pago con saldo debe ser mayor que cero.";
    if (total > BigInt(context.available_today_minor)) return "Saldo disponible insuficiente.";
  } else {
    const received = parseCash(cash);
    if (received === null || BigInt(received) < total) return "Efectivo recibido insuficiente o inválido.";
  }
  return null;
}
