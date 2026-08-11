export type UserRole = "parent" | "student" | "admin" | "pos";

export interface Family { id: string; familyCode: string; primaryParentId: string }
export interface Parent { id: string; familyId: string; name: string; email: string }
export interface Student { id: string; familyId: string; schoolId: string; name: string; studentCode: string; grade: string; avatarUrl?: string }
export interface Wallet { id: string; studentId: string; availableBalance: number; schoolBalance: number; generalBalance: number; dailyLimit: number; spentToday: number; status: "active" | "blocked" }
export interface Transaction {
  id: string; walletId: string;
  type: "parent_top_up" | "cafeteria_purchase" | "preorder" | "student_transfer" | "refund" | "external_purchase" | "administrative_adjustment" | "funds_reservation";
  amount: number; source: string; destination: string; category: string;
  status: "pending" | "completed" | "declined" | "refunded";
  description: string; createdAt: string;
}
export interface StudentControls { studentId: string; transfersAllowed: boolean; dailyTransferLimit: number; parentalApprovalThreshold: number; allergies: string[]; blockedProducts: string[] }
export interface MenuItem { id: string; schoolId: string; name: string; description: string; price: number; emoji: string; availableOn: string; allergens: string[]; available: boolean }
export interface Preorder { id: string; studentId: string; menuItemId: string; pickupAt: string; status: "scheduled" | "collected" | "cancelled" }
