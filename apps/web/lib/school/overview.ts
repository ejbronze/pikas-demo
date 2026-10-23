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
// UX 13: the sharing read (school_admin_read) reports "revoked" for a relationship that was never
// shared. The School's own school_cafeteria_shares rows (RLS: school:sharing:read) tell the truth:
// no row = never shared. "inactive" is the fallback when that read is unavailable: not active,
// unknown whether it was ever shared.
export type SharingState = "active" | "revoked" | "never" | "inactive";
export type SharingRows = Record<string, "active" | "revoked"> | null;
export const sharingState = (row: { id: string; sharing_status: "active" | "revoked" }, shares: SharingRows): SharingState =>
  shares ? (shares[row.id] ?? "never") : row.sharing_status === "active" ? "active" : "inactive";
export const sharingLabel: Record<SharingState, string> = { active: "Compartición activa", revoked: "Compartición revocada", never: "Sin compartir todavía", inactive: "Sin compartición activa" };
export type ServiceRow = { id: string; name: string; location: string; active: boolean; sharing: boolean; sharing_state: SharingState; enabled_students: number; enabled_capped: boolean };
export type OverviewInputs = {
  counts: NonNullable<SchoolRead["counts"]>;
  cafeterias: ServiceRow[] | null;                // null: sharing read not available to this role (counts only, no student names)
  invitations: { status: string }[] | null;       // school administrator invitations
  wallet: WalletSummary | null;                    // null: no school:wallets:read
};

// Reduced on the server: the cafeterías read lists up to 100 enabled students per cafetería by name;
// only the count leaves the server, and beyond 100 the count says so.
export const serviceRows = (rows: CafeteriaRow[], shares: SharingRows = null): ServiceRow[] => rows.map(r => ({ id: r.id, name: r.name, location: r.location, active: r.status === "active", sharing: r.sharing_status === "active",
  sharing_state: sharingState(r, shares), enabled_students: r.customers.length, enabled_capped: r.customers.length >= 100 }));

// UX 13 service readiness, school side only (the School owns all three): active students, a
// cafetería the school shares with, and at least one student enabled there. Same model as the
// Cafetería "Puesta en marcha": states from the reads, one next step, a contextual action. Nothing
// is stored. It never changes the Cafetería's own "Lista para operar".
export type ServiceStep = { key: "students" | "sharing" | "enabled"; label: string; done: boolean; detail: string; action: { href: "/estudiantes" | `/cafeterias#cafeteria-${string}`; label: string } | null };
export type ServiceReadiness = { steps: ServiceStep[]; next: ServiceStep | null; status: "ready" | "pending"; complete: number; serving: ServiceRow[] };
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
const names = (rows: ServiceRow[]) => rows.map(r => r.name).join(", ");
export function serviceReadiness(i: OverviewInputs): ServiceReadiness | null {
  if (!i.cafeterias) return null;
  const active = i.cafeterias.filter(c => c.active), serving = active.filter(c => c.sharing), enabled = serving.filter(c => c.enabled_students > 0);
  const first = active[0], revoked = active.find(c => c.sharing_state === "revoked");
  const students: ServiceStep = i.counts.active > 0
    ? { key: "students", label: "Estudiantes registrados", done: true, detail: n(i.counts.active, "estudiante activo", "estudiantes activos") + ".", action: null }
    : { key: "students", label: "Estudiantes registrados", done: false, detail: "Agrega estudiantes, uno por uno o con un archivo CSV.", action: { href: "/estudiantes", label: "Agregar estudiantes" } };
  const sharing: ServiceStep = serving.length
    ? { key: "sharing", label: "Cafetería compartida", done: true, detail: `Compartiendo con ${names(serving)}.`, action: null }
    : !first
      ? { key: "sharing", label: "Cafetería compartida", done: false, detail: "PIKAS agrega las cafeterías del colegio al configurarlo.", action: null }
      : revoked
        ? { key: "sharing", label: "Cafetería compartida", done: false, detail: `La compartición con ${revoked.name} está revocada: su POS no puede atender estudiantes.`, action: { href: `/cafeterias#cafeteria-${revoked.id}`, label: `Volver a compartir con ${revoked.name}` } }
        : { key: "sharing", label: "Cafetería compartida", done: false, detail: `Comparte el colegio con ${first.name} para que su POS pueda atender estudiantes.`, action: { href: `/cafeterias#cafeteria-${first.id}`, label: active.length === 1 ? `Compartir con ${first.name}` : "Compartir con una cafetería" } };
  const target = serving[0] ?? first;
  const enabledStep: ServiceStep = enabled.length
    ? { key: "enabled", label: "Estudiantes habilitados", done: true, detail: enabled.map(c => `${c.enabled_capped ? "100 o más" : c.enabled_students} en ${c.name}`).join(" · ") + ".", action: null }
    : { key: "enabled", label: "Estudiantes habilitados", done: false, detail: serving.length ? `Habilita los estudiantes que ${target!.name} podrá atender.` : "Después de compartir, habilita los estudiantes que la cafetería podrá atender.", action: serving.length ? { href: `/cafeterias#cafeteria-${target!.id}`, label: "Habilitar estudiantes" } : null };
  const steps = [students, sharing, enabledStep], next = steps.find(s => !s.done) ?? null;
  return { steps, next, status: next ? "pending" : "ready", complete: steps.filter(s => s.done).length, serving };
}

// Requiere atención: only states the product records and this role may see. Counts, never names.
export type AttentionItem = { key: string; text: string; href: "/estudiantes" | "/administradores" | "/cafeterias" | "/pikas-cash"; action: string };
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
