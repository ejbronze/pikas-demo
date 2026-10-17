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
export const requestSchema = z.union([creditSchema, reversalSchema, z.object({ operation: z.literal('read'), school_id: z.guid(), student_id: z.guid(), before: minorSchema.nullable() }).strict()]);
export const resultSchema = z.object({ request_key: z.uuid(), school_id: z.guid(), student_id: z.guid(), wallet_id: z.guid(), replenishment_id: z.guid(), amount_minor: minorSchema, balance_after_minor: signedMinorSchema, version: minorSchema });
export const reversalResultSchema = z.object({ request_key: z.uuid(), school_id: z.guid(), student_id: z.guid(), reversal_id: z.guid(), replenishment_id: z.guid(),
  amount_minor: minorSchema, balance_after_minor: signedMinorSchema, reason: z.string(), reversed_at: z.string() }).strict();
export const historySchema = z.object({ school_id: z.guid(), student_id: z.guid(), student_name: z.string(), wallet: z.object({ id: z.guid(), status: z.enum(['active','frozen']), currency: z.literal('DOP'), balance_minor: signedMinorSchema, version: minorSchema }).nullable(), movements: z.array(z.object({ id: z.guid(), type: z.enum(['replenishment','purchase','adjustment','refund','replenishment_reversal']), amount_minor: z.string().regex(/^-?[1-9][0-9]*$/), balance_after_minor: signedMinorSchema, version: minorSchema, occurred_at: z.string(), source: z.string().nullable(), reference: z.string().nullable(), note: z.string().nullable(), actor: z.string().nullable(), replenishment_id: z.guid().nullable(), purchase_id: z.guid().nullable(), receipt_number: minorSchema.nullable(), cafeteria: z.string().nullable(), items: z.array(z.object({ name: z.string(), quantity: z.number().int(), line_total_minor: minorSchema })),
  reversal_id: z.guid().nullable().optional(), reversed_replenishment_id: z.guid().nullable().optional(), reversal_reason: z.string().nullable().optional(), reversal_note: z.string().nullable().optional(),
  reversed_at: z.string().nullable().optional(), original_reference: z.string().nullable().optional(), original_note: z.string().nullable().optional(), original_amount_minor: minorSchema.nullable().optional() })), next_before: minorSchema.nullable() });
export type History = z.infer<typeof historySchema>;
export const accessSchema = z.object({ school_id: z.guid(), read: z.boolean(), replenish: z.boolean(), reverse: z.boolean() }).strict();
export type WalletAccess = z.infer<typeof accessSchema>;
export const cafeteriaRequestSchema = z.object({ cafeteria_id: z.guid(), query: z.string().trim().max(80) }).strict();
export const cafeteriaReadSchema = z.object({ cafeteria_id: z.guid(), students: z.array(z.object({ student_id: z.guid(), display_name: z.string(), wallet_status: z.enum(['active','frozen']).nullable(), balance_minor: signedMinorSchema }).strict()).max(25) }).strict();
export type CafeteriaWalletRead = z.infer<typeof cafeteriaReadSchema>;
