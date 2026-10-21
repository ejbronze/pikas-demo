import { describe, expect, it } from "vitest";
import { joinWallets, needsAttention, walletLabel, walletRowsSchema } from "./wallets";

const a = "4d700000-0000-4000-8000-000000000101", b = "4d700000-0000-4000-8000-000000000102";
describe("school wallet rows", () => {
  it("joins by student and keeps students without a wallet, in roster order", () => {
    const rows = joinWallets([{ id: b, display_name: "Beto", student_code: "E2", status: "active" }, { id: a, display_name: "Ana", student_code: "E1", status: "suspended" }],
      [{ student_id: a, status: "frozen", current_balance_minor: 0 }]);
    expect(rows.map(r => r.name)).toEqual(["Beto", "Ana"]);
    expect(rows[0].wallet).toBeNull(); expect(rows[1].wallet).toEqual({ status: "frozen", balance_minor: "0" });
  });
  it("attention means frozen or below zero; zero balance is not attention", () => {
    const s = (wallet: { status: "active" | "frozen"; balance_minor: string } | null) => ({ id: a, name: "A", code: "E", status: "active" as const, wallet });
    expect(needsAttention(s(null))).toBe(false); expect(needsAttention(s({ status: "active", balance_minor: "0" }))).toBe(false);
    expect(needsAttention(s({ status: "active", balance_minor: "-1" }))).toBe(true); expect(needsAttention(s({ status: "frozen", balance_minor: "100" }))).toBe(true);
    expect([walletLabel(null), walletLabel({ status: "active", balance_minor: "0" }), walletLabel({ status: "frozen", balance_minor: "0" })]).toEqual(["Sin monedero", "Activo", "Congelado"]);
  });
  it("rejects unexpected wallet states and non-integer balances", () => {
    expect(walletRowsSchema.safeParse([{ student_id: a, status: "closed", current_balance_minor: 1 }]).success).toBe(false);
    expect(walletRowsSchema.safeParse([{ student_id: a, status: "active", current_balance_minor: "1.5" }]).success).toBe(false);
  });
});
