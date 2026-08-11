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
import {activePartnershipAllows,can,type AdminRole,type PartnershipScope,type PartnershipStatus} from "@/lib/admin-policy";

export type DemoStudent = {id:string;firstName:string;lastName:string;preferredName:string;grade:string;code:string;status:"active"|"inactive"|"archived";balance:number;dailyLimit:number;perPurchaseLimit:number;spentToday:number;allergies:string[];blocked:string[]};
export type DemoTx = {id:string;studentId:string;description:string;category:string;amount:number;status:"completed"|"pending"|"reversed";createdAt:string;purchaseId?:string};
export type DemoOrder = {id:string;studentId:string;item:string;amount:number;status:"submitted"|"confirmed"|"cancelled";createdAt:string};
export type DemoAdminUser={id:string;name:string;email:string;role:AdminRole;status:"active"|"suspended"|"inactive";scope:string;lastActivity:string};
export type DemoMembership={id:string;userId:string;organizationType:"school"|"cafeteria";organizationName:string;location?:string;role:AdminRole};
export type DemoPartnership={id:string;schoolName:string;cafeteriaName:string;location:string;status:PartnershipStatus;scope:PartnershipScope[];requestedBy:"school"|"cafeteria"};
export type DemoAudit={id:string;actor:string;action:string;detail:string;createdAt:string};
export type DemoAdministration={school:{name:string;status:"active"};cafeteria:{name:string;status:"active";location:string};users:DemoAdminUser[];memberships:DemoMembership[];partnerships:DemoPartnership[];audit:DemoAudit[]};
type State = {parent:{name:string;email:string;phone:string};students:DemoStudent[];transactions:DemoTx[];orders:DemoOrder[];budget:{goal:string;limit:number;archived:boolean};menuItems:PosMenuItemRecord[];purchases:PosPurchaseRecord[];administration:DemoAdministration};

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
  administration:{
    school:{name:"Instituto Nueva Generación",status:"active"},cafeteria:{name:"Cafetería PIKAS Central",status:"active",location:"Caja principal"},
    users:[
      {id:"sa-1",name:"Elena Méndez",email:"admin.escuela@demo.pikas.do",role:"school_admin",status:"active",scope:"Instituto Nueva Generación",lastActivity:"Hoy, 09:10"},
      {id:"sa-2",name:"Raúl Jiménez",email:"raul.admin@demo.pikas.do",role:"school_admin",status:"active",scope:"Instituto Nueva Generación",lastActivity:"Ayer, 16:40"},
      {id:"ca-1",name:"María Castillo",email:"admin.cafeteria@demo.pikas.do",role:"cafeteria_admin",status:"active",scope:"Cafetería PIKAS Central",lastActivity:"Hoy, 10:02"},
      {id:"ca-2",name:"Jorge Peña",email:"jorge.cafeteria@demo.pikas.do",role:"cafeteria_admin",status:"active",scope:"Cafetería PIKAS Central",lastActivity:"Ayer, 14:22"},
      {id:"pos-1",name:"Caja Demo",email:"cafeteria@demo.pikas.do",role:"pos_operator",status:"active",scope:"Caja principal",lastActivity:"Hoy, 10:18"},
      {id:"pos-2",name:"Caja Patio",email:"caja.patio@demo.pikas.do",role:"pos_operator",status:"suspended",scope:"Patio",lastActivity:"8 ago., 12:05"},
      {id:"pos-3",name:"Caja Eventos",email:"caja.eventos@demo.pikas.do",role:"pos_operator",status:"inactive",scope:"Eventos",lastActivity:"Sin actividad"},
    ],
    memberships:[
      {id:"membership-sa-1",userId:"sa-1",organizationType:"school",organizationName:"Instituto Nueva Generación",role:"school_admin"},
      {id:"membership-ca-1",userId:"ca-1",organizationType:"cafeteria",organizationName:"Cafetería PIKAS Central",location:"Caja principal",role:"cafeteria_admin"},
      {id:"membership-pos-1",userId:"pos-1",organizationType:"cafeteria",organizationName:"Cafetería PIKAS Central",location:"Caja principal",role:"pos_operator"},
    ],
    partnerships:[
      {id:"partner-active",schoolName:"Instituto Nueva Generación",cafeteriaName:"Cafetería PIKAS Central",location:"Caja principal",status:"active",scope:["eligibility","balance","restrictions","limits","transactions"],requestedBy:"school"},
      {id:"partner-pending",schoolName:"Instituto Nueva Generación",cafeteriaName:"Comedor Los Pinos",location:"Comedor norte",status:"pending",scope:["eligibility","restrictions","transactions"],requestedBy:"cafeteria"},
      {id:"partner-suspended",schoolName:"Colegio Horizonte Demo",cafeteriaName:"Cafetería PIKAS Central",location:"Caja principal",status:"suspended",scope:["eligibility","transactions"],requestedBy:"school"},
    ],
    audit:[{id:"audit-1",actor:"Elena Méndez",action:"Conexión aprobada",detail:"Cafetería PIKAS Central · alcance limitado",createdAt:"2026-08-11T09:15:00-04:00"},{id:"audit-2",actor:"María Castillo",action:"Producto actualizado",detail:"Especial del día marcado como no disponible",createdAt:"2026-08-11T09:42:00-04:00"}],
  },
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
  adminUpdateStudent:(role:AdminRole,student:DemoStudent)=>boolean;
  adminAddStudent:(role:AdminRole,student:Omit<DemoStudent,"id"|"balance"|"spentToday"|"status">)=>boolean;
  adminUpdateMenu:(role:AdminRole,item:PosMenuItemRecord)=>boolean;
  adminAddMenu:(role:AdminRole,item:PosMenuItemRecord)=>boolean;
  adminAddUser:(role:AdminRole,user:Omit<DemoAdminUser,"id"|"lastActivity">)=>boolean;
  adminSetUserStatus:(role:AdminRole,id:string,status:DemoAdminUser["status"])=>boolean;
  adminSetPartnership:(role:AdminRole,id:string,status:PartnershipStatus)=>boolean;
  resetDemo:()=>void;
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
      setState({...initial,...parsed,menuItems:parsed.menuItems??demoMenu,purchases:parsed.purchases??[],administration:parsed.administration??initial.administration});
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
    lookupStudentForPos:code=>{const partnership=state.administration.partnerships.find(item=>item.id==="partner-active");const operator=state.administration.users.find(item=>item.id==="pos-1");if(!partnership||!activePartnershipAllows(partnership.status,partnership.scope,"eligibility")||operator?.status!=="active")return{ok:false as const,reason:"unknown_code" as const};return lookupPosStudent(state.students.map(toPosStudent),code)},
    checkoutPos:(studentId,cart,idempotencyKey)=>{
      const partnership=state.administration.partnerships.find(item=>item.id==="partner-active");const operator=state.administration.users.find(item=>item.id==="pos-1");if(!partnership||!activePartnershipAllows(partnership.status,partnership.scope,"transactions")||operator?.status!=="active")return{ok:false,message:"La conexión escuela–cafetería o la cuenta de caja no está activa."};const student=state.students.find(candidate=>candidate.id===studentId);
      if(!student)return{ok:false,message:"El estudiante ya no está disponible."};
      const prepared=preparePosPurchase({student:toPosStudent(student),menu:state.menuItems,cart,idempotencyKey,purchases:state.purchases,employeeLabel:"Cafetería demo · Caja 1",now:new Date().toISOString(),purchaseId:crypto.randomUUID()});
      if(!prepared.ok)return{ok:false,message:posValidationMessage(prepared)};
      if(!prepared.duplicate){const amount=prepared.purchase.totalMinor/100;commit(current=>({...current,purchases:[prepared.purchase,...current.purchases],students:current.students.map(item=>item.id===studentId?{...item,balance:item.balance-amount,spentToday:item.spentToday+amount}:item),transactions:[{id:`ledger-${prepared.purchase.id}`,purchaseId:prepared.purchase.id,studentId,description:prepared.purchase.items.map(item=>`${item.quantity}× ${item.name}`).join(", "),category:"Compra en cafetería",amount:-amount,status:"completed",createdAt:prepared.purchase.createdAt},...current.transactions]}))}
      return prepared;
    },
    adminUpdateStudent:(role,student)=>{if(!can(role,"students:manage"))return false;commit(current=>({...current,students:current.students.map(item=>item.id===student.id?student:item),administration:{...current.administration,audit:[{id:crypto.randomUUID(),actor:"Administración escolar",action:"Estudiante actualizado",detail:student.preferredName,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminAddStudent:(role,student)=>{if(!can(role,"students:manage"))return false;commit(current=>({...current,students:[...current.students,{...student,id:crypto.randomUUID(),balance:0,spentToday:0,status:"active"}],administration:{...current.administration,audit:[{id:crypto.randomUUID(),actor:"Administración escolar",action:"Estudiante agregado",detail:student.preferredName,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminUpdateMenu:(role,item)=>{if(!can(role,"menu:manage"))return false;commit(current=>({...current,menuItems:current.menuItems.map(value=>value.id===item.id?item:value),administration:{...current.administration,audit:[{id:crypto.randomUUID(),actor:"Administración de cafetería",action:"Producto actualizado",detail:item.name,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminAddMenu:(role,item)=>{if(!can(role,"menu:manage"))return false;commit(current=>({...current,menuItems:[...current.menuItems,item],administration:{...current.administration,audit:[{id:crypto.randomUUID(),actor:"Administración de cafetería",action:"Producto creado",detail:item.name,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminAddUser:(role,user)=>{const permission=user.role==="school_admin"?"school_admins:manage":"pos_users:manage";if(!can(role,permission))return false;commit(current=>({...current,administration:{...current.administration,users:[...current.administration.users,{...user,id:crypto.randomUUID(),lastActivity:"Invitación pendiente"}],audit:[{id:crypto.randomUUID(),actor:"Administración",action:"Invitación creada",detail:`${user.name} · ${user.email}`,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminSetUserStatus:(role,id,status)=>{const user=state.administration.users.find(value=>value.id===id);if(!user||!can(role,user.role==="school_admin"?"school_admins:manage":"pos_users:manage"))return false;if(user.role==="school_admin"&&status!=="active"&&state.administration.users.filter(value=>value.role==="school_admin"&&value.status==="active").length<=1)return false;commit(current=>({...current,administration:{...current.administration,users:current.administration.users.map(value=>value.id===id?{...value,status}:value),audit:[{id:crypto.randomUUID(),actor:"Administración",action:"Estado de cuenta actualizado",detail:`${user.name}: ${status}`,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminSetPartnership:(role,id,status)=>{if(!can(role,role==="school_admin"?"partnerships:review":"partnerships:request")||(role==="cafeteria_admin"&&status!=="pending"))return false;commit(current=>({...current,administration:{...current.administration,partnerships:current.administration.partnerships.map(value=>value.id===id?{...value,status}:value),audit:[{id:crypto.randomUUID(),actor:role==="school_admin"?"Administración escolar":"Administración de cafetería",action:"Conexión actualizada",detail:`${id}: ${status}`,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    resetDemo:()=>{setState(initial);if(process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE==="true")localStorage.removeItem(storageKey)},
  }),[state]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(){const context=useContext(DemoContext);if(!context)throw new Error("DemoProvider ausente");return context}
