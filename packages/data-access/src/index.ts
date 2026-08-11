import { controls, families, menuItems, parents, preorders, students, transactions, wallets } from "./mock-data";
export * from "./domain";

const copy = <T>(value: T): T => structuredClone(value);
export async function getFamily(familyId: string) { return copy(families.find((item) => item.id === familyId) ?? null) }
export async function getFamilyParent(familyId: string) { return copy(parents.find((item) => item.familyId === familyId) ?? null) }
export async function getFamilyStudents(familyId: string) { return copy(students.filter((item) => item.familyId === familyId)) }
export async function getStudent(studentId: string) { return copy(students.find((item) => item.id === studentId) ?? null) }
export async function getStudentWallet(studentId: string) { return copy(wallets.find((item) => item.studentId === studentId) ?? null) }
export async function getStudentTransactions(studentId: string) { const wallet = wallets.find((item) => item.studentId === studentId); return copy(transactions.filter((item) => item.walletId === wallet?.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt))) }
export async function getStudentControls(studentId: string) { return copy(controls.find((item) => item.studentId === studentId) ?? null) }
export async function getMenuItems(schoolId: string) { return copy(menuItems.filter((item) => item.schoolId === schoolId)) }
export async function getStudentPreorders(studentId: string) { return copy(preorders.filter((item) => item.studentId === studentId)) }
