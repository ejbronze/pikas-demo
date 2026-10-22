import { z } from "zod";

// FIN 3 Platform finance operations. Reads: platform_finance_replenishments_read and
// platform_finance_replenishment_detail (platform:finance:read). Mutations: the FIN 2 wrappers
// platform_finance_decide_bank_replenishment (…:verify) and platform_finance_reverse_replenishment
// (…:reverse). The database re-checks every capability; nothing here grants authority.
export const FINANCE_READ = "platform:finance:read";
export const FINANCE_VERIFY = "platform:finance:replenishments:verify";
export const FINANCE_REVERSE = "platform:finance:replenishments:reverse";

const minor = z.string().regex(/^-?[0-9]+$/);
const reference = z.string().regex(/^REC-[0-9]{8}$/);
export const statusSchema = z.enum(["pending", "posted", "rejected", "reversed"]);
export type FinanceStatus = z.infer<typeof statusSchema>;

export const listRowSchema = z.object({
  reference, status: statusSchema, customer: z.string(), school: z.string(), student: z.string(), student_code: z.string().nullable(),
  gross_minor: minor, fee_minor: minor, net_minor: minor, payer_reference: z.string().nullable(), has_proof: z.boolean(),
  submitted_at: z.string(), decided_at: z.string().nullable(), reversed_at: z.string().nullable(),
  decided_by: z.string().nullable(), reversed_by: z.string().nullable(),
});
export type FinanceListRow = z.infer<typeof listRowSchema>;
export const listSchema = z.object({ view: z.enum(["pending", "history"]), status: z.string().nullable(), query: z.string().nullable(), requests: z.array(listRowSchema), truncated: z.boolean() });

export const detailSchema = z.object({
  reference, status: statusSchema, method: z.literal("bank_transfer"), customer: z.string(), customer_activated: z.boolean(), school: z.string(),
  student: z.string(), student_code: z.string().nullable(), currency: z.string(), policy_version: z.number().int(), fee_bps: z.number().int(),
  gross_minor: minor, fee_minor: minor, net_minor: minor,
  payer_reference: z.string().nullable(), payer_name: z.string().nullable(), payer_note: z.string().nullable(), proof_reference: z.string().nullable(),
  submitted_at: z.string(), submitted_by: z.string().nullable(), submitted_role: z.string(),
  decided_at: z.string().nullable(), decided_by: z.string().nullable(), rejection_reason: z.string().nullable(), posted_at: z.string().nullable(),
  reversal: z.object({ reversed_at: z.string(), reason: z.string(), note: z.string().nullable(), reversed_by: z.string().nullable(), gross_minor: minor, fee_minor: minor, net_minor: minor }).nullable(),
  wallet: z.object({ status: z.enum(["active", "frozen"]), balance_minor: minor, covers_net: z.boolean() }).nullable(),
});
export type FinanceDetail = z.infer<typeof detailSchema>;

// URL filters: anything else is refused before the read (never broadens it).
export const filtersSchema = z.object({
  vista: z.enum(["pendientes", "historial"]).default("pendientes"),
  estado: z.enum(["verificadas", "rechazadas", "revertidas", ""]).default(""),
  q: z.string().trim().max(80).default(""),
});
export const estadoToStatus = { verificadas: "posted", rechazadas: "rejected", revertidas: "reversed" } as const;

export const statusLabel: Record<FinanceStatus, string> = { pending: "Por verificar", posted: "Verificada", rejected: "Rechazada", reversed: "Revertida" };
export const statusTone: Record<FinanceStatus, string> = {
  pending: "bg-amber-100 text-amber-950", posted: "bg-emerald-100 text-emerald-900", rejected: "bg-slate-200 text-slate-900", reversed: "bg-rose-100 text-rose-900",
};
export const submittedRoleLabel: Record<string, string> = { platform_operator: "Operación PIKAS", school_admin: "Administración escolar", account_admin: "Administración de cuenta", cafeteria_staff: "Cafetería" };
export const reversalReasons = [["wrong_amount", "Monto incorrecto"], ["wrong_student", "Estudiante incorrecto"], ["duplicate_replenishment", "Recarga duplicada"], ["wrong_verification", "Verificación incorrecta"], ["other", "Otro motivo"]] as const;
export const reversalReasonLabel = (id: string) => reversalReasons.find(([r]) => r === id)?.[1] ?? id;

