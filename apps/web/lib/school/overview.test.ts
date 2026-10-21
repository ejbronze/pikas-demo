import { describe, expect, it } from "vitest";
import { schoolAttention, serviceChecks, serviceRows, walletSummary } from "./overview";
import { inputs, service, wallet } from "./overview-fixtures";
import { walletReportSchema } from "./wallet-report";

const report = walletReportSchema.parse({ school_id: "4d700000-0000-4000-8000-000000000001", tenant_kind: "customer", business_timezone: "America/Santo_Domingo", currency_code: "DOP", period: "last_7_days",
  from: "2026-10-15", to: "2026-10-21", today: "2026-10-21", as_of: "2026-10-21T12:00:00Z",
  current: { total_balance_minor: "21438000", wallet_count: 380, active_wallet_count: 371, frozen_wallet_count: 1, negative_wallet_count: 2, negative_balance_minor: "-2500" },
  movements: { replenishments: { amount_minor: "500000", count: 5 }, reversals: { amount_minor: "0", count: 0 }, net_replenished_minor: "500000", purchases: { amount_minor: "987600", count: 812 }, refunds: { amount_minor: "8500", count: 1 },
    adjustment_credits: { amount_minor: "0", count: 0 }, adjustment_debits: { amount_minor: "0", count: 0 }, historical_adjustments: { net_minor: "0", count: 0 }, net_movement_minor: "-487600", entry_count: 818, wallets_with_movement: 248 },
  cafeterias: [{ cafeteria_id: "4d700000-0000-4000-8000-000000000101", name: "Cafetería Ficticia 1", spent_minor: "987600", purchase_count: 812, refunded_minor: "8500", refund_count: 1 }] });

describe("server-side reduction", () => {
  it("keeps only wallet aggregates: no per-cafetería spending, purchase or refund amounts", () => {
    const w = walletSummary(report);
    expect(w).toEqual({ active_wallets: 371, frozen_wallets: 1, negative_wallets: 2, total_balance_minor: "21438000", wallets_with_movement: 248, from: "2026-10-15", to: "2026-10-21" });
    expect(JSON.stringify(w)).not.toMatch(/987600|8500|spent|purchase|refund|Cafetería/);
  });
  it("cafeterías become counts, never student names; 100 means the read's limit", () => {
    const rows = serviceRows([{ id: "c1", name: "Cafetería Ficticia", location: "Sede", status: "active", sharing_status: "active", customers: Array.from({ length: 100 }, (_, i) => ({ student_id: `s${i}`, display_name: `Estudiante ${i}`, status: "active" })) }]);
    expect(rows).toEqual([{ id: "c1", name: "Cafetería Ficticia", location: "Sede", active: true, sharing: true, enabled_students: 100, enabled_capped: true }]);
    expect(JSON.stringify(rows)).not.toContain("Estudiante");
  });
});

describe("school-side service checks", () => {
  it("ready when there are active students, an active shared cafetería and enabled students there", () => {
    expect(serviceChecks(inputs())?.every(c => c.done)).toBe(true);
  });
  it("new school: nothing ready; and no checks at all without the sharing read", () => {
    expect(serviceChecks(inputs({ counts: { students: 0, active: 0, suspended: 0, inactive: 0, cafeterias: 0 }, cafeterias: [] }))?.map(c => c.done)).toEqual([false, false, false]);
    expect(serviceChecks(inputs({ cafeterias: [service(1, { sharing: false })] }))?.map(c => c.done)).toEqual([true, false, false]);
    expect(serviceChecks(inputs({ cafeterias: [service(1, { enabled_students: 0 })] }))?.map(c => c.done)).toEqual([true, true, false]);
    expect(serviceChecks(inputs({ cafeterias: null }))).toBeNull();
  });
});

describe("Requiere atención", () => {
  it("calm when nothing the product records needs action", () => expect(schoolAttention(inputs())).toEqual([]));
  it("expired admin invitations, sharing revoked while students are enabled, frozen and negative wallets", () => {
    const items = schoolAttention(inputs({ invitations: [{ status: "expired" }, { status: "expired" }, { status: "pending" }], cafeterias: [service(1, { sharing: false, name: "Cafetería Tamboril Ficticia" }), service(2, { sharing: false, enabled_students: 0 })],
      wallet: wallet({ frozen_wallets: 1, negative_wallets: 2 }) }));
    expect(items.map(i => [i.text, i.href])).toEqual([
      ["2 invitaciones de administrador vencieron sin usarse.", "/administradores"],
      ["Cafetería Tamboril Ficticia tiene estudiantes habilitados, pero la compartición con el colegio no está activa.", "/cafeterias"],
      ["1 monedero de estudiante está congelado.", "/pikas-cash"],
      ["2 monederos de estudiantes tienen saldo negativo.", "/pikas-cash"],
    ]);
  });
  it("wallet conditions never appear without wallet authority; no thresholds, spending or inactivity alerts", () => {
    const items = schoolAttention(inputs({ wallet: null }));
    expect(items).toEqual([]);
    expect(JSON.stringify(schoolAttention(inputs({ wallet: wallet({ total_balance_minor: "0", wallets_with_movement: 0 }) })))).toBe("[]");
  });
});
