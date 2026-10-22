import { z } from 'zod';
import { reportPeriods } from '../cafeteria/reports';

// Phase 5D.5 School PIKAS Cash report (public.school_wallet_report). Every total is computed by the
// database from the school's wallet ledger; the browser validates and formats. This is wallet
// activity only — never cafeteria sales, other tenders or register cash.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.string().regex(/^(0|[1-9][0-9]*)$/);
const signed = z.string().regex(/^(0|-?[1-9][0-9]*)$/);
const count = z.number().int().min(0);
const tally = z.object({ amount_minor: amount, count }).strict();

export const walletReportSchema = z.object({
  school_id: z.guid(), tenant_kind: z.enum(['customer', 'sandbox']), business_timezone: z.string().min(1), currency_code: z.literal('DOP'),
  period: z.enum(reportPeriods), from: isoDate, to: isoDate, today: isoDate, as_of: z.string(),
  current: z.object({ total_balance_minor: signed, wallet_count: count, active_wallet_count: count, frozen_wallet_count: count,
    negative_wallet_count: count, negative_balance_minor: signed }).strict(),
  movements: z.object({ replenishments: tally, reversals: tally, net_replenished_minor: signed, purchases: tally, refunds: tally,
    adjustment_credits: tally, adjustment_debits: tally, historical_adjustments: z.object({ net_minor: signed, count }).strict(),
    net_movement_minor: signed, entry_count: count, wallets_with_movement: count }).strict(),
  cafeterias: z.array(z.object({ cafeteria_id: z.guid(), name: z.string(), spent_minor: amount, purchase_count: count, refunded_minor: amount, refund_count: count }).strict()),
}).strict();
export type WalletReport = z.infer<typeof walletReportSchema>;

// What School pages render (UX 7, UX 8 Reportes): the report without the per-cafetería breakdown. School
// sees its students' wallets, not where they spent by cafetería; the RPC result is validated in full first.
export const walletReportViewSchema = walletReportSchema.omit({ cafeterias: true });
export type WalletReportView = z.infer<typeof walletReportViewSchema>;
