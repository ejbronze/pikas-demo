import { moneyText, moneyTone, moneyToneClass, type MoneyIntent } from '../lib/money-semantics';

// Renders a monetary value with the shared semantics in lib/money-semantics.ts.
export function MoneyValue({ minor, intent, className = '' }: { minor: string; intent: MoneyIntent; className?: string }) {
  const tone = moneyTone(minor, intent);
  return <span data-money-intent={intent} data-money-tone={tone} className={`${moneyToneClass[tone]} ${className}`.trim() || undefined}>{moneyText(minor, intent)}</span>;
}
