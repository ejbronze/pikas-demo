"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_POS_POLICY, businessDay, parseMoney, prepareRefund, spendingToday,
  type FinancialEvent, type PosPolicy, type FinancialActor,
  validatePosPurchase,
  lookupPosStudent,
  posValidationMessage,
  preparePosPurchase,
  type PosCartLine,
  type PosMenuItemRecord,
  type PosPurchaseRecord,
  type PosStudentRecord,
} from "@pikas/data-access";
import {activePartnershipAllows,can,type AdminRole,type PartnershipScope,type PartnershipStatus} from "@/lib/admin-policy";

export type DemoStudent = {schoolName?:string;familyId?:string;dailyLimitEnabled?:boolean;spendingDay?:string;id:string;firstName:string;lastName:string;preferredName:string;grade:string;code:string;status:"active"|"inactive"|"archived";balance:number;dailyLimit:number;perPurchaseLimit:number;spentToday:number;allergies:string[];blocked:string[];blockedProductIds?:string[]};
export type DemoTx = {id:string;studentId:string;description:string;category:string;amount:number;status:"completed"|"pending"|"reversed";createdAt:string;purchaseId?:string;paymentMethod?:"student_wallet"|"cash";purchaseTotalMinor?:number;balanceImpactMinor?:number;cashRegisterImpactMinor?:number};
export type DemoOrder = {id:string;studentId:string;item:string;amount:number;status:"submitted"|"confirmed"|"cancelled";createdAt:string};
export type DemoAdminUser={id:string;name:string;email:string;role:AdminRole;status:"active"|"suspended"|"inactive";scope:string;lastActivity:string};
export type DemoMembership={id:string;userId:string;organizationType:"school"|"cafeteria";organizationName:string;location?:string;role:AdminRole};
export type DemoPartnership={id:string;schoolName:string;cafeteriaName:string;location:string;status:PartnershipStatus;scope:PartnershipScope[];requestedBy:"school"|"cafeteria"};
export type DemoAudit={id:string;actor:string;action:string;detail:string;createdAt:string};
export type DemoAdministration={school:{name:string;status:"active"};cafeteria:{name:string;status:"active";location:string;cashCreditConversionEnabled:boolean};users:DemoAdminUser[];memberships:DemoMembership[];partnerships:DemoPartnership[];audit:DemoAudit[]};
type State = {events:FinancialEvent[];posPolicy:PosPolicy;shiftStartedAt:string;parent:{name:string;email:string;phone:string};students:DemoStudent[];transactions:DemoTx[];orders:DemoOrder[];budget:{goal:string;limit:number;archived:boolean};menuItems:PosMenuItemRecord[];purchases:PosPurchaseRecord[];administration:DemoAdministration};

const demoMenu: PosMenuItemRecord[] = [
  {id:"menu-pasta",name:"Pasta con pollo",description:"Almuerzo completo",category:"Almuerzo",priceMinor:18000,allergens:[],ingredients:["Pasta","Pollo","Tomate"],restrictionTags:["Alto en proteína"],imageUrl:"/menu/pasta.svg",available:true},
  {id:"menu-sandwich",name:"Sándwich integral",description:"Merienda escolar",category:"Merienda",priceMinor:12000,allergens:["Gluten"],ingredients:["Pan integral","Queso","Vegetales"],restrictionTags:[],imageUrl:"/menu/sandwich.svg",available:true},
  {id:"menu-pizza",name:"Pizza escolar",description:"Porción individual",category:"Almuerzo",priceMinor:15000,allergens:["Lactosa"],ingredients:["Masa","Tomate","Queso"],restrictionTags:[],imageUrl:"/menu/pizza.svg",available:true},
  {id:"menu-energy",name:"Bebidas energéticas",description:"Producto restringible",category:"Bebidas",priceMinor:11000,allergens:[],ingredients:["Agua carbonatada"],restrictionTags:["Cafeína"],imageUrl:"/menu/drink.svg",available:true},
  {id:"menu-special",name:"Especial del día",description:"Agotado por hoy",category:"Almuerzo",priceMinor:20000,allergens:[],ingredients:["Arroz","Vegetales"],restrictionTags:[],imageUrl:null,available:false},
];