// Commands (the API adds the Idempotency-Key as the decision/reversal key).
export const decisionSchema = z.discriminatedUnion("decision", [
  z.object({ reference, decision: z.literal("approve") }).strict(),
  z.object({ reference, decision: z.literal("reject"), reason: z.string().trim().min(3).max(500) }).strict(),
]);
export type FinanceDecision = z.infer<typeof decisionSchema>;
export const reversalSchema = z.object({ reference, reason: z.enum(["wrong_amount", "wrong_student", "duplicate_replenishment", "wrong_verification", "other"]), note: z.string().trim().max(500).default("") })
  .strict().refine(v => v.reason !== "other" || v.note.length >= 3);
export type FinanceReversal = z.infer<typeof reversalSchema>;
// Results reduced to operator-safe fields (the FIN 2 result also carries internal identifiers).
export const decisionResultSchema = z.object({ reference, state: z.enum(["posted", "rejected"]), gross_minor: minor, fee_minor: minor, net_minor: minor });
export const reversalResultSchema = z.object({ reference, state: z.literal("reversed"), gross_minor: minor, fee_minor: minor, net_minor: minor });

// Business refusals the database reports by name; the API passes only these through (422).
export const financeRejections = new Set([
  "REQUEST_ALREADY_DECIDED", "IDEMPOTENCY_CONFLICT", "REPLENISHMENT_REQUEST_NOT_FOUND", "FINANCIAL_POLICY_NOT_ACTIVE", "wallet_not_active",
  "wallet_requires_active_enrolled_student", "REJECTION_REASON_REQUIRED", "FINANCIAL_RESOLUTION_REQUIRED", "REPLENISHMENT_ALREADY_REVERSED",
  "REPLENISHMENT_NOT_POSTED", "INVALID_REVERSAL_NOTE", "INVALID_REVERSAL_REASON",
]);
export const financeMessage = (code: string | undefined): string => ({
  REQUEST_ALREADY_DECIDED: "Esta solicitud ya fue procesada.",
  IDEMPOTENCY_CONFLICT: "Esta solicitud ya fue procesada.",
  platform_operation_conflict: "Esta solicitud ya fue procesada.",
  REPLENISHMENT_ALREADY_REVERSED: "Esta recarga ya fue revertida.",
  REPLENISHMENT_REQUEST_NOT_FOUND: "No encontramos esta solicitud.",
  REPLENISHMENT_NOT_POSTED: "Solo se puede revertir una recarga verificada.",
  FINANCIAL_POLICY_NOT_ACTIVE: "El modelo financiero de PIKAS Cash no está activo para este cliente.",
  wallet_not_active: "El PIKAS Cash del estudiante está congelado. No se puede acreditar.",
  wallet_requires_active_enrolled_student: "El estudiante no tiene una matrícula activa. No se puede acreditar.",
  REJECTION_REASON_REQUIRED: "Escribe el motivo del rechazo (al menos 3 caracteres).",
  INVALID_REVERSAL_NOTE: "Explica el motivo de la reversión (al menos 3 caracteres).",
  INVALID_REVERSAL_REASON: "Selecciona el motivo de la reversión.",
  FINANCIAL_RESOLUTION_REQUIRED: "No se puede revertir automáticamente porque parte del saldo acreditado ya fue utilizado. Este caso requiere resolución financiera.",
  platform_authorization_required: "No tienes permiso para esta operación financiera.",
  authentication_required: "Tu sesión terminó. Inicia sesión de nuevo.",
} as Record<string, string>)[code ?? ""] ?? "PIKAS no pudo completar la operación. No se movió dinero.";
// Refreshing shows the authoritative state after these.
export const settledByOthers = new Set(["REQUEST_ALREADY_DECIDED", "IDEMPOTENCY_CONFLICT", "platform_operation_conflict", "REPLENISHMENT_ALREADY_REVERSED"]);

// One customer with one colegio usually shares its name: say it once.
export const customerLine = (customer: string, school: string) => customer === school ? customer : `${customer} · ${school}`;
export const financeWhen = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
