import { describe, expect, it } from "vitest";
import { calculateCartTotal, lookupPosStudent, preparePosPurchase, validatePosPurchase, type PosMenuItemRecord, type PosStudentRecord } from "./pos";

const student: PosStudentRecord = {id:"sofia",preferredName:"Sofi",grade:"5.º A",code:"PK-10982",school:"Instituto Nueva Generación",status:"active",walletStatus:"active",balanceMinor:245000,dailyLimitMinor:35000,perTransactionLimitMinor:25000,spentTodayMinor:16000,allergies:["Maní","Lactosa"],blockedProducts:["Bebidas energéticas"],blockedProductIds:["energy"]};
const menu: PosMenuItemRecord[] = [
  {id:"pasta",name:"Pasta con pollo",description:"",category:"Almuerzo",priceMinor:18000,allergens:[],ingredients:["Pasta","Pollo"],restrictionTags:[],imageUrl:null,available:true},
  {id:"pizza",name:"Pizza escolar",description:"",category:"Almuerzo",priceMinor:15000,allergens:["Lactosa"],ingredients:[],restrictionTags:[],imageUrl:null,available:true},
  {id:"energy",name:"Bebidas energéticas",description:"",category:"Bebidas",priceMinor:11000,allergens:[],ingredients:[],restrictionTags:["No recomendada"],imageUrl:null,available:true},
  {id:"closed",name:"Especial del día",description:"",category:"Almuerzo",priceMinor:10000,allergens:[],ingredients:[],restrictionTags:[],imageUrl:null,available:false},
];

describe("POS student lookup",()=>{
  it("requires an exact active seeded code",()=>{expect(lookupPosStudent([student],"PK-10982").ok).toBe(true);expect(lookupPosStudent([student],"10982").ok).toBe(false);expect(lookupPosStudent([student],"PK-00000").ok).toBe(false)});
  it("rejects archived or inactive students",()=>expect(lookupPosStudent([{...student,status:"archived"}],"PK-10982")).toEqual({ok:false,reason:"student_inactive"}));
});

describe("POS purchase preparation",()=>{
  it("creates an immutable purchase snapshot and prevents duplicate charges",()=>{const purchaseMenu=structuredClone(menu);const input={student,menu:purchaseMenu,cart:[{itemId:"pasta",quantity:1}],idempotencyKey:"once",purchases:[],employeeLabel:"Caja demo",now:"2026-08-11T18:00:00.000Z",purchaseId:"purchase-1"};const first=preparePosPurchase(input);expect(first).toMatchObject({ok:true,duplicate:false,purchase:{totalMinor:18000,status:"completed",items:[{unitPriceMinor:18000}]}});if(!first.ok)return;expect(Object.isFrozen(first.purchase)).toBe(true);expect(Object.isFrozen(first.purchase.items[0])).toBe(true);purchaseMenu[0]!.priceMinor=99999;expect(first.purchase.items[0]?.unitPriceMinor).toBe(18000);const duplicate=preparePosPurchase({...input,purchaseId:"purchase-2",purchases:[first.purchase]});expect(duplicate).toMatchObject({ok:true,duplicate:true,purchase:{id:"purchase-1"}})});
  it("returns no purchase when validation fails",()=>expect(preparePosPurchase({student:{...student,balanceMinor:0},menu,cart:[{itemId:"pasta",quantity:1}],idempotencyKey:"fail",purchases:[],employeeLabel:"Caja demo",now:"2026-08-11T18:00:00.000Z",purchaseId:"purchase-fail"})).toMatchObject({ok:false,reason:"balance"}));
  it("records cash separately without charging a student wallet",()=>expect(preparePosPurchase({student,menu,cart:[{itemId:"pasta",quantity:1}],idempotencyKey:"cash",purchases:[],employeeLabel:"Caja demo",now:"2026-08-11T18:00:00.000Z",purchaseId:"purchase-cash",paymentMethod:"cash"})).toMatchObject({ok:true,purchase:{studentId:null,studentName:"Venta en efectivo",paymentMethod:"cash",totalMinor:18000}}));
});

describe("POS cart validation",()=>{
  it("calculates totals in integer minor units",()=>expect(calculateCartTotal([{itemId:"pasta",quantity:1},{itemId:"energy",quantity:2}],menu)).toBe(40000));
  it("accepts a permitted purchase",()=>expect(validatePosPurchase(student,menu,[{itemId:"pasta",quantity:1}])).toMatchObject({ok:true,totalMinor:18000}));
  it("enforces allergy, blocked product, availability and server prices",()=>{expect(validatePosPurchase(student,menu,[{itemId:"pizza",quantity:1}])).toMatchObject({ok:false,reason:"allergy"});expect(validatePosPurchase(student,menu,[{itemId:"energy",quantity:1}])).toMatchObject({ok:false,reason:"blocked_product"});expect(validatePosPurchase(student,menu,[{itemId:"closed",quantity:1}])).toMatchObject({ok:false,reason:"item_unavailable"});expect(validatePosPurchase(student,menu,[{itemId:"pasta",quantity:1}])).toMatchObject({totalMinor:18000})});
  it("enforces wallet, daily and per-transaction limits",()=>{expect(validatePosPurchase({...student,balanceMinor:1000},menu,[{itemId:"pasta",quantity:1}])).toMatchObject({reason:"balance"});expect(validatePosPurchase({...student,spentTodayMinor:20000},menu,[{itemId:"pasta",quantity:1}])).toMatchObject({reason:"daily_limit"});expect(validatePosPurchase({...student,perTransactionLimitMinor:10000},menu,[{itemId:"pasta",quantity:1}])).toMatchObject({reason:"per_transaction_limit"})});
  it("rejects invalid quantities and inactive wallets",()=>{expect(validatePosPurchase(student,menu,[{itemId:"pasta",quantity:0}])).toMatchObject({reason:"invalid_quantity"});expect(validatePosPurchase({...student,walletStatus:"blocked"},menu,[{itemId:"pasta",quantity:1}])).toMatchObject({reason:"wallet_inactive"})});
});
