import type { SchoolRead } from "./contracts";
import type { WalletReport } from "./wallet-report";

// PIKAS UX 4 School Overview: students, access and service, derived from existing School reads.
// School sees its students, never the cafeteria's business. The wallet part exists only for School
// Admins with school:wallets:read, and is reduced on the server to wallet aggregates: per-cafetería
// spending, purchase amounts and refunds from the PIKAS Cash report never reach this view.
export type WalletSummary = { active_wallets: number; frozen_wallets: number; negative_wallets: number; total_balance_minor: string; wallets_with_movement: number; from: string; to: string };
export const walletSummary = (r: WalletReport): WalletSummary => ({ active_wallets: r.current.active_wallet_count, frozen_wallets: r.current.frozen_wallet_count, negative_wallets: r.current.negative_wallet_count,
  total_balance_minor: r.current.total_balance_minor, wallets_with_movement: r.movements.wallets_with_movement, from: r.from, to: r.to });

export type CafeteriaRow = { id: string; name: string; location: string; status: string; sharing_status: "active" | "revoked"; customers: { student_id: string }[] };
export type ServiceRow = { id: string; name: string; location: string; active: boolean; sharing: boolean; enabled_students: number; enabled_capped: boolean };
export type OverviewInputs = {
  counts: NonNullable<SchoolRead["counts"]>;
  cafeterias: ServiceRow[] | null;                // null: sharing read not available to this role (counts only, no student names)
  invitations: { status: string }[] | null;       // school administrator invitations
  wallet: WalletSummary | null;                    // null: no school:wallets:read
};

// Reduced on the server: the cafeterías read lists up to 100 enabled students per cafetería by name;
// only the count leaves the server, and beyond 100 the count says so.
export const serviceRows = (rows: CafeteriaRow[]): ServiceRow[] => rows.map(r => ({ id: r.id, name: r.name, location: r.location, active: r.status === "active", sharing: r.sharing_status === "active",
  enabled_students: r.customers.length, enabled_capped: r.customers.length >= 100 }));

// Service readiness, school side only: active students, a cafetería sharing with the school, and
// at least one student enabled there. Nothing is stored; it reads the same state the pages show.
export type ServiceCheck = { key: "students" | "sharing" | "enabled"; label: string; done: boolean };
export function serviceChecks(i: OverviewInputs): ServiceCheck[] | null {
  if (!i.cafeterias) return null;
  const serving = i.cafeterias.filter(c => c.active && c.sharing);
  return [
    { key: "students", label: "Estudiantes activos registrados", done: i.counts.active > 0 },
    { key: "sharing", label: "Una cafetería con compartición activa", done: serving.length > 0 },
    { key: "enabled", label: "Estudiantes habilitados en esa cafetería", done: serving.some(c => c.enabled_students > 0) },
  ];
}

// Requiere atención: only states the product records and this role may see. Counts, never names.
export type AttentionItem = { key: string; text: string; href: "/estudiantes" | "/administradores" | "/cafeterias" | "/pikas-cash"; action: string };
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
export function schoolAttention(i: OverviewInputs): AttentionItem[] {
  const items: AttentionItem[] = [];
  const expired = (i.invitations ?? []).filter(v => v.status === "expired").length;
  if (expired) items.push({ key: "invitations", text: `${n(expired, "invitación de administrador venció", "invitaciones de administrador vencieron")} sin usarse.`, href: "/administradores", action: "Ver administradores" });
  for (const c of i.cafeterias ?? []) if (c.active && !c.sharing && c.enabled_students > 0)
    items.push({ key: `sharing:${c.id}`, text: `${c.name} tiene estudiantes habilitados, pero la compartición con el colegio no está activa.`, href: "/cafeterias", action: "Revisar cafetería" });
  if (i.wallet?.frozen_wallets) items.push({ key: "frozen", text: `${n(i.wallet.frozen_wallets, "monedero de estudiante está congelado", "monederos de estudiantes están congelados")}.`, href: "/pikas-cash", action: "Ver PIKAS Cash" });
  if (i.wallet?.negative_wallets) items.push({ key: "negative", text: `${n(i.wallet.negative_wallets, "monedero de estudiante tiene saldo negativo", "monederos de estudiantes tienen saldo negativo")}.`, href: "/pikas-cash", action: "Ver PIKAS Cash" });
  return items;
}
