import type { Family, MenuItem, Parent, Preorder, Student, StudentControls, Transaction, Wallet } from "@pikas/shared-types";

export const families: Family[] = [{ id: "fam-rosa", familyCode: "PK-2048", primaryParentId: "parent-oscar" }];
export const parents: Parent[] = [{ id: "parent-oscar", familyId: "fam-rosa", name: "Oscar Rosa", email: "oscar.rosa@ejemplo.com" }];
export const students: Student[] = [
  { id: "student-sofia", familyId: "fam-rosa", schoolId: "school-nueva", name: "Sofía Rosa", studentCode: "10982", grade: "5.º A" },
  { id: "student-mateo", familyId: "fam-rosa", schoolId: "school-nueva", name: "Mateo Rosa", studentCode: "11804", grade: "2.º B" },
  { id: "student-valentina", familyId: "fam-demo", schoolId: "school-nueva", name: "Valentina Gómez", studentCode: "118204", grade: "3.º B" }
];
export const wallets: Wallet[] = [
  { id: "wallet-sofia", studentId: "student-sofia", availableBalance: 2450, schoolBalance: 1800, generalBalance: 650, dailyLimit: 350, spentToday: 160, status: "active" },
  { id: "wallet-mateo", studentId: "student-mateo", availableBalance: 1680, schoolBalance: 1400, generalBalance: 280, dailyLimit: 300, spentToday: 105, status: "active" },
  { id: "wallet-valentina", studentId: "student-valentina", availableBalance: 1850, schoolBalance: 1300, generalBalance: 550, dailyLimit: 250, spentToday: 140, status: "active" }
];
export const controls: StudentControls[] = [
  { studentId: "student-sofia", transfersAllowed: false, dailyTransferLimit: 0, parentalApprovalThreshold: 300, allergies: ["Maní", "Lactosa"], blockedProducts: ["Bebidas energéticas", "Refrescos"] },
  { studentId: "student-mateo", transfersAllowed: true, dailyTransferLimit: 100, parentalApprovalThreshold: 200, allergies: [], blockedProducts: ["Bebidas energéticas"] },
  { studentId: "student-valentina", transfersAllowed: true, dailyTransferLimit: 100, parentalApprovalThreshold: 200, allergies: ["Maní"], blockedProducts: ["Bebidas energéticas"] }
];
export const transactions: Transaction[] = [
  { id:"tx-1", walletId:"wallet-sofia", type:"cafeteria_purchase", amount:-160, source:"wallet-sofia", destination:"cafeteria", category:"Alimentos", status:"completed", description:"Jugo natural y sándwich", createdAt:"2026-08-05T10:18:00-04:00" },
  { id:"tx-2", walletId:"wallet-sofia", type:"parent_top_up", amount:1500, source:"parent-oscar", destination:"wallet-sofia", category:"Recarga", status:"completed", description:"Recarga familiar de demostración", createdAt:"2026-08-02T18:45:00-04:00" },
  { id:"tx-3", walletId:"wallet-mateo", type:"cafeteria_purchase", amount:-105, source:"wallet-mateo", destination:"cafeteria", category:"Alimentos", status:"completed", description:"Agua y barra de cereal", createdAt:"2026-08-05T10:22:00-04:00" },
  { id:"tx-4", walletId:"wallet-valentina", type:"cafeteria_purchase", amount:-140, source:"wallet-valentina", destination:"cafeteria", category:"Alimentos", status:"completed", description:"Sándwich + jugo", createdAt:"2026-08-11T10:15:00-04:00" },
  { id:"tx-5", walletId:"wallet-valentina", type:"parent_top_up", amount:500, source:"Familia", destination:"wallet-valentina", category:"Recarga", status:"completed", description:"Recarga recibida", createdAt:"2026-08-11T07:45:00-04:00" },
  { id:"tx-6", walletId:"wallet-valentina", type:"external_purchase", amount:-300, source:"wallet-valentina", destination:"cine", category:"Entretenimiento", status:"completed", description:"Reserva cine", createdAt:"2026-08-10T18:30:00-04:00" }
];
export const menuItems: MenuItem[] = [
  { id:"menu-pasta", schoolId:"school-nueva", name:"Pasta con pollo", description:"Almuerzo completo, sin maní", price:180, emoji:"🍝", availableOn:"Jueves · 12:30 p. m.", allergens:[], available:true },
  { id:"menu-sandwich", schoolId:"school-nueva", name:"Sándwich integral", description:"Bajo en azúcar", price:120, emoji:"🥪", availableOn:"Viernes · Recreo", allergens:["Gluten"], available:true },
  { id:"menu-pizza", schoolId:"school-nueva", name:"Pizza escolar", description:"Porción individual", price:150, emoji:"🍕", availableOn:"Viernes · Almuerzo", allergens:["Lactosa"], available:true }
];
export const preorders: Preorder[] = [{ id:"pre-1", studentId:"student-valentina", menuItemId:"menu-pasta", pickupAt:"2026-08-13T12:30:00-04:00", status:"scheduled" }];
