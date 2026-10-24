import { z } from "zod";

// Settlement & Financial Operations. Reads: platform_finance_settlements_read, platform_finance_settlement_detail and
// platform_finance_settlement_preview (platform:finance:read); the Cafetería reads its own through
// cafeteria_settlements_read / cafeteria_settlement_detail. Mutations need platform:finance:settlement:manage and are
// re-checked by the database after its locks. Settlement records and reconciles obligations; it never moves money.
export const SETTLEMENT_MANAGE = "platform:finance:settlement:manage";

const minor = z.string().regex(/^-?[0-9]+$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const settlementReference = z.string().regex(/^LIQ-[0-9]{8}$/);
export const directionSchema = z.enum(["cafeteria_to_clearing", "clearing_to_cafeteria", "none"]);
export const settlementStatusSchema = z.enum(["due", "in_review", "settled"]);
export type SettlementDirection = z.infer<typeof directionSchema>;
export type SettlementStatus = z.infer<typeof settlementStatusSchema>;

const totals = {
  week_start: day, week_end: day, due_on: day, cafeteria_owes_minor: minor, clearing_owes_minor: minor,
  net_direction: directionSchema, net_amount_minor: minor, line_count: z.number().int(), late_line_count: z.number().int(),
};
export const settlementRowSchema = z.object({
  ...totals, reference: settlementReference, status: settlementStatusSchema, cafeteria: z.string(), customer: z.string(), school: z.string(),
  finalized_at: z.string(), settled_at: z.string().nullable(), overdue: z.boolean(),
});
export type SettlementRow = z.infer<typeof settlementRowSchema>;
export const readyRowSchema = z.object({ ...totals, cafeteria_id: z.guid(), cafeteria: z.string(), customer: z.string(), school: z.string() });
export type ReadyRow = z.infer<typeof readyRowSchema>;
export const settlementListSchema = z.object({ view: z.enum(["action", "history"]), query: z.string().nullable(), ready: z.array(readyRowSchema), settlements: z.array(settlementRowSchema), truncated: z.boolean() });

export const lineSchema = z.object({
  reason: z.enum(["cash_collection", "wallet_purchase_fulfillment", "cash_collection_reversal", "wallet_refund_correction", "legacy_purchase_refund"]),
  direction: directionSchema.exclude(["none"]), amount_minor: minor, occurred_at: z.string(), week_start: day, late: z.boolean(),
  replenishment_reference: z.string().nullable(), student: z.string().nullable(), receipt_number: z.string().nullable(), refund_ordinal: z.number().int().nullable(),
});
export type SettlementLine = z.infer<typeof lineSchema>;
export const eventSchema = z.object({
  kind: z.enum(["finalized", "payment_confirmed", "payment_mismatch", "review_opened", "review_resolved"]), from_status: settlementStatusSchema.nullable(),
  to_status: settlementStatusSchema, amount_minor: minor.nullable(), payment_reference: z.string().nullable(), paid_on: day.nullable(), reason: z.string().nullable(),
  note: z.string().nullable(), occurred_at: z.string(), actor: z.string().nullable(),
});
export type SettlementEvent = z.infer<typeof eventSchema>;
export const settlementDetailSchema = settlementRowSchema.extend({ finalized_by: z.string().nullable(), lines: z.array(lineSchema), events: z.array(eventSchema) });
export type SettlementDetail = z.infer<typeof settlementDetailSchema>;
export const previewSchema = readyRowSchema.extend({ status: z.literal("ready"), lines: z.array(lineSchema) });
export type SettlementPreview = z.infer<typeof previewSchema>;

// The Cafetería's own view: no customer name, no PIKAS operator identity.
const cafeteriaPeriod = z.object({ week_start: day, week_end: day, due_on: day, cafeteria_owes_minor: minor, clearing_owes_minor: minor, line_count: z.number().int() });
export const cafeteriaSettlementSchema = settlementRowSchema.omit({ customer: true, cafeteria: true, school: true, overdue: true });
export const cafeteriaSettlementsSchema = z.object({
  cafeteria_id: z.guid(), enabled: z.boolean(), current: cafeteriaPeriod, pending: z.array(cafeteriaPeriod), settlements: z.array(cafeteriaSettlementSchema),
});
export type CafeteriaSettlements = z.infer<typeof cafeteriaSettlementsSchema>;
export const cafeteriaSettlementDetailSchema = cafeteriaSettlementSchema.extend({ cafeteria: z.string(), lines: z.array(lineSchema), events: z.array(eventSchema) });
export type CafeteriaSettlementDetail = z.infer<typeof cafeteriaSettlementDetailSchema>;

// URL filters for the Platform workspace (never broaden the read).
export const settlementFiltersSchema = z.object({ vista: z.enum(["accion", "historial"]).default("accion"), q: z.string().trim().max(80).default("") });

// ── Language ───────────────────────────────────────────────────────────────────────────────────
const shortDate = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-DO", { timeZone: "UTC", ...opts });
// «Semana 19–25 oct» or «Semana 26 oct – 1 nov».
export function weekLabel(start: string, end: string) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const from = sameMonth ? shortDate(start, { day: "numeric" }) : shortDate(start, { day: "numeric", month: "short" }).replace(".", "");
  return `Semana ${from}${sameMonth ? "–" : " – "}${shortDate(end, { day: "numeric", month: "short" }).replace(".", "")}`;
}
export const dueLabel = (due: string) => shortDate(due, { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
export const settlementWhen = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
export const paidOnLabel = (iso: string) => shortDate(iso, { day: "numeric", month: "short", year: "numeric" }).replace(/\./g, "");

export const statusText: Record<SettlementStatus | "ready", string> = { ready: "Por liquidar", due: "Pendiente de pago", in_review: "En revisión", settled: "Liquidada" };
export const statusTone: Record<SettlementStatus | "ready", string> = {
  ready: "bg-sky-100 text-sky-950", due: "bg-amber-100 text-amber-950", in_review: "bg-rose-100 text-rose-900", settled: "bg-emerald-100 text-emerald-900",
};
// Who owes whom, in words (never color alone).
export const platformDirection: Record<SettlementDirection, string> = {
  cafeteria_to_clearing: "La cafetería debe enviar a PIKAS", clearing_to_cafeteria: "PIKAS debe pagar a la cafetería", none: "Sin saldo pendiente",
};
export const cafeteriaDirection: Record<SettlementDirection, string> = {
  cafeteria_to_clearing: "Debes enviar a PIKAS", clearing_to_cafeteria: "PIKAS te debe", none: "Sin saldo pendiente",
};
export const directionOf = (owes: string, owed: string): SettlementDirection => BigInt(owes) > BigInt(owed) ? "cafeteria_to_clearing" : BigInt(owed) > BigInt(owes) ? "clearing_to_cafeteria" : "none";
export const netOf = (owes: string, owed: string) => { const d = BigInt(owes) - BigInt(owed); return (d < 0n ? -d : d).toString(); };

export const lineReasonLabel: Record<SettlementLine["reason"], string> = {
  cash_collection: "Efectivo recibido para recarga", wallet_purchase_fulfillment: "Venta con PIKAS Cash", wallet_refund_correction: "Reembolso de una venta con PIKAS Cash",
  legacy_purchase_refund: "Reembolso de una venta anterior a la activación", cash_collection_reversal: "Recarga en efectivo revertida por PIKAS",
};
export const lineGroups = [
  { key: "cash", title: "Efectivo recibido para PIKAS Cash", reasons: ["cash_collection"] },
  { key: "sales", title: "Ventas pagadas con PIKAS Cash", reasons: ["wallet_purchase_fulfillment"] },
  { key: "corrections", title: "Reembolsos y correcciones", reasons: ["wallet_refund_correction", "legacy_purchase_refund", "cash_collection_reversal"] },
] as const;
export const lineSource = (l: SettlementLine) => l.reason === "cash_collection" || l.reason === "cash_collection_reversal"
  ? [l.replenishment_reference, l.student].filter(Boolean).join(" · ")
  : [l.receipt_number ? `Recibo #${l.receipt_number}` : null, l.refund_ordinal ? `reembolso ${l.refund_ordinal}` : null, l.student].filter(Boolean).join(" · ");

export const reviewReasons = [["cash_total_differs", "El efectivo recibido no coincide"], ["wallet_sales_differ", "Las ventas con PIKAS Cash no coinciden"], ["refund_missing", "Falta un reembolso"],
  ["payment_differs", "El pago no coincide"], ["cafeteria_dispute", "La cafetería reporta una diferencia"], ["other", "Otro motivo"]] as const;
export const reviewReasonLabel = (id: string | null) => reviewReasons.find(([r]) => r === id)?.[1] ?? id ?? "—";
export const eventLabel = (e: SettlementEvent, direction: SettlementDirection) => ({
  finalized: e.to_status === "settled" ? "Liquidación calculada sin saldo pendiente" : "Liquidación calculada",
  payment_confirmed: direction === "clearing_to_cafeteria" ? "Pago a la cafetería confirmado" : "Pago de la cafetería confirmado",
  payment_mismatch: "Pago registrado con un monto distinto: en revisión",
  review_opened: "Puesta en revisión", review_resolved: "Revisión resuelta",
}[e.kind]);

// ── Commands (the API adds the Idempotency-Key) ────────────────────────────────────────────────
const positiveMinor = z.string().regex(/^[1-9][0-9]{0,14}$/);
export const settlementCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("finalize"), cafeteria_id: z.guid(), week_start: day }).strict(),
  z.object({ operation: z.literal("run") }).strict(),
  z.object({ operation: z.literal("payment"), reference: settlementReference, amount_minor: positiveMinor, payment_reference: z.string().trim().min(3).max(120),
    paid_on: day, note: z.string().trim().max(500).default("") }).strict(),
  z.object({ operation: z.literal("review"), reference: settlementReference, action: z.enum(["open", "resolve"]), reason: z.enum(reviewReasons.map(([r]) => r) as [string, ...string[]]).nullable(),
    note: z.string().trim().max(500).default("") }).strict()
    .refine(v => v.action === "resolve" ? v.note.length >= 3 : v.reason !== null && (v.reason !== "other" || v.note.length >= 3)),
]);
export type SettlementCommand = z.infer<typeof settlementCommandSchema>;
const resultSettlement = z.object({ reference: settlementReference, status: settlementStatusSchema, net_direction: directionSchema, net_amount_minor: minor, replayed: z.boolean() });
export const settlementResultSchema = z.union([
  resultSettlement.extend({ event: z.string().optional() }),
  z.object({ count: z.number().int(), finalized: z.array(resultSettlement) }),
]);

