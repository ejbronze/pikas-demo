import { z } from 'zod';
import { minorSchema } from '../pos/contracts';
// Wallet balances may be negative after a 5C.2 replenishment reversal (integer minor units).
export const signedMinorSchema = z.string().regex(/^(0|-?[1-9][0-9]{0,18})$/);
export const creditSchema = z.object({ operation: z.literal('replenish'), school_id: z.guid(), student_id: z.guid(), amount_minor: minorSchema.refine(v => BigInt(v) > 0n), reference: z.string().trim().max(160), note: z.string().trim().max(500), request_key: z.uuid() }).strict().refine(v => !!(v.reference || v.note));
export type Credit = z.infer<typeof creditSchema>;
export const reversalReasons = [['wrong_amount','Monto incorrecto'],['wrong_student','Estudiante incorrecto'],['duplicate_replenishment','Recarga duplicada'],['wrong_verification','Pago/verificación incorrecta'],['other','Otro']] as const;
export const reversalSchema = z.object({ operation: z.literal('reverse'), school_id: z.guid(), student_id: z.guid(), replenishment_id: z.guid(),
  reason: z.enum(['wrong_amount','wrong_student','duplicate_replenishment','wrong_verification','other']), note: z.string().trim().max(500), request_key: z.uuid() })
  .strict().refine(v => v.reason !== 'other' || v.note.length >= 3);
export type Reversal = z.infer<typeof reversalSchema>;
// Phase 5C.3 administrative adjustments: exceptional corrections with a required explanation.
export const adjustmentReasons = [['initial_balance_correction','Corrección de saldo inicial','any'],['administrative_correction','Corrección administrativa','any'],
  ['data_migration_correction','Corrección de migración/datos','any'],['authorized_credit','Crédito autorizado','credit'],['authorized_debit','Débito autorizado','debit'],['other','Otro','any']] as const;
const adjustmentReason = z.enum(['initial_balance_correction','administrative_correction','data_migration_correction','authorized_credit','authorized_debit','other']);
const adjustmentFields = { amount_minor: signedMinorSchema.refine(v => v !== '0'), reason: adjustmentReason, explanation: z.string().trim().min(5).max(500), request_key: z.uuid() };
const directionMatches = (v: { amount_minor: string; reason: string }) => (v.reason !== 'authorized_credit' || !v.amount_minor.startsWith('-')) && (v.reason !== 'authorized_debit' || v.amount_minor.startsWith('-'));
export const adjustSchema = z.object({ operation: z.literal('adjust'), school_id: z.guid(), student_id: z.guid(), ...adjustmentFields }).strict().refine(directionMatches);
export const cafeteriaAdjustSchema = z.object({ operation: z.literal('adjust'), cafeteria_id: z.guid(), student_id: z.guid(), ...adjustmentFields }).strict().refine(directionMatches);
export type Adjustment = z.infer<typeof adjustSchema>;
export type CafeteriaAdjustment = z.infer<typeof cafeteriaAdjustSchema>;
export const adjustResultSchema = z.object({ request_key: z.uuid(), adjustment_id: z.guid(), student_id: z.guid(), amount_minor: signedMinorSchema,
  balance_before_minor: signedMinorSchema, balance_after_minor: signedMinorSchema, reason: z.string(), actor_role: z.enum(['account_admin','school_admin','cafeteria_admin']),
  posted_at: z.string(), school_id: z.guid().optional(), cafeteria_id: z.guid().optional() }).strict();
export const requestSchema = z.union([creditSchema, reversalSchema, adjustSchema, z.object({ operation: z.literal('read'), school_id: z.guid(), student_id: z.guid(), before: minorSchema.nullable() }).strict()]);
export const resultSchema = z.object({ request_key: z.uuid(), school_id: z.guid(), student_id: z.guid(), wallet_id: z.guid(), replenishment_id: z.guid(), amount_minor: minorSchema, balance_after_minor: signedMinorSchema, version: minorSchema });
export const reversalResultSchema = z.object({ request_key: z.uuid(), school_id: z.guid(), student_id: z.guid(), reversal_id: z.guid(), replenishment_id: z.guid(),
  amount_minor: minorSchema, balance_after_minor: signedMinorSchema, reason: z.string(), reversed_at: z.string() }).strict();
export const historySchema = z.object({ school_id: z.guid(), student_id: z.guid(), student_name: z.string(), wallet: z.object({ id: z.guid(), status: z.enum(['active','frozen']), currency: z.literal('DOP'), balance_minor: signedMinorSchema, version: minorSchema }).nullable(), movements: z.array(z.object({ id: z.guid(), type: z.enum(['replenishment','purchase','adjustment','refund','replenishment_reversal']), amount_minor: z.string().regex(/^-?[1-9][0-9]*$/), balance_after_minor: signedMinorSchema, version: minorSchema, occurred_at: z.string(), source: z.string().nullable(), reference: z.string().nullable(), note: z.string().nullable(), actor: z.string().nullable(), actor_kind: z.literal('pikas').nullable().optional(), method: z.enum(['bank_transfer','cafeteria_cash']).nullable().optional(), gross_minor: minorSchema.nullable().optional(), fee_minor: minorSchema.nullable().optional(), net_minor: minorSchema.nullable().optional(), replenishment_id: z.guid().nullable(), purchase_id: z.guid().nullable(), receipt_number: minorSchema.nullable(), cafeteria: z.string().nullable(), items: z.array(z.object({ name: z.string(), quantity: z.number().int(), line_total_minor: minorSchema })),
  reversal_id: z.guid().nullable().optional(), reversed_replenishment_id: z.guid().nullable().optional(), reversal_reason: z.string().nullable().optional(), reversal_note: z.string().nullable().optional(),
  reversed_at: z.string().nullable().optional(), adjustment_reason: z.string().nullable().optional(), actor_role: z.string().nullable().optional(), balance_before_minor: signedMinorSchema.nullable().optional(), original_reference: z.string().nullable().optional(), original_note: z.string().nullable().optional(), original_amount_minor: minorSchema.nullable().optional() })), next_before: minorSchema.nullable() });
export type History = z.infer<typeof historySchema>;
export const accessSchema = z.object({ school_id: z.guid(), read: z.boolean(), replenish: z.boolean(), reverse: z.boolean(), adjust: z.boolean() }).strict();
export type WalletAccess = z.infer<typeof accessSchema>;
export const cafeteriaReadRequestSchema = z.object({ cafeteria_id: z.guid(), query: z.string().trim().max(80) }).strict();
export const cafeteriaRequestSchema = z.union([cafeteriaReadRequestSchema, cafeteriaAdjustSchema]);
export const cafeteriaReadSchema = z.object({ cafeteria_id: z.guid(), students: z.array(z.object({ student_id: z.guid(), display_name: z.string(), wallet_status: z.enum(['active','frozen']).nullable(), balance_minor: signedMinorSchema }).strict()).max(25) }).strict();
export type CafeteriaWalletRead = z.infer<typeof cafeteriaReadSchema>;
