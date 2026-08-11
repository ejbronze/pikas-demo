"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  lookupPosStudent,
  posValidationMessage,
  preparePosPurchase,
  type PosCartLine,
  type PosMenuItemRecord,
  type PosPurchaseRecord,
  type PosStudentRecord,
} from "@pikas/data-access";

export type DemoStudent = {id:string;firstName:string;lastName:string;preferredName:string;grade:string;code:string;status:"active"|"archived";balance:number;dailyLimit:number;perPurchaseLimit:number;spentToday:number;allergies:string[];blocked:string[]};
export type DemoTx = {id:string;studentId:string;description:string;category:string;amount:number;status:"completed"|"pending"|"reversed";createdAt:string;purchaseId?:string};
export type DemoOrder = {id:string;studentId:string;item:string;amount:number;status:"submitted"|"confirmed"|"cancelled";createdAt:string};
type State = {parent:{name:string;email:string;phone:string};students:DemoStudent[];transactions:DemoTx[];orders:DemoOrder[];budget:{goal:string;limit:number;archived:boolean};menuItems:PosMenuItemRecord[];purchases:PosPurchaseRecord[]};

const demoMenu: PosMenuItemRecord[] = [
  {id:"menu-pasta",name:"Pasta con pollo",description:"Almuerzo completo, sin alérgenos registrados",category:"Almuerzo",priceMinor:18000,allergens:[],available:true},
  {id:"menu-sandwich",name:"Sándwich integral",description:"Merienda escolar",category:"Merienda",priceMinor:12000,allergens:["Gluten"],available:true},
  {id:"menu-pizza",name:"Pizza escolar",description:"Porción individual",category:"Almuerzo",priceMinor:15000,allergens:["Lactosa"],available:true},
  {id:"menu-energy",name:"Bebidas energéticas",description:"Producto restringible",category:"Bebidas",priceMinor:11000,allergens:[],available:true},
  {id:"menu-special",name:"Especial del día",description:"Agotado por hoy",category:"Almuerzo",priceMinor:20000,allergens:[],available:false},
];

const initial: State = {
  parent:{name:"Oscar Rosa",email:"familia@demo.pikas.do",phone:"809-555-0142"},
  students:[
    {id:"sofia",firstName:"Sofía",lastName:"Rosa",preferredName:"Sofi",grade:"5.º A",code:"PK-10982",status:"active",balance:2450,dailyLimit:350,perPurchaseLimit:250,spentToday:160,allergies:["Maní","Lactosa"],blocked:["Bebidas energéticas"]},
    {id:"mateo",firstName:"Mateo",lastName:"Rosa",preferredName:"Mateo",grade:"2.º B",code:"PK-11804",status:"active",balance:1680,dailyLimit:300,perPurchaseLimit:200,spentToday:105,allergies:[],blocked:["Bebidas energéticas"]},
  ],
  transactions:[
    {id:"tx1",studentId:"sofia",description:"Jugo natural y sándwich",category:"Alimentos",amount:-160,status:"completed",createdAt:"2026-08-11T10:18:00-04:00"},
    {id:"tx2",studentId:"sofia",description:"Recarga familiar demo",category:"Recarga",amount:1500,status:"completed",createdAt:"2026-08-10T18:45:00-04:00"},
    {id:"tx3",studentId:"mateo",description:"Agua y barra de cereal",category:"Alimentos",amount:-105,status:"completed",createdAt:"2026-08-11T10:22:00-04:00"},
  ],
  orders:[{id:"po1",studentId:"sofia",item:"Pasta con pollo",amount:180,status:"confirmed",createdAt:"2026-08-11T08:00:00-04:00"}],
  budget:{goal:"Meriendas del mes",limit:1200,archived:false},
  menuItems:demoMenu,
  purchases:[],
};

type CheckoutResult = {ok:true;duplicate:boolean;purchase:PosPurchaseRecord}|{ok:false;message:string};
type Context = {
  state:State;
  saveParent:(value:State["parent"])=>void;
  saveStudent:(value:DemoStudent)=>void;
  addStudent:(value:Omit<DemoStudent,"id"|"balance"|"spentToday"|"status">)=>void;
  archive:(id:string,restore?:boolean)=>void;
  topup:(id:string,amount:number)=>void;
  preorder:(studentId:string,item:string,amount:number)=>{ok:boolean;message:string};
  cancelOrder:(id:string)=>void;
  saveBudget:(goal:string,limit:number)=>void;
  lookupStudentForPos:(code:string)=>ReturnType<typeof lookupPosStudent>;
  checkoutPos:(studentId:string,cart:PosCartLine[],idempotencyKey:string)=>CheckoutResult;
};

const DemoContext = createContext<Context|null>(null);
const storageKey = "pikas:unified-demo:v2";
const toPosStudent = (student:DemoStudent):PosStudentRecord => ({id:student.id,preferredName:student.preferredName,grade:student.grade,code:student.code,school:"Instituto Nueva Generación",status:student.status,walletStatus:"active",balanceMinor:student.balance*100,dailyLimitMinor:student.dailyLimit*100,perTransactionLimitMinor:student.perPurchaseLimit*100,spentTodayMinor:student.spentToday*100,allergies:student.allergies,blockedProducts:student.blocked});