// Business refusals reported by name (422); anything else is uncertain.
export const settlementRejections = new Set([
  "PERIOD_NOT_ENDED", "EARLIER_PERIOD_PENDING", "NOTHING_TO_SETTLE", "INVALID_SETTLEMENT_WEEK", "FINANCIAL_POLICY_NOT_ACTIVE", "SETTLEMENT_SANDBOX_REFUSED",
  "SETTLEMENT_NOT_FOUND", "SETTLEMENT_ALREADY_SETTLED", "SETTLEMENT_STATUS_CONFLICT", "IDEMPOTENCY_CONFLICT", "INVALID_PAYMENT_AMOUNT",
  "INVALID_PAYMENT_REFERENCE", "INVALID_PAYMENT_DATE", "INVALID_REVIEW_REASON", "INVALID_SETTLEMENT_NOTE", "INVALID_SETTLEMENT_ACTION", "SETTLEMENT_CURRENCY_MISMATCH",
]);
export const settlementMessage = (code: string | undefined): string => ({
  PERIOD_NOT_ENDED: "La semana todavía no ha terminado. Se puede liquidar a partir del lunes.",
  EARLIER_PERIOD_PENDING: "Hay una semana anterior de esta cafetería sin liquidar. Liquídala primero.",
  NOTHING_TO_SETTLE: "No hay movimientos por liquidar en esta semana.",
  INVALID_SETTLEMENT_WEEK: "La semana no es válida.",
  FINANCIAL_POLICY_NOT_ACTIVE: "El modelo financiero de PIKAS Cash no está activo para este cliente.",
  SETTLEMENT_SANDBOX_REFUSED: "Un cliente de demostración no tiene liquidaciones reales.",
  SETTLEMENT_NOT_FOUND: "No encontramos esta liquidación.",
  SETTLEMENT_ALREADY_SETTLED: "Esta liquidación ya está liquidada.",
  SETTLEMENT_STATUS_CONFLICT: "El estado de esta liquidación cambió. Revisa el estado actual.",
  IDEMPOTENCY_CONFLICT: "Esta operación ya fue procesada.",
  platform_operation_conflict: "Esta operación ya fue procesada.",
  INVALID_PAYMENT_AMOUNT: "Escribe el monto recibido o pagado.",
  INVALID_PAYMENT_REFERENCE: "Escribe la referencia del pago (al menos 3 caracteres).",
  INVALID_PAYMENT_DATE: "La fecha del pago no puede ser futura.",
  INVALID_REVIEW_REASON: "Selecciona el motivo de la revisión.",
  INVALID_SETTLEMENT_NOTE: "Escribe una nota (al menos 3 caracteres).",
  platform_authorization_required: "No tienes permiso para esta operación financiera.",
  authentication_required: "Tu sesión terminó. Inicia sesión de nuevo.",
} as Record<string, string>)[code ?? ""] ?? "PIKAS no pudo completar la operación. No se registró ningún cambio.";
export const settledByOthers = new Set(["SETTLEMENT_ALREADY_SETTLED", "SETTLEMENT_STATUS_CONFLICT", "IDEMPOTENCY_CONFLICT", "platform_operation_conflict"]);

// RD$ amount typed by an operator → integer centavos (never floating point).
export function parseAmount(text: string): string | null {
  const m = text.trim().replace(/^RD\$\s*/i, "").replace(/,/g, "").match(/^(\d{1,13})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const value = BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
  return value > 0n ? value.toString() : null;
}
