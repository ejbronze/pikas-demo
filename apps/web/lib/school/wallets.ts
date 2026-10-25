import { z } from "zod";
import type { WalletReport } from "./wallet-report";

// PIKAS UX 7 School PIKAS Cash: student wallet administration. Reads are existing School reads under
// school:wallets:read (school_wallet_report; student_wallets row policy) and the roster/student
// reads; everything is reduced on the server to wallet state and balance per student plus a few
// aggregates. Purchases, purchase lines, receipts and per-cafetería spending never reach this page.

// Overview: wallet aggregates only (the report's period movements and per-cafetería spending dropped).
export type WalletOverview = { wallet_count: number; active: number; frozen: number; negative: number; total_balance_minor: string; with_movement: number; from: string; to: string };
export const walletOverview = (r: WalletReport): WalletOverview => ({ wallet_count: r.current.wallet_count, active: r.current.active_wallet_count, frozen: r.current.frozen_wallet_count,
  negative: r.current.negative_wallet_count, total_balance_minor: r.current.total_balance_minor, with_movement: r.movements.wallets_with_movement, from: r.from, to: r.to });

// One row per student: identity from the roster/student read, wallet from the student_wallets row.
export const walletRowsSchema = z.array(z.object({ student_id: z.guid(), status: z.enum(["active", "frozen"]), current_balance_minor: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
  display_name: z.string().optional(), student_code: z.string().optional(), student_status: z.enum(["active", "suspended", "inactive"]).optional() }));
export const studentRowsSchema = z.array(z.object({ id: z.guid(), display_name: z.string(), student_code: z.string(), status: z.enum(["active", "suspended", "inactive"]) }));
export type WalletStudent = { id: string; name: string; code: string; status: "active" | "suspended" | "inactive"; wallet: { status: "active" | "frozen"; balance_minor: string } | null };
export function joinWallets(students: z.infer<typeof studentRowsSchema>, wallets: z.infer<typeof walletRowsSchema>): WalletStudent[] {
  const byStudent = new Map(wallets.map(w => [w.student_id, w] as const));
  return students.map(s => { const w = byStudent.get(s.id);
    return { id: s.id, name: s.display_name, code: s.student_code, status: s.status, wallet: w ? { status: w.status, balance_minor: String(w.current_balance_minor) } : null }; });
}

// Attention: frozen wallets and wallets below zero, the two wallet states the product records.
export const needsAttention = (s: WalletStudent) => !!s.wallet && (s.wallet.status === "frozen" || s.wallet.balance_minor.startsWith("-"));
export const walletLabel = (w: WalletStudent["wallet"]) => !w ? "Sin monedero" : w.status === "frozen" ? "Congelado" : "Activo";
