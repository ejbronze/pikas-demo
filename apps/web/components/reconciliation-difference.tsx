import { MoneyValue } from "./money-value";
export function ReconciliationDifference({ minor }: { minor: string | null }) {
  if (minor === null) return <>Pendiente</>;
  const difference = BigInt(minor);
  if (difference === 0n) return <>Cuadrada</>;
  return <>{difference > 0n ? "Sobrante" : "Faltante"} <MoneyValue minor={minor} intent="movement" /></>;
}
