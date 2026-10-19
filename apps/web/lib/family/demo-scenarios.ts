import { guardianOverviewSchema, studentActivitySchema, type GuardianOverview, type PurchaseSummary, type StudentActivity, type StudentSummary, type WalletActivity } from "./contracts";

// Deterministic, fictional demo scenarios for the Parent/Student presentation (demo mode only).
// Every value goes through the same family-safe contracts the future server reads will satisfy.
export const guardianScenarios = { varios: "Varios estudiantes", uno: "Un estudiante", "sin-estudiantes": "Sin estudiantes vinculados", error: "Error al cargar" } as const;
export const studentScenarios = { normal: "Con saldo y compras", cero: "Saldo en cero", "sin-saldo": "Sin PIKAS Cash", pausado: "PIKAS Cash pausado", inactivo: "Cuenta inactiva", "sin-cafeteria": "Sin acceso a cafetería", error: "Error al cargar" } as const;
export type GuardianScenario = keyof typeof guardianScenarios;
export type StudentScenario = keyof typeof studentScenarios;
export { DEMO_SCENARIO_COOKIE } from "./demo-cookie";

const school = { school_name: "Colegio Ficticio Las Palmas", campus_name: "Campus Norte" };
const at = (day: number, time: string) => `2026-10-${String(day).padStart(2, "0")}T${time}:00-04:00`;
const noControls = { daily_limit_minor: null, per_purchase_limit_minor: null, spent_today_minor: "0" };

const mateoPurchases: PurchaseSummary[] = [
  { purchase_id: "d-p-6", receipt_number: "1048", cafeteria_name: "Cafetería Norte", purchased_at: at(19, "12:34"), payment: "student_wallet", total_minor: "18500", refund_status: "none", refunded_minor: "0",
    items: [{ name: "Wrap de pollo con queso, lechuga y aderezo de la casa", quantity: 1, line_total_minor: "10000", refunded_quantity: 0 }, { name: "Jugo natural de chinola", quantity: 1, line_total_minor: "5000", refunded_quantity: 0 }, { name: "Galletas de avena", quantity: 1, line_total_minor: "3500", refunded_quantity: 0 }] },
  { purchase_id: "d-p-5", receipt_number: "1032", cafeteria_name: "Cafetería Norte", purchased_at: at(18, "10:05"), payment: "cash", total_minor: "8000", refund_status: "none", refunded_minor: "0",
    items: [{ name: "Empanada de pollo", quantity: 1, line_total_minor: "8000", refunded_quantity: 0 }] },
  { purchase_id: "d-p-4", receipt_number: "1017", cafeteria_name: "Cafetería Norte", purchased_at: at(17, "12:20"), payment: "student_wallet", total_minor: "16000", refund_status: "partial", refunded_minor: "8000",
    items: [{ name: "Sándwich de jamón y queso", quantity: 2, line_total_minor: "16000", refunded_quantity: 1 }] },
  { purchase_id: "d-p-3", receipt_number: "1003", cafeteria_name: "Cafetería Norte", purchased_at: at(16, "09:45"), payment: "student_wallet", total_minor: "6000", refund_status: "full", refunded_minor: "6000",
    items: [{ name: "Yogurt de fresa", quantity: 1, line_total_minor: "6000", refunded_quantity: 1 }] },
];
const mateoActivity: WalletActivity[] = [
  { id: "d-a-6", type: "purchase", amount_minor: "-18500", balance_after_minor: "194000", occurred_at: at(19, "12:34"), cafeteria_name: "Cafetería Norte", receipt_number: "1048" },
  { id: "d-a-5", type: "refund", amount_minor: "8000", balance_after_minor: "212500", occurred_at: at(17, "14:10"), cafeteria_name: "Cafetería Norte", receipt_number: "1017" },
  { id: "d-a-4", type: "purchase", amount_minor: "-16000", balance_after_minor: "204500", occurred_at: at(17, "12:20"), cafeteria_name: "Cafetería Norte", receipt_number: "1017" },
  { id: "d-a-3", type: "refund", amount_minor: "6000", balance_after_minor: "220500", occurred_at: at(16, "11:00"), cafeteria_name: "Cafetería Norte", receipt_number: "1003" },
  { id: "d-a-2", type: "purchase", amount_minor: "-6000", balance_after_minor: "214500", occurred_at: at(16, "09:45"), cafeteria_name: "Cafetería Norte", receipt_number: "1003" },
  { id: "d-a-1", type: "replenishment", amount_minor: "200000", balance_after_minor: "220500", occurred_at: at(15, "08:00"), cafeteria_name: null, receipt_number: null },
  { id: "d-a-0", type: "adjustment", amount_minor: "20500", balance_after_minor: "20500", occurred_at: at(1, "08:00"), cafeteria_name: null, receipt_number: null },
];
const mateo: StudentSummary = { student_id: "d-s-mateo", display_name: "Mateo Alejandro Rodríguez Peña de los Santos", first_name: "Mateo", ...school, grade: "5to de Primaria", class_label: "Sección B",
  status: "active", cafeteria_access: true, wallet: { status: "active", balance_minor: "194000" },
  controls: { daily_limit_minor: "30000", per_purchase_limit_minor: "20000", spent_today_minor: "18500" },
  restrictions: [{ kind: "allergen", label: "Maní" }, { kind: "dietary", label: "Sin lactosa" }], last_purchase_at: at(19, "12:34") };
