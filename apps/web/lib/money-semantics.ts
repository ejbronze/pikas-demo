import { money } from './cafeteria/operations';

// Shared financial-value semantics (UX Foundation A). The caller declares intent; the
// sign of a number alone never decides whether it is "good". Phase 5D reports reuse this.
// - movement: a signed ledger change (Recarga, Compra, Reembolso, Reversión de recarga,
//   Ajuste administrativo). Additive "+" positive tone; deductive "−" negative tone.
// - balance: a current or resulting Saldo. Neutral, unless negative ("−", negative tone).
// - amount: a plain price/total/amount with no direction. Always neutral.
// Meaning never depends on color alone: the sign and the surrounding label stay visible.
export type MoneyIntent = 'movement' | 'balance' | 'amount';
export type MoneyTone = 'positive' | 'negative' | 'neutral';

export function moneyTone(minor: string, intent: MoneyIntent): MoneyTone {
  const n = BigInt(minor);
  if (intent === 'amount' || n === 0n) return 'neutral';
  if (n < 0n) return 'negative';
  return intent === 'movement' ? 'positive' : 'neutral';
}

export function moneyText(minor: string, intent: MoneyIntent): string {
  return `${intent === 'movement' && BigInt(minor) > 0n ? '+' : ''}${money(minor)}`;
}

export const moneyToneClass: Record<MoneyTone, string> = { positive: 'text-emerald-700', negative: 'text-red-700', neutral: '' };
