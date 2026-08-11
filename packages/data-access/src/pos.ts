export type PosStudentRecord = {
  id: string;
  preferredName: string;
  grade: string;
  code: string;
  school: string;
  status: "active" | "archived" | "inactive";
  walletStatus: "active" | "blocked";
  balanceMinor: number;
  dailyLimitMinor: number;
  perTransactionLimitMinor: number;
  spentTodayMinor: number;
  allergies: string[];
  blockedProducts: string[];
};

export type PosMenuItemRecord = {
  id: string;
  name: string;
  description: string;
  category: string;
  priceMinor: number;
  allergens: string[];
  available: boolean;
};

export type PosCartLine = { itemId: string; quantity: number };
export type PosPurchaseRecord = {
  readonly id: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly items: ReadonlyArray<Readonly<{ itemId: string; name: string; quantity: number; unitPriceMinor: number }>>;
  readonly totalMinor: number;
  readonly status: "completed";
  readonly employeeLabel: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
};
export type PosValidationReason =
  | "student_inactive"
  | "wallet_inactive"
  | "invalid_quantity"
  | "item_not_found"
  | "item_unavailable"
  | "allergy"
  | "blocked_product"
  | "balance"
  | "daily_limit"
  | "per_transaction_limit";

export type PosValidation =
  | { ok: true; totalMinor: number; lines: Array<PosCartLine & { name: string; unitPriceMinor: number }> }
  | { ok: false; reason: PosValidationReason; itemName?: string; allergen?: string };

const codePattern = /^PK-\d{5}$/;
const normalized = (value: string) => value.trim().toLocaleLowerCase("es");

export function lookupPosStudent(students: PosStudentRecord[], rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  if (!codePattern.test(code)) return { ok: false as const, reason: "invalid_code" as const };
  const student = students.find((candidate) => candidate.code === code);
  if (!student) return { ok: false as const, reason: "unknown_code" as const };
  if (student.status !== "active") return { ok: false as const, reason: "student_inactive" as const };
  return { ok: true as const, student };
}

export function calculateCartTotal(lines: PosCartLine[], menu: PosMenuItemRecord[]) {
  const byId = new Map(menu.map((item) => [item.id, item]));
  return lines.reduce((total, line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) return total;
    const item = byId.get(line.itemId);
    return item ? total + item.priceMinor * line.quantity : total;
  }, 0);
}

export function validatePosPurchase(
  student: PosStudentRecord,
  menu: PosMenuItemRecord[],
  cart: PosCartLine[],
): PosValidation {
  if (student.status !== "active") return { ok: false, reason: "student_inactive" };
  if (student.walletStatus !== "active") return { ok: false, reason: "wallet_inactive" };
  if (cart.length === 0) return { ok: false, reason: "invalid_quantity" };

  const byId = new Map(menu.map((item) => [item.id, item]));
  const studentAllergies = new Set(student.allergies.map(normalized));
  const blocked = new Set(student.blockedProducts.map(normalized));
  const lines: Array<PosCartLine & { name: string; unitPriceMinor: number }> = [];
  let totalMinor = 0;

  for (const line of cart) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > 20) {
      return { ok: false, reason: "invalid_quantity" };
    }
    const item = byId.get(line.itemId);
    if (!item) return { ok: false, reason: "item_not_found" };
    if (!item.available) return { ok: false, reason: "item_unavailable", itemName: item.name };
    if (blocked.has(normalized(item.name))) return { ok: false, reason: "blocked_product", itemName: item.name };
    const allergen = item.allergens.find((value) => studentAllergies.has(normalized(value)));
    if (allergen) return { ok: false, reason: "allergy", itemName: item.name, allergen };
    const lineTotal = item.priceMinor * line.quantity;
    if (!Number.isSafeInteger(lineTotal)) return { ok: false, reason: "invalid_quantity" };
    totalMinor += lineTotal;
    lines.push({ ...line, name: item.name, unitPriceMinor: item.priceMinor });
  }

  if (totalMinor > student.balanceMinor) return { ok: false, reason: "balance" };
  if (totalMinor > student.perTransactionLimitMinor) return { ok: false, reason: "per_transaction_limit" };
  if (student.spentTodayMinor + totalMinor > student.dailyLimitMinor) return { ok: false, reason: "daily_limit" };
  return { ok: true, totalMinor, lines };
}

export const posValidationMessage = (result: Exclude<PosValidation, { ok: true }>) => {
  switch (result.reason) {
    case "allergy": return `No se puede completar: ${result.itemName} contiene ${result.allergen}, una alergia registrada.`;
    case "blocked_product": return `No se puede completar: ${result.itemName} está bloqueado por la familia.`;
    case "item_unavailable": return `${result.itemName} no está disponible en este momento.`;
    case "balance": return "El saldo disponible no cubre el total de la compra.";
    case "daily_limit": return "El total supera lo que queda del límite diario.";
    case "per_transaction_limit": return "El total supera el límite permitido por compra.";
    case "student_inactive": return "El estudiante ya no está activo.";
    case "wallet_inactive": return "La billetera no está activa.";
    default: return "Revisa los artículos y cantidades antes de continuar.";
  }
};

export function preparePosPurchase(input: {
  student: PosStudentRecord;
  menu: PosMenuItemRecord[];
  cart: PosCartLine[];
  idempotencyKey: string;
  purchases: PosPurchaseRecord[];
  employeeLabel: string;
  now: string;
  purchaseId: string;
}) {
  const duplicate = input.purchases.find((purchase) => purchase.idempotencyKey === input.idempotencyKey);
  if (duplicate) return { ok: true as const, duplicate: true, purchase: duplicate };
  const validation = validatePosPurchase(input.student, input.menu, input.cart);
  if (!validation.ok) return validation;
  const purchase: PosPurchaseRecord = Object.freeze({
    id: input.purchaseId,
    studentId: input.student.id,
    studentName: input.student.preferredName,
    items: Object.freeze(validation.lines.map((line) => Object.freeze({ itemId: line.itemId, name: line.name, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor }))),
    totalMinor: validation.totalMinor,
    status: "completed",
    employeeLabel: input.employeeLabel,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.now,
  });
  return { ok: true as const, duplicate: false, purchase };
}
