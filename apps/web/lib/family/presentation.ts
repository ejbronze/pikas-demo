import { money } from "../cafeteria/operations";
import type { PurchaseSummary, StudentSummary, WalletActivity } from "./contracts";

// Plain-language presentation for families and students. No accounting vocabulary.
const zone = "America/Santo_Domingo";
export const formatDay = (iso: string) => new Intl.DateTimeFormat("es-DO", { weekday: "short", day: "numeric", month: "short", timeZone: zone }).format(new Date(iso));
export const formatTime = (iso: string) => new Intl.DateTimeFormat("es-DO", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(iso));
export const formatWhen = (iso: string) => `${formatDay(iso)} · ${formatTime(iso)}`;

export const paymentLabel: Record<PurchaseSummary["payment"], string> = { student_wallet: "PIKAS Cash", cash: "Efectivo" };
export const refundLabel = (p: PurchaseSummary) => p.refund_status === "full" ? "Reembolsada" : p.refund_status === "partial" ? "Reembolso parcial" : null;

export function activityTitle(a: WalletActivity) {
  if (a.type === "replenishment") return "Recarga de PIKAS Cash";
  if (a.type === "purchase") return a.cafeteria_name ? `Compra en ${a.cafeteria_name}` : "Compra";
  if (a.type === "refund") return a.receipt_number ? `Reembolso de compra #${a.receipt_number}` : "Reembolso de compra";
  if (a.type === "replenishment_reversal") return "Recarga revertida";
  return "Corrección de saldo";
}
// Screen-reader sentence: direction is stated in words, never only with a sign or a color.
export function activitySpoken(a: WalletActivity, whose: "tu" | "el") {
  const n = BigInt(a.amount_minor), abs = money((n < 0n ? -n : n).toString());
  return `${activityTitle(a)}, ${n < 0n ? "disminuyó" : "aumentó"} ${whose} saldo en ${abs}. Saldo después: ${money(a.balance_after_minor)}.`;
}

export type ChildMarker = { kind: "inactive" | "no_wallet" | "frozen" | "limit_reached" | "no_cafeteria"; label: string };
export function childMarkers(s: StudentSummary): ChildMarker[] {
  if (s.status === "inactive") return [{ kind: "inactive", label: "No disponible" }];
  const out: ChildMarker[] = [];
  if (!s.cafeteria_access) out.push({ kind: "no_cafeteria", label: "Sin acceso a cafetería" });
  if (!s.wallet) out.push({ kind: "no_wallet", label: "Sin PIKAS Cash todavía" });
  else if (s.wallet.status === "frozen") out.push({ kind: "frozen", label: "PIKAS Cash pausado" });
  if (limitReached(s)) out.push({ kind: "limit_reached", label: "Alcanzó el límite de hoy" });
  return out;
}
export const limitReached = (s: StudentSummary) => s.controls.daily_limit_minor !== null && BigInt(s.controls.spent_today_minor) >= BigInt(s.controls.daily_limit_minor);
export function remainingToday(s: StudentSummary): string | null {
  if (s.controls.daily_limit_minor === null || !s.wallet) return null;
  const left = BigInt(s.controls.daily_limit_minor) - BigInt(s.controls.spent_today_minor), balance = BigInt(s.wallet.balance_minor);
  const value = left < 0n ? 0n : left;
  return (value < balance ? value : balance < 0n ? 0n : balance).toString();
}
export const restrictionKind = { allergen: "Alergia", dietary: "Dieta", avoidance: "Evitar" } as const;
