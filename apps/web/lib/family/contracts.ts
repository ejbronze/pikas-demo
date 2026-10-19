import { z } from "zod";

// Family-safe read shapes for the Parent (guardian) and Student experiences. They intentionally
// mirror what future server-side family reads will return, derived from existing PIKAS data
// (students, placements, student_wallets, wallet_ledger_entries, purchases, purchase_items, refunds,
// student_spending_controls, student_dietary_restrictions, cafeteria sharing). They never carry
// cashier identities, audit/journal/request ids, internal reasons or other students' data.
// Today they are filled only by deterministic demo scenarios; Parent/Student are not connected.
const id = z.string().min(1);
const minor = z.string().regex(/^-?(0|[1-9][0-9]*)$/);
const isoTime = z.string().min(1);

export const walletSummarySchema = z.object({ status: z.enum(["active", "frozen"]), balance_minor: minor }).strict();
export const spendingControlsSchema = z.object({
  daily_limit_minor: minor.nullable(),          // null = no daily limit
  per_purchase_limit_minor: minor.nullable(),   // null = no per-purchase limit
  spent_today_minor: minor,                     // PIKAS Cash spent today (server business day)
}).strict();
export const restrictionSchema = z.object({ kind: z.enum(["allergen", "dietary", "avoidance"]), label: z.string().min(1) }).strict();
export const studentSummarySchema = z.object({
  student_id: id, display_name: z.string().min(1), first_name: z.string().min(1),
  school_name: z.string().min(1), campus_name: z.string().nullable(), grade: z.string().nullable(), class_label: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
  cafeteria_access: z.boolean(),                // a cafeteria of the school can sell to this student
  wallet: walletSummarySchema.nullable(),       // null = no PIKAS Cash wallet yet
  controls: spendingControlsSchema, restrictions: z.array(restrictionSchema),
  last_purchase_at: isoTime.nullable(),
}).strict();
export const purchaseItemSchema = z.object({ name: z.string().min(1), quantity: z.number().int().positive(), line_total_minor: minor, refunded_quantity: z.number().int().min(0) }).strict();
export const purchaseSummarySchema = z.object({
  purchase_id: id, receipt_number: z.string().regex(/^[1-9][0-9]*$/), cafeteria_name: z.string().min(1), purchased_at: isoTime,
  payment: z.enum(["student_wallet", "cash"]), total_minor: minor,
  refund_status: z.enum(["none", "partial", "full"]), refunded_minor: minor, items: z.array(purchaseItemSchema).min(1),
}).strict();
export const walletActivitySchema = z.object({
  id, type: z.enum(["replenishment", "purchase", "refund", "adjustment", "replenishment_reversal"]),
  amount_minor: minor, balance_after_minor: minor, occurred_at: isoTime,
  cafeteria_name: z.string().nullable(), receipt_number: z.string().nullable(),
}).strict();
export const studentActivitySchema = z.object({ student: studentSummarySchema, purchases: z.array(purchaseSummarySchema), activity: z.array(walletActivitySchema) }).strict();
export const guardianProfileSchema = z.object({ display_name: z.string().min(1), email: z.string().nullable(), username: z.string().nullable(), phone: z.string().nullable() }).strict();
export const guardianOverviewSchema = z.object({ guardian: guardianProfileSchema, children: z.array(studentActivitySchema) }).strict();

export type WalletSummary = z.infer<typeof walletSummarySchema>;
export type SpendingControls = z.infer<typeof spendingControlsSchema>;
export type Restriction = z.infer<typeof restrictionSchema>;
export type StudentSummary = z.infer<typeof studentSummarySchema>;
export type PurchaseSummary = z.infer<typeof purchaseSummarySchema>;
export type WalletActivity = z.infer<typeof walletActivitySchema>;
export type StudentActivity = z.infer<typeof studentActivitySchema>;
export type GuardianProfile = z.infer<typeof guardianProfileSchema>;
export type GuardianOverview = z.infer<typeof guardianOverviewSchema>;
export type FamilyRead<T> = { kind: "ready"; value: T } | { kind: "unavailable" };
