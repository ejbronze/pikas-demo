// Fictional School PIKAS Cash report used by the UX 8 Reportes tests.
const school = "4d800000-0000-4000-8000-000000000001";
export const walletReport = (over: Record<string, unknown> = {}) => ({ school_id: school, tenant_kind: "customer", business_timezone: "America/Santo_Domingo", currency_code: "DOP", period: "last_30_days", from: "2026-09-22", to: "2026-10-21", today: "2026-10-21", as_of: "2026-10-21T12:00:00Z",
  current: { total_balance_minor: "15400", wallet_count: 3, active_wallet_count: 2, frozen_wallet_count: 1, negative_wallet_count: 1, negative_balance_minor: "-500" },
  movements: { replenishments: { amount_minor: "22500", count: 3 }, reversals: { amount_minor: "2500", count: 1 }, net_replenished_minor: "20000", purchases: { amount_minor: "11500", count: 2 }, refunds: { amount_minor: "5000", count: 1 },
    adjustment_credits: { amount_minor: "1000", count: 1 }, adjustment_debits: { amount_minor: "1100", count: 2 }, historical_adjustments: { net_minor: "0", count: 0 }, net_movement_minor: "13400", entry_count: 10, wallets_with_movement: 2 },
  cafeterias: [{ cafeteria_id: "4d800000-0000-4000-8000-0000000000c1", name: "Cafetería Comercial", spent_minor: "11500", purchase_count: 2, refunded_minor: "5000", refund_count: 1 }], ...over });