const normalizeMenu=(items:PosMenuItemRecord[])=>items.map(item=>{
  const fallback=demoMenu.find(seed=>seed.id===item.id);
  return {
    ...fallback,
    ...item,
    ingredients:Array.isArray(item.ingredients)?item.ingredients:fallback?.ingredients??[],
    allergens:Array.isArray(item.allergens)?item.allergens:fallback?.allergens??[],
    restrictionTags:Array.isArray(item.restrictionTags)?item.restrictionTags:fallback?.restrictionTags??[],
    imageUrl:item.imageUrl??fallback?.imageUrl??null,
  };
});

const initial: State = {
  events:[],posPolicy:DEFAULT_POS_POLICY,shiftStartedAt:new Date().toISOString(),
  parent:{name:"Oscar Rosa",email:"familia@demo.pikas.do",phone:"809-555-0142"},
  students:[
    {id:"sofia",firstName:"Sofía",lastName:"Rosa",preferredName:"Sofi",grade:"5.º A",code:"PK-10982",status:"active",balance:2450,dailyLimit:350,perPurchaseLimit:250,spentToday:160,allergies:["Maní","Lactosa"],blocked:["Bebidas energéticas"],blockedProductIds:["menu-energy"]},
    {id:"mateo",firstName:"Mateo",lastName:"Rosa",preferredName:"Mateo",grade:"2.º B",code:"PK-11804",status:"active",balance:1680,dailyLimit:300,perPurchaseLimit:200,spentToday:105,allergies:[],blocked:["Bebidas energéticas"],blockedProductIds:["menu-energy"]},
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
    school:{name:"Instituto Nueva Generación",status:"active"},cafeteria:{name:"Cafetería PIKAS Central",status:"active",location:"Caja principal",cashCreditConversionEnabled:false},
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

type ActionResult = {ok:true}|{ok:false;message:string};
type CheckoutResult = {ok:true;duplicate:boolean;purchase:PosPurchaseRecord}|{ok:false;message:string};
type Context = {
  connection:"Online"|"Connecting"|"Offline"|"Sync Issue";
  searchPosCustomers:(query:string)=>Array<{id:string;name:string;grade:string;code:string}>;
  savePosPolicy:(policy:PosPolicy)=>Promise<ActionResult>;
  loadRecommendationScenario:()=>Promise<ActionResult>;
  replenishPos:(studentId:string,amountMinor:number,key:string)=>Promise<ActionResult>;
  refundPos:(purchaseId:string,amountMinor:number,reason:string,key:string)=>Promise<ActionResult>;
  voidPos:(reason:string,key:string)=>Promise<ActionResult>;
  state:State;
  saveParent:(value:State["parent"])=>void;
  saveStudent:(value:DemoStudent)=>Promise<ActionResult>;
  addStudent:(value:Omit<DemoStudent,"id"|"balance"|"spentToday"|"status">)=>void;
  archive:(id:string,restore?:boolean)=>void;
  topup:(id:string,amount:number,key:string)=>Promise<ActionResult>;
  preorder:(studentId:string,item:string,amount:number)=>Promise<{ok:boolean;message:string}>;
  cancelOrder:(id:string)=>Promise<ActionResult>;
  saveBudget:(goal:string,limit:number)=>void;
  lookupStudentForPos:(code:string)=>ReturnType<typeof lookupPosStudent>;
  checkoutPos:(studentId:string|null,cart:PosCartLine[],idempotencyKey:string,paymentMethod?:"student_wallet"|"cash",cashReceivedMinor?:number,generalSale?:boolean)=>Promise<CheckoutResult>;
  adminUpdateStudent:(role:AdminRole,student:DemoStudent)=>boolean;
  adminAddStudent:(role:AdminRole,student:Omit<DemoStudent,"id"|"balance"|"spentToday"|"status">)=>boolean;
  adminUpdateMenu:(role:AdminRole,item:PosMenuItemRecord)=>boolean;
  adminAddMenu:(role:AdminRole,item:Omit<PosMenuItemRecord,"ingredients"|"restrictionTags"|"imageUrl"> & Partial<Pick<PosMenuItemRecord,"ingredients"|"restrictionTags"|"imageUrl">>)=>boolean;
  adminAddUser:(role:AdminRole,user:Omit<DemoAdminUser,"id"|"lastActivity">)=>boolean;
  adminSetUserStatus:(role:AdminRole,id:string,status:DemoAdminUser["status"])=>boolean;
  adminSetPartnership:(role:AdminRole,id:string,status:PartnershipStatus)=>boolean;
  resetDemo:()=>void;
};

const DemoContext = createContext<Context|null>(null);
const storageKey = "pikas:unified-demo:v2";
export const toPosStudent = (student:DemoStudent):PosStudentRecord => ({id:student.id,preferredName:student.preferredName,grade:student.grade,code:student.code,school:"Instituto Nueva Generación",status:student.status,walletStatus:"active",balanceMinor:parseMoney(String(student.balance))??0,dailyLimitMinor:parseMoney(String(student.dailyLimit))??0,dailyLimitEnabled:student.dailyLimitEnabled!==false,perTransactionLimitMinor:parseMoney(String(student.perPurchaseLimit))??0,spentTodayMinor:parseMoney(String(student.spentToday))??0,allergies:student.allergies,blockedProducts:student.blocked,blockedProductIds:student.blockedProductIds??[]});

export function DemoProvider({children}:{children:ReactNode}) {
  const [state,setState] = useState(initial);
  const currentRef=useRef(initial);
  const [connection,setConnection]=useState<Context["connection"]>("Connecting");
  const sessionRole=useRef<string|null>(null);
  const normalize=(parsed:Partial<State>):State=>{
    const now=new Date().toISOString(), day=businessDay(now);
    const merged={...initial,...parsed,events:parsed.events??[],posPolicy:{...DEFAULT_POS_POLICY,...parsed.posPolicy},menuItems:normalizeMenu(parsed.menuItems??demoMenu),purchases:(parsed.purchases??[]).map(p=>({...p,organizationId:p.organizationId??"cafeteria-demo",locationId:p.locationId??"principal"})),administration:{...initial.administration,...parsed.administration,cafeteria:{...initial.administration.cafeteria,...parsed.administration?.cafeteria}}};
    return {...merged,students:merged.students.map(s=>({...s,spendingDay:day,spentToday:s.spendingDay===day?s.spentToday:s.spendingDay?(spendingToday(s.id,merged.purchases,merged.events,now)+merged.orders.filter(o=>o.studentId===s.id&&o.status!=='cancelled'&&businessDay(o.createdAt)===day).reduce((n,o)=>n+(parseMoney(String(o.amount))??0),0))/100:s.spentToday}))};
  };
  const install=(next:State)=>{currentRef.current=next;setState(next)};
  useEffect(()=>{
    const refresh=()=>{try{const saved=localStorage.getItem(storageKey);install(normalize(saved?JSON.parse(saved):initial));setConnection(navigator.onLine?(sessionRole.current?"Online":"Connecting"):"Offline")}catch{setConnection("Sync Issue")}};
    if(process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE!=="true") {
      fetch("/api/menu").then(response=>response.ok?response.json():Promise.reject()).then((payload:{items:PosMenuItemRecord[]})=>install({...currentRef.current,menuItems:payload.items})).catch(()=>setConnection("Sync Issue"));
      return;
    }
    refresh();
    fetch('/api/demo/session').then(r=>r.json()).then(p=>{sessionRole.current=p.role;refresh()}).catch(()=>setConnection('Sync Issue'));
    const offline=()=>setConnection("Offline"), online=()=>refresh();
    const storage=(e:StorageEvent)=>{if(e.key===storageKey)refresh()};
    window.addEventListener('offline',offline);window.addEventListener('online',online);window.addEventListener('storage',storage);
    const timer=window.setInterval(()=>{const day=businessDay(new Date().toISOString());if(currentRef.current.students.some(s=>s.spendingDay!==day))refresh()},30000);
    return ()=>{window.removeEventListener('offline',offline);window.removeEventListener('online',online);window.removeEventListener('storage',storage);clearInterval(timer)};
  },[]);
  const commit=(update:(current:State)=>State)=>{
    const apply=()=>{try{const saved=process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE==="true"?localStorage.getItem(storageKey):null;const next=update(normalize(saved?JSON.parse(saved):currentRef.current));if(process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE==="true")localStorage.setItem(storageKey,JSON.stringify(next));install(next)}catch{setConnection('Sync Issue')}};
    if(process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE==="true"&&navigator.locks)void navigator.locks.request(storageKey,apply).catch(()=>setConnection('Sync Issue'));else apply();
  };
  // Web Locks serializes tabs; storage is written before success is returned.
  const financial=async <T extends ActionResult>(roles:string[],action:(current:State,actor:FinancialActor)=>{next:State;result:T}):Promise<T|{ok:false;message:string}>=>{
    if(process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE!=="true"||!navigator.onLine||!navigator.locks)return {ok:false,message:'Estado financiero no confirmado. Conéctate antes de continuar.'};
    try{
      const response=await fetch('/api/demo/session',{cache:'no-store'});if(!response.ok)throw new Error('Sesión no confirmada.');const {role}=await response.json();sessionRole.current=role;
      if(!roles.includes(role))throw new Error('Operación no autorizada.');
      return await navigator.locks.request(storageKey,()=>{
        if(!navigator.onLine)throw new Error("Sin conexión. Operación bloqueada.");
        const saved=localStorage.getItem(storageKey);const current=normalize(saved?JSON.parse(saved):currentRef.current);
        const id=role==='pos_operator'?'pos-1':role==='cafeteria_admin'?'ca-1':role==='student'?'student-sofia':'parent-demo';
        const user=current.administration.users.find(u=>u.id===id);
        const actor:FinancialActor={id,name:user?.name??current.parent.name,role,organizationId:'cafeteria-demo',locationId:'principal',registerId:role==='parent'?'family':'caja-1',active:role==='parent'||(role==='student'&&current.students.some(s=>s.id==='sofia'&&s.status==='active'))||user?.status==='active'};
        if(!actor.active)throw new Error('La cuenta no está activa.');
        const {next,result}=action(current,actor);
        localStorage.setItem(storageKey,JSON.stringify(next));install(next);setConnection('Online');return result;
      });
    }catch(error){if(error instanceof DOMException||error instanceof TypeError)setConnection('Sync Issue');return {ok:false,message:error instanceof Error?error.message:'No se pudo confirmar la operación.'}}
  };
  const eligible=(current:State,student:DemoStudent,operation:PartnershipScope)=>current.administration.partnerships.some(p=>p.schoolName===(student.schoolName??current.administration.school.name)&&p.cafeteriaName===current.administration.cafeteria.name&&p.location===current.administration.cafeteria.location&&activePartnershipAllows(p.status,p.scope,operation));
  const addEvent=(current:State,event:FinancialEvent):State=>({...current,events:[event,...current.events],students:current.students.map(s=>s.id===event.studentId?{...s,balance:(toPosStudent(s).balanceMinor+event.walletImpactMinor)/100,spentToday:event.type==='refund'&&current.purchases.some(p=>p.id===event.originalPurchaseId&&businessDay(p.createdAt)===businessDay(event.createdAt))?Math.max(0,(toPosStudent(s).spentTodayMinor-event.amountMinor)/100):s.spentToday}:s),transactions:event.studentId?[{id:event.id,studentId:event.studentId,purchaseId:event.originalPurchaseId??undefined,description:event.type==='refund'?`Reembolso · ${event.reason}`:'Recarga de saldo',category:event.type==='refund'?'Reembolso':'Recarga',amount:event.walletImpactMinor/100,status:'completed',createdAt:event.createdAt},...current.transactions]:current.transactions});
  const replenish=(studentId:string,amountMinor:number,key:string,roles:string[])=>financial(roles,(current,actor)=>{
    const student=current.students.find(s=>s.id===studentId);
    if(!student||student.status!=='active'||(actor.role==='parent'?(student.familyId??'family-demo')!=='family-demo':!eligible(current,student,'balance')))throw new Error('Cuenta no autorizada.');
    const existing=current.events.find(e=>e.idempotencyKey===key);
    if(existing){if(existing.type!=='replenishment'||existing.studentId!==studentId||existing.amountMinor!==amountMinor||existing.actorId!==actor.id)throw new Error('Clave reutilizada.');return {next:current,result:{ok:true as const}}}
    const before=toPosStudent(student).balanceMinor;
    if(!Number.isSafeInteger(amountMinor)||amountMinor<=0||!Number.isSafeInteger(before+amountMinor))throw new Error('Monto no válido.');
    const event:FinancialEvent={id:crypto.randomUUID(),type:'replenishment',studentId,originalPurchaseId:null,amountMinor,walletImpactMinor:amountMinor,cashImpactMinor:actor.role==='parent'?0:amountMinor,balanceBeforeMinor:before,balanceAfterMinor:before+amountMinor,destination:'wallet',reason:'Recarga de saldo demo',actorId:actor.id,actorName:actor.name,approvedBy:null,approvedByName:null,organizationId:actor.organizationId,locationId:actor.locationId,registerId:actor.registerId,createdAt:new Date().toISOString(),idempotencyKey:key};
    return {next:addEvent(current,event),result:{ok:true as const}};
  });
  const value:Context={
    state,connection,
    searchPosCustomers:query=>{
      if(sessionRole.current!=='pos_operator'||query.trim().length<2||state.administration.users.find(u=>u.id==='pos-1')?.status!=='active')return [];
      const normalizeName=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      return state.students.filter(s=>s.status==='active'&&eligible(state,s,'eligibility')&&normalizeName(`${s.firstName} ${s.lastName} ${s.preferredName} ${s.code}`).includes(normalizeName(query.trim()))).slice(0,8).map(s=>({id:s.id,name:`${s.preferredName} ${s.lastName}`,grade:s.grade,code:s.code}));
    },
    savePosPolicy:policy=>financial(['cafeteria_admin'],(current,actor)=>({next:{...current,posPolicy:{...policy,allowParentRefundRequests:false},administration:{...current.administration,audit:[{id:crypto.randomUUID(),actor:actor.name,action:'Política POS actualizada',detail:JSON.stringify(policy),createdAt:new Date().toISOString()},...current.administration.audit]}},result:{ok:true as const}})),
    loadRecommendationScenario:()=>financial(['cafeteria_admin'],(current,actor)=>{
      if(current.purchases.some(p=>p.id==='history-demo-0'))return {next:current,result:{ok:true as const}};
      const names=['Agua mineral','Jugo natural','Manzana','Banana','Ensalada de frutas','Arroz con vegetales','Pollo al horno','Tostada integral','Sopa de vegetales','Avena'];
      const items:PosMenuItemRecord[]=names.map((name,i)=>({id:`history-menu-${i}`,name,description:'Producto ficticio para historial',category:'Merienda',priceMinor:5000+i*500,allergens:[],ingredients:[],restrictionTags:[],imageUrl:null,available:true}));
      const purchases:PosPurchaseRecord[]=items.map((item,i)=>({id:`history-demo-${i}`,studentId:'sofia',studentName:'Sofi',studentCode:'PK-10982',items:[{itemId:item.id,name:item.name,quantity:1,unitPriceMinor:item.priceMinor}],totalMinor:item.priceMinor,status:'completed',paymentMethod:'cash',studentAssociation:'student_linked',balanceImpactMinor:0,cashRegisterImpactMinor:item.priceMinor,cashReceivedMinor:item.priceMinor,changeProvidedMinor:0,cashierId:'pos-1',posStationId:'caja-1',employeeLabel:'Caja Demo',organizationId:'cafeteria-demo',locationId:'principal',idempotencyKey:`history-demo-${i}`,createdAt:new Date(Date.now()-(i<5?2:40)*86400000).toISOString()}));
      return {next:{...current,menuItems:[...current.menuItems,...items],purchases:[...current.purchases,...purchases],transactions:[...current.transactions,...purchases.map(p=>({id:`ledger-${p.id}`,studentId:'sofia',purchaseId:p.id,description:p.items[0]!.name,category:'Compra histórica ficticia',amount:0,status:'completed' as const,createdAt:p.createdAt,paymentMethod:'cash' as const,purchaseTotalMinor:p.totalMinor,balanceImpactMinor:0,cashRegisterImpactMinor:p.totalMinor}))],administration:{...current.administration,audit:[{id:crypto.randomUUID(),actor:actor.name,action:'Escenario de historial cargado',detail:'10 compras históricas ficticias; sin cambio al saldo o gasto de hoy.',createdAt:new Date().toISOString()},...current.administration.audit]}},result:{ok:true as const}};
    }),
    replenishPos:(studentId,amount,key)=>replenish(studentId,amount,key,['pos_operator']),
    refundPos:(purchaseId,amountMinor,reason,key)=>financial(['pos_operator','cafeteria_admin'],(current,actor)=>{
      const purchase=current.purchases.find(p=>p.id===purchaseId);if(!purchase)throw new Error('Compra no encontrada.');
      const student=current.students.find(s=>s.id===purchase.studentId);
      const event=prepareRefund({purchase,events:current.events,policy:current.posPolicy,actor,amountMinor,reason,balanceMinor:student?toPosStudent(student).balanceMinor:null,id:crypto.randomUUID(),key,now:new Date().toISOString()});
      return {next:current.events.some(e=>e.id===event.id)?current:addEvent(current,event),result:{ok:true as const}};
    }),
    voidPos:(reason,key)=>financial(['pos_operator'],(current,actor)=>{
      if(current.events.some(e=>e.idempotencyKey===key))return {next:current,result:{ok:true as const}};
      const event:FinancialEvent={id:crypto.randomUUID(),type:'void',studentId:null,originalPurchaseId:null,amountMinor:0,walletImpactMinor:0,cashImpactMinor:0,balanceBeforeMinor:null,balanceAfterMinor:null,destination:'none',reason,actorId:actor.id,actorName:actor.name,approvedBy:null,approvedByName:null,organizationId:actor.organizationId,locationId:actor.locationId,registerId:actor.registerId,createdAt:new Date().toISOString(),idempotencyKey:key};
      return {next:addEvent(current,event),result:{ok:true as const}};
    }),
    saveParent:parent=>commit(current=>({...current,parent})),
    saveStudent:student=>financial(['parent','student'],(current,actor)=>{
      const existing=current.students.find(s=>s.id===student.id);
      if(!existing||(actor.role==='student'?student.id!=='sofia':(existing.familyId??'family-demo')!=='family-demo'))throw new Error('Cuenta no autorizada.');
      if(parseMoney(String(student.dailyLimit))===null||parseMoney(String(student.perPurchaseLimit))===null)throw new Error('Límite no válido.');
      const updated=actor.role==='student'?{...existing,preferredName:student.preferredName}:{...existing,preferredName:student.preferredName,grade:student.grade,dailyLimit:student.dailyLimit,dailyLimitEnabled:student.dailyLimitEnabled,perPurchaseLimit:student.perPurchaseLimit,allergies:student.allergies,blocked:student.blocked,blockedProductIds:student.blockedProductIds};
      return {next:{...current,students:current.students.map(s=>s.id===student.id?updated:s)},result:{ok:true as const}};
    }),
    addStudent:value=>commit(current=>({...current,students:[...current.students,{...value,id:crypto.randomUUID(),balance:0,spentToday:0,status:"active"}]})),
    archive:(id,restore=false)=>commit(current=>({...current,students:current.students.map(item=>item.id===id?{...item,status:restore?"active":"archived"}:item)})),
    topup:(id,amount,key)=>replenish(id,parseMoney(String(amount))??0,key,['parent']),
    preorder:(studentId,item)=>financial(['student','parent'],(current,actor)=>{
      const student=current.students.find(s=>s.id===studentId);
      if(!student||(actor.role==='student'?studentId!=='sofia':(student.familyId??'family-demo')!=='family-demo'))throw new Error('Cuenta no autorizada.');
      const product=current.menuItems.find(p=>p.name===item);if(!product)throw new Error('Producto no encontrado.');
      const validation=validatePosPurchase(toPosStudent(student),current.menuItems,[{itemId:product.id,quantity:1}]);if(!validation.ok)throw new Error(posValidationMessage(validation));
      const id=crypto.randomUUID(),now=new Date().toISOString(),amount=validation.totalMinor;
      return {result:{ok:true as const,message:'Preorden enviada. Puedes seguir su estado aquí.'},next:{...current,orders:[{id,studentId,item:product.name,amount:amount/100,status:'submitted',createdAt:now},...current.orders],students:current.students.map(s=>s.id===studentId?{...s,balance:(toPosStudent(s).balanceMinor-amount)/100,spentToday:(toPosStudent(s).spentTodayMinor+amount)/100}:s),transactions:[{id:`reserve-${id}`,studentId,description:`Reserva: ${product.name}`,category:'Preorden',amount:-amount/100,status:'pending',createdAt:now},...current.transactions]}};
    }),
    cancelOrder:id=>financial(['student','parent'],(current,actor)=>{
      const order=current.orders.find(o=>o.id===id);if(!order)throw new Error('Pedido no encontrado.');
      const student=current.students.find(s=>s.id===order.studentId);
      if(!student||(actor.role==='student'?student.id!=='sofia':(student.familyId??'family-demo')!=='family-demo'))throw new Error('Cuenta no autorizada.');
      if(order.status==='cancelled')return {next:current,result:{ok:true as const}};
      if(order.status!=='submitted')throw new Error('Este pedido ya no se puede cancelar.');
      const amount=parseMoney(String(order.amount))??0,now=new Date().toISOString();
      return {result:{ok:true as const},next:{...current,orders:current.orders.map(o=>o.id===id?{...o,status:'cancelled'}:o),students:current.students.map(s=>s.id===student.id?{...s,balance:(toPosStudent(s).balanceMinor+amount)/100,spentToday:businessDay(order.createdAt)===businessDay(now)?Math.max(0,(toPosStudent(s).spentTodayMinor-amount)/100):s.spentToday}:s),transactions:[{id:`cancel-${id}`,studentId:student.id,description:`Reverso de reserva: ${order.item}`,category:'Reembolso de reserva',amount:amount/100,status:'completed',createdAt:now},...current.transactions]}};
    }),
    saveBudget:(goal,limit)=>commit(current=>({...current,budget:{goal,limit,archived:false}})),
    lookupStudentForPos:code=>{
      if(sessionRole.current!=='pos_operator'||state.administration.users.find(u=>u.id==='pos-1')?.status!=='active')return {ok:false as const,reason:'unknown_code' as const};
      return lookupPosStudent(state.students.filter(s=>eligible(state,s,'eligibility')).map(toPosStudent),code);
    },
    checkoutPos:(studentId,cart,idempotencyKey,paymentMethod="student_wallet",cashReceivedMinor,generalSale=false)=>financial<CheckoutResult>(['pos_operator'],(current,actor)=>{
      const student=current.students.find(s=>s.id===studentId);
      if(!generalSale&&(!student||!['eligibility','restrictions','limits','transactions',...(paymentMethod==='student_wallet'?['balance']:[])].every(scope=>eligible(current,student,scope as PartnershipScope))))throw new Error('La conexión escuela–cafetería o la cuenta no está activa.');
      if(generalSale&&(paymentMethod!=='cash'||studentId!==null))throw new Error('Selecciona efectivo para No usuario.');
      if(paymentMethod==='cash'&&cashReceivedMinor===undefined)throw new Error('Indica el efectivo recibido.');
      const previous=current.purchases.find(p=>p.idempotencyKey===idempotencyKey);
      if(previous&&(previous.studentId!==studentId||previous.paymentMethod!==paymentMethod||previous.cashierId!==actor.id||JSON.stringify(previous.items.map(i=>[i.itemId,i.quantity]).sort())!==JSON.stringify(cart.map(i=>[i.itemId,i.quantity]).sort())))throw new Error('Clave de operación reutilizada.');
      const prepared=preparePosPurchase({student:student?toPosStudent(student):undefined,menu:current.menuItems,cart,idempotencyKey,purchases:current.purchases,employeeLabel:actor.name,cashierId:actor.id,posStationId:actor.registerId,organizationId:actor.organizationId,locationId:actor.locationId,now:new Date().toISOString(),purchaseId:crypto.randomUUID(),paymentMethod,cashReceivedMinor,studentAssociation:generalSale?'general_sale':paymentMethod==='cash'?'student_linked':'required'});
      if(!prepared.ok)throw new Error(posValidationMessage(prepared));
      if(prepared.duplicate)return {next:current,result:prepared};
      const p=prepared.purchase;
      return {result:prepared,next:{...current,purchases:[p,...current.purchases],students:current.students.map(s=>s.id===studentId?{...s,balance:(toPosStudent(s).balanceMinor+p.balanceImpactMinor)/100,spentToday:(toPosStudent(s).spentTodayMinor+p.totalMinor)/100}:s),transactions:generalSale?current.transactions:[{id:`ledger-${p.id}`,purchaseId:p.id,studentId:studentId!,description:p.items.map(i=>`${i.quantity}× ${i.name}`).join(', '),category:paymentMethod==='cash'?'Cash — Student-linked':'Cashless / PIKAS account',amount:p.balanceImpactMinor/100,status:'completed',createdAt:p.createdAt,paymentMethod,purchaseTotalMinor:p.totalMinor,balanceImpactMinor:p.balanceImpactMinor,cashRegisterImpactMinor:p.cashRegisterImpactMinor},...current.transactions]}};
    }),
    adminUpdateStudent:(role,student)=>{if(!can(role,"students:manage"))return false;commit(current=>({...current,students:current.students.map(item=>item.id===student.id?{...student,balance:item.balance,spentToday:item.spentToday,spendingDay:item.spendingDay}:item),administration:{...current.administration,audit:[{id:crypto.randomUUID(),actor:"Administración escolar",action:"Estudiante actualizado",detail:student.preferredName,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminAddStudent:(role,student)=>{if(!can(role,"students:manage"))return false;commit(current=>({...current,students:[...current.students,{...student,familyId:"unlinked",id:crypto.randomUUID(),balance:0,spentToday:0,status:"active"}],administration:{...current.administration,audit:[{id:crypto.randomUUID(),actor:"Administración escolar",action:"Estudiante agregado",detail:student.preferredName,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminUpdateMenu:(role,item)=>{if(!can(role,"menu:manage"))return false;if(process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE!=="true")void fetch("/api/menu",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({...item,ingredients:[],dietaryTags:[],imageUrl:null})});commit(current=>({...current,menuItems:current.menuItems.map(value=>value.id===item.id?item:value),administration:{...current.administration,audit:[{id:crypto.randomUUID(),actor:"Administración de cafetería",action:"Producto actualizado",detail:item.name,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminAddMenu:(role,item)=>{if(!can(role,"menu:manage"))return false;const complete={...item,ingredients:item.ingredients??[],restrictionTags:item.restrictionTags??[],imageUrl:item.imageUrl??null};if(process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE!=="true")void fetch("/api/menu",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...complete,dietaryTags:complete.restrictionTags})});commit(current=>({...current,menuItems:[...current.menuItems,complete],administration:{...current.administration,audit:[{id:crypto.randomUUID(),actor:"Administración de cafetería",action:"Producto creado",detail:item.name,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminAddUser:(role,user)=>{const permission=user.role==="school_admin"?"school_admins:manage":"pos_users:manage";if(!can(role,permission))return false;commit(current=>({...current,administration:{...current.administration,users:[...current.administration.users,{...user,id:crypto.randomUUID(),lastActivity:"Invitación pendiente"}],audit:[{id:crypto.randomUUID(),actor:"Administración",action:"Invitación creada",detail:`${user.name} · ${user.email}`,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminSetUserStatus:(role,id,status)=>{const user=state.administration.users.find(value=>value.id===id);if(!user||!can(role,user.role==="school_admin"?"school_admins:manage":"pos_users:manage"))return false;if(user.role==="school_admin"&&status!=="active"&&state.administration.users.filter(value=>value.role==="school_admin"&&value.status==="active").length<=1)return false;commit(current=>({...current,administration:{...current.administration,users:current.administration.users.map(value=>value.id===id?{...value,status}:value),audit:[{id:crypto.randomUUID(),actor:"Administración",action:"Estado de cuenta actualizado",detail:`${user.name}: ${status}`,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    adminSetPartnership:(role,id,status)=>{if(!can(role,role==="school_admin"?"partnerships:review":"partnerships:request")||(role==="cafeteria_admin"&&status!=="pending"))return false;commit(current=>({...current,administration:{...current.administration,partnerships:current.administration.partnerships.map(value=>value.id===id?{...value,status}:value),audit:[{id:crypto.randomUUID(),actor:role==="school_admin"?"Administración escolar":"Administración de cafetería",action:"Conexión actualizada",detail:`${id}: ${status}`,createdAt:new Date().toISOString()},...current.administration.audit]}}));return true},
    resetDemo:()=>{install(normalize({...initial,shiftStartedAt:new Date().toISOString()}));if(process.env.NEXT_PUBLIC_PIKAS_DEMO_MODE==="true")localStorage.removeItem(storageKey)},
  };
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(){const context=useContext(DemoContext);if(!context)throw new Error("DemoProvider ausente");return context}

export function useFamilyDemo(){const context=useDemo();const students=context.state.students.filter(s=>(s.familyId??'family-demo')==='family-demo');const ids=new Set(students.map(s=>s.id));return {...context,state:{...context.state,students,transactions:context.state.transactions.filter(t=>ids.has(t.studentId)),orders:context.state.orders.filter(o=>ids.has(o.studentId)),purchases:context.state.purchases.filter(p=>p.studentId&&ids.has(p.studentId)),events:context.state.events.filter(e=>e.studentId&&ids.has(e.studentId))}}}

export function useCafeteriaDemo(){const context=useDemo();return {...context,state:{...context.state,purchases:context.state.purchases.filter(p=>p.organizationId==='cafeteria-demo'&&p.locationId==='principal'),events:context.state.events.filter(e=>e.organizationId==='cafeteria-demo'&&e.locationId==='principal')}}}