const sofia: StudentSummary = { student_id: "d-s-sofia", display_name: "Sofía Rosario", first_name: "Sofía", ...school, grade: "2do de Secundaria", class_label: "Sección A",
  status: "active", cafeteria_access: true, wallet: { status: "active", balance_minor: "0" },
  controls: { daily_limit_minor: "20000", per_purchase_limit_minor: null, spent_today_minor: "20000" }, restrictions: [], last_purchase_at: at(19, "10:15") };
const sofiaPurchases: PurchaseSummary[] = [{ purchase_id: "d-p-s1", receipt_number: "1040", cafeteria_name: "Cafetería Norte", purchased_at: at(19, "10:15"), payment: "student_wallet", total_minor: "20000", refund_status: "none", refunded_minor: "0",
  items: [{ name: "Hamburguesa", quantity: 1, line_total_minor: "10000", refunded_quantity: 0 }, { name: "Papas fritas", quantity: 1, line_total_minor: "6000", refunded_quantity: 0 }, { name: "Agua", quantity: 2, line_total_minor: "4000", refunded_quantity: 0 }] }];
const sofiaActivity: WalletActivity[] = [
  { id: "d-a-s2", type: "purchase", amount_minor: "-20000", balance_after_minor: "0", occurred_at: at(19, "10:15"), cafeteria_name: "Cafetería Norte", receipt_number: "1040" },
  { id: "d-a-s1", type: "replenishment", amount_minor: "20000", balance_after_minor: "20000", occurred_at: at(18, "07:30"), cafeteria_name: null, receipt_number: null },
];
const lucas: StudentSummary = { student_id: "d-s-lucas", display_name: "Lucas Rosario", first_name: "Lucas", ...school, grade: "Kínder", class_label: null,
  status: "active", cafeteria_access: true, wallet: null, controls: noControls, restrictions: [{ kind: "avoidance", label: "Sin bebidas azucaradas" }], last_purchase_at: at(18, "09:00") };
const lucasPurchases: PurchaseSummary[] = [{ purchase_id: "d-p-l1", receipt_number: "1029", cafeteria_name: "Cafetería Norte", purchased_at: at(18, "09:00"), payment: "cash", total_minor: "3000", refund_status: "none", refunded_minor: "0",
  items: [{ name: "Tostada", quantity: 1, line_total_minor: "3000", refunded_quantity: 0 }] }];
const valentina: StudentSummary = { student_id: "d-s-valentina", display_name: "Valentina Rosario", first_name: "Valentina", ...school, grade: "1ro de Secundaria", class_label: "Sección C",
  status: "active", cafeteria_access: true, wallet: { status: "frozen", balance_minor: "45000" }, controls: noControls, restrictions: [], last_purchase_at: null };
const camila: StudentSummary = { student_id: "d-s-camila", display_name: "Camila Rosario", first_name: "Camila", ...school, grade: null, class_label: null,
  status: "inactive", cafeteria_access: false, wallet: null, controls: noControls, restrictions: [], last_purchase_at: null };

const child = (student: StudentSummary, purchases: PurchaseSummary[] = [], activity: WalletActivity[] = []): StudentActivity => studentActivitySchema.parse({ student, purchases, activity });
const guardian = { display_name: "Ana Rosario Peña", email: "ana.rosario@example.invalid", username: "ana.rosario", phone: "809-555-0142" };

export function guardianScenario(name: GuardianScenario): GuardianOverview | null {
  if (name === "error") return null;
  const children = name === "sin-estudiantes" ? [] : name === "uno" ? [child(mateo, mateoPurchases, mateoActivity)]
    : [child(mateo, mateoPurchases, mateoActivity), child(sofia, sofiaPurchases, sofiaActivity), child(lucas, lucasPurchases), child(valentina), child(camila)];
  return guardianOverviewSchema.parse({ guardian, children });
}

export function studentScenario(name: StudentScenario): StudentActivity | null {
  if (name === "error") return null;
  if (name === "cero") return child(sofia, sofiaPurchases, sofiaActivity);
  if (name === "sin-saldo") return child({ ...lucas, display_name: "Lucas Rosario", restrictions: [] }, []);
  if (name === "pausado") return child(valentina);
  if (name === "inactivo") return child({ ...mateo, status: "inactive" }, mateoPurchases, mateoActivity);
  if (name === "sin-cafeteria") return child({ ...mateo, cafeteria_access: false, wallet: null, controls: noControls, last_purchase_at: null });
  return child(mateo, mateoPurchases, mateoActivity);
}
