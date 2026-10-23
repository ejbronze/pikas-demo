import type { OverviewInputs, ServiceRow, WalletSummary } from "./overview";
// Fictional School Overview inputs for focused tests.
export const schoolId = "4d700000-0000-4000-8000-000000000001";
export const service = (n: number, patch: Partial<ServiceRow> = {}): ServiceRow => ({ id: `4d700000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, name: `Cafetería Ficticia ${n}`, location: `Sede ${n}`, active: true, sharing: true, sharing_state: patch.sharing === false ? "never" : "active", enabled_students: 40, enabled_capped: false, ...patch });
export const wallet = (patch: Partial<WalletSummary> = {}): WalletSummary => ({ active_wallets: 371, frozen_wallets: 0, negative_wallets: 0, total_balance_minor: "21438000", wallets_with_movement: 248, from: "2026-10-15", to: "2026-10-21", ...patch });
export const inputs = (patch: Partial<OverviewInputs> = {}): OverviewInputs => ({ counts: { students: 418, active: 412, suspended: 6, inactive: 0, cafeterias: 2 },
  cafeterias: [service(1), service(2, { enabled_students: 114 })], invitations: [], wallet: wallet(), ...patch });
export const readData = { scope: { actor_id: schoolId, membership_id: schoolId, role: "school_admin" as const, account_id: schoolId, school_id: schoolId, account_name: "Cuenta ficticia", school_name: "Colegio Ficticio Atlántico", tenant_kind: "customer" as const }, locations: [] };