export function DemoProvider({children}:{children:ReactNode}) {
  const [state,setState] = useState(initial);
  useEffect(()=>{
    if(process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE!=="true") return;
    const saved=localStorage.getItem(storageKey);
    if(!saved) return;
    try {
      const parsed=JSON.parse(saved) as Partial<State>;
      setState({...initial,...parsed,menuItems:demoMenu,purchases:parsed.purchases??[]});
    } catch {
      localStorage.removeItem(storageKey);
    }
  },[]);
  const commit=(update:(current:State)=>State)=>setState(current=>{const next=update(current);if(process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE==="true")localStorage.setItem(storageKey,JSON.stringify(next));return next});
  const value=useMemo<Context>(()=>({
    state,
    saveParent:parent=>commit(current=>({...current,parent})),
    saveStudent:student=>commit(current=>({...current,students:current.students.map(item=>item.id===student.id?student:item)})),
    addStudent:value=>commit(current=>({...current,students:[...current.students,{...value,id:crypto.randomUUID(),balance:0,spentToday:0,status:"active"}]})),
    archive:(id,restore=false)=>commit(current=>({...current,students:current.students.map(item=>item.id===id?{...item,status:restore?"active":"archived"}:item)})),
    topup:(id,amount)=>commit(current=>({...current,students:current.students.map(item=>item.id===id?{...item,balance:item.balance+amount}:item),transactions:[{id:crypto.randomUUID(),studentId:id,description:"Recarga familiar de demostración",category:"Recarga",amount,status:"completed",createdAt:new Date().toISOString()},...current.transactions]})),
    preorder:(studentId,item,amount)=>{const student=state.students.find(candidate=>candidate.id===studentId);if(!student)return{ok:false,message:"No encontramos el perfil."};if(student.status!=="active")return{ok:false,message:"Tu cuenta no tiene compras activas."};if(student.balance<amount)return{ok:false,message:"No tienes saldo suficiente."};if(student.spentToday+amount>student.dailyLimit)return{ok:false,message:"Esta compra supera tu límite disponible de hoy."};if(student.blocked.some(value=>item.toLowerCase().includes(value.toLowerCase())))return{ok:false,message:"Tu familia ha bloqueado este producto."};commit(current=>({...current,orders:[{id:crypto.randomUUID(),studentId,item,amount,status:"submitted",createdAt:new Date().toISOString()},...current.orders],students:current.students.map(value=>value.id===studentId?{...value,balance:value.balance-amount,spentToday:value.spentToday+amount}:value),transactions:[{id:crypto.randomUUID(),studentId,description:`Reserva: ${item}`,category:"Preorden",amount:-amount,status:"pending",createdAt:new Date().toISOString()},...current.transactions]}));return{ok:true,message:"Preorden enviada. Puedes seguir su estado aquí."}},
    cancelOrder:id=>commit(current=>{const order=current.orders.find(item=>item.id===id);if(!order||order.status==="cancelled")return current;return{...current,orders:current.orders.map(item=>item.id===id?{...item,status:"cancelled"}:item),students:current.students.map(item=>item.id===order.studentId?{...item,balance:item.balance+order.amount,spentToday:Math.max(0,item.spentToday-order.amount)}:item),transactions:[{id:crypto.randomUUID(),studentId:order.studentId,description:`Reverso de reserva: ${order.item}`,category:"Reembolso",amount:order.amount,status:"completed",createdAt:new Date().toISOString()},...current.transactions]}}),
    saveBudget:(goal,limit)=>commit(current=>({...current,budget:{goal,limit,archived:false}})),
    lookupStudentForPos:code=>lookupPosStudent(state.students.map(toPosStudent),code),
    checkoutPos:(studentId,cart,idempotencyKey)=>{
      const student=state.students.find(candidate=>candidate.id===studentId);
      if(!student)return{ok:false,message:"El estudiante ya no está disponible."};
      const prepared=preparePosPurchase({student:toPosStudent(student),menu:state.menuItems,cart,idempotencyKey,purchases:state.purchases,employeeLabel:"Cafetería demo · Caja 1",now:new Date().toISOString(),purchaseId:crypto.randomUUID()});
      if(!prepared.ok)return{ok:false,message:posValidationMessage(prepared)};
      if(!prepared.duplicate){const amount=prepared.purchase.totalMinor/100;commit(current=>({...current,purchases:[prepared.purchase,...current.purchases],students:current.students.map(item=>item.id===studentId?{...item,balance:item.balance-amount,spentToday:item.spentToday+amount}:item),transactions:[{id:`ledger-${prepared.purchase.id}`,purchaseId:prepared.purchase.id,studentId,description:prepared.purchase.items.map(item=>`${item.quantity}× ${item.name}`).join(", "),category:"Compra en cafetería",amount:-amount,status:"completed",createdAt:prepared.purchase.createdAt},...current.transactions]}))}
      return prepared;
    },
  }),[state]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(){const context=useContext(DemoContext);if(!context)throw new Error("DemoProvider ausente");return context}
