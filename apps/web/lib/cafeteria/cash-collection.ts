import { z } from "zod";
import { sessionFetch } from "../auth/session-fetch";
import { minorSchema } from "../pos/contracts";

// FIN 4 Cafetería cash collection. The database is authoritative (cafeteria_wallet_collect_cash and
// cafeteria_cash_collections_read); this module only shapes requests, previews the arithmetic the database will
// perform, and journals an in-flight request so an uncertain outcome can only be retried with the same key.
export const COLLECT_CASH = "cafeteria:wallets:collect_cash";

// Preview of pikas_private.replenishment_fee_minor: div(gross × bps + 5000, 10000), half-up, integer centavos.
export function cashPreview(grossMinor: string, feeBps: number): { gross: string; fee: string; net: string } {
  const gross = BigInt(grossMinor), fee = (gross * BigInt(feeBps) + 5000n) / 10000n;
  return { gross: gross.toString(), fee: fee.toString(), net: (gross - fee).toString() };
}
export const feePercent = (bps: number) => `${(bps / 100).toLocaleString("es-DO", { maximumFractionDigits: 2 })} %`;

export const collectSchema = z.object({
  operation: z.literal("collect"), cafeteria_id: z.guid(), student_id: z.guid(), student_name: z.string().min(1).max(200),
  gross_minor: minorSchema.refine(v => BigInt(v) > 0n), payer_name: z.string().trim().max(160), request_key: z.uuid(),
}).strict();
export type CashCommand = z.infer<typeof collectSchema>;
export const readRequestSchema = z.object({ operation: z.literal("read"), cafeteria_id: z.guid(), before: z.string().regex(/^REC-[0-9]{8}$/).nullable() }).strict();
export const requestSchema = z.discriminatedUnion("operation", [collectSchema, readRequestSchema]);

const reference = z.string().regex(/^REC-[0-9]{8}$/);
export const collectResultSchema = z.object({
  request_key: z.uuid(), reference, state: z.literal("posted"), cafeteria_id: z.guid(), student_id: z.guid(), student_name: z.string(),
  gross_minor: minorSchema, fee_minor: minorSchema, net_minor: minorSchema, fee_bps: z.number().int(), balance_after_minor: z.string().regex(/^-?[0-9]+$/),
  collected_at: z.string(), collected_by: z.string().nullable(), payer_name: z.string().nullable(), replayed: z.boolean(),
}).strict();
export type CashResult = z.infer<typeof collectResultSchema>;
export const collectionRowSchema = z.object({
  reference, status: z.enum(["posted", "reversed"]), student_id: z.guid(), student_name: z.string(), student_code: z.string().nullable(),
  gross_minor: minorSchema, fee_minor: minorSchema, net_minor: minorSchema, fee_bps: z.number().int(),
  collected_at: z.string(), collected_by: z.string().nullable(), payer_name: z.string().nullable(), reversed_at: z.string().nullable(),
}).strict();
export type CashCollectionRow = z.infer<typeof collectionRowSchema>;
export const readSchema = z.object({
  cafeteria_id: z.guid(), enabled: z.boolean(), fee_bps: z.number().int().nullable(), policy_version: z.number().int().nullable(), currency: z.string().nullable(),
  collections: z.array(collectionRowSchema).max(25), next_before: reference.nullable(),
}).strict();
export type CashCollectionRead = z.infer<typeof readSchema>;

// Business refusals the database names; the API passes only these through (422), everything else is uncertain.
export const cashRejections = new Set(["FINANCIAL_POLICY_NOT_ACTIVE", "wallet_not_active", "active_enrollment_required_for_replenishment", "student_not_served_by_cafeteria",
  "cash_collection_authority_required", "cafeteria_authority_required", "demo_mode_active", "IDEMPOTENCY_CONFLICT", "INVALID_GROSS_AMOUNT", "INVALID_PAYER_NAME",
  "wallet_requires_active_enrolled_student", "not_authorized_for_student_replenishment", "wallet_balance_overflow"]);
export const cashMessage = (code: string | undefined): string => ({
  FINANCIAL_POLICY_NOT_ACTIVE: "Las recargas en efectivo no están habilitadas para este cliente. No se registró nada.",
  wallet_not_active: "El PIKAS Cash de este estudiante está congelado y no puede recibir recargas. Devuelve el efectivo; el colegio puede revisar el monedero.",
  active_enrollment_required_for_replenishment: "El estudiante no tiene una matrícula activa. No se puede recargar; devuelve el efectivo.",
  wallet_requires_active_enrolled_student: "El estudiante no tiene una matrícula activa. No se puede recargar; devuelve el efectivo.",
  student_not_served_by_cafeteria: "Este estudiante no está habilitado para esta cafetería. El colegio decide a quién atiende cada cafetería.",
  not_authorized_for_student_replenishment: "Este estudiante no está habilitado para esta cafetería. El colegio decide a quién atiende cada cafetería.",
  cash_collection_authority_required: "Tu rol no puede recibir efectivo para PIKAS Cash. Solo la administración de la cafetería puede hacerlo.",
  cafeteria_authority_required: "No puedes recibir efectivo en esta cafetería ahora: tu acceso o la cafetería no están activos.",
  demo_mode_active: "En el Demo no se reciben recargas en efectivo. Sal del Demo para operar con un cliente real.",
  IDEMPOTENCY_CONFLICT: "Esta recarga ya se registró con otros datos. Revisa el historial antes de intentarlo de nuevo.",
  INVALID_GROSS_AMOUNT: "Escribe el efectivo recibido: un monto positivo con hasta dos decimales.",
  INVALID_PAYER_NAME: "El nombre de quien entrega el efectivo es demasiado largo.",
  wallet_balance_overflow: "El monto no se puede acreditar. Revisa la cantidad.",
} as Record<string, string>)[code ?? ""] ?? "PIKAS no pudo registrar la recarga. No se movió dinero.";

// Journal: one in-flight request per operator and Cafetería, cleared only by an authoritative answer.
export const cashJournalKey = (actorId: string, cafeteriaId: string) => `pikas:cash-collection:${actorId}:${cafeteriaId}`;
const journalSchema = z.object({ command: collectSchema }).strict();
export function loadJournal(storage: Pick<Storage, "getItem">, key: string): CashCommand | null {
  const raw = storage.getItem(key); if (raw === null) return null;
  const parsed = journalSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data.command : null;
}
export function prepareJournal(storage: Pick<Storage, "getItem" | "setItem">, key: string, command: CashCommand): CashCommand {
  const prior = loadJournal(storage, key); if (prior) return prior;
  const parsed = collectSchema.parse(command); storage.setItem(key, JSON.stringify({ command: parsed })); return parsed;
}
export type SendOutcome = { outcome: "success"; result: CashResult } | { outcome: "rejected"; code: string } | { outcome: "uncertain" };
export async function sendCollection(command: CashCommand, transport: typeof fetch = sessionFetch): Promise<SendOutcome> {
  try {
    const response = await transport("/api/cafeteria/cash-collection", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": command.request_key }, body: JSON.stringify(command) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return response.status === 422 || response.status === 403 ? { outcome: "rejected", code: String(body.error ?? "") } : { outcome: "uncertain" };
    const parsed = collectResultSchema.safeParse(body.result);
    if (!parsed.success || parsed.data.request_key !== command.request_key || parsed.data.student_id !== command.student_id || parsed.data.cafeteria_id !== command.cafeteria_id
      || parsed.data.gross_minor !== command.gross_minor) return { outcome: "uncertain" };
    return { outcome: "success", result: parsed.data };
  } catch { return { outcome: "uncertain" }; }
}
export const cashWhen = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
