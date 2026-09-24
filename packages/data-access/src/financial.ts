import {validateCashPurchase, type PosMenuItemRecord, type PosPurchaseRecord, type PosStudentRecord} from './pos';

export const BUSINESS_TIME_ZONE = 'America/Santo_Domingo';
export const POPULARITY_DAYS = 30;
export const CUSTOMER_HISTORY_DAYS = 90;
export const CASH_DENOMINATIONS_MINOR = [50000, 100000];
export const businessDay = (timestamp: string) => new Intl.DateTimeFormat('en-CA', {timeZone: BUSINESS_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(timestamp));
export function parseMoney(value: string): number | null {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) ? result : null;
}
export type PosPolicy = {
  showSales: boolean; showCount: boolean; showShiftStart: boolean; showRegister: boolean;
  allowCashierRefunds: boolean; partialRefunds: boolean; requireReason: boolean; requireApproval: boolean;
  allowParentRefundRequests: boolean;
};
export const DEFAULT_POS_POLICY: PosPolicy = {showSales:true, showCount:true, showShiftStart:true, showRegister:true, allowCashierRefunds:false, partialRefunds:false, requireReason:true, requireApproval:true, allowParentRefundRequests:false};
export type FinancialActor = {id:string; name:string; role:'parent'|'student'|'pos_operator'|'cafeteria_admin'|'school_admin'; organizationId:string; locationId:string; registerId:string; active:boolean};
export type FinancialEvent = {
  readonly id:string; readonly type:'replenishment'|'refund'|'correction'|'void'; readonly studentId:string|null;
  readonly originalPurchaseId:string|null; readonly amountMinor:number; readonly walletImpactMinor:number; readonly cashImpactMinor:number;
  readonly balanceBeforeMinor:number|null; readonly balanceAfterMinor:number|null;
  readonly destination:'wallet'|'cash'|'none'; readonly reason:string;
  readonly actorId:string; readonly actorName:string; readonly approvedBy:string|null; readonly approvedByName:string|null;
  readonly organizationId:string; readonly locationId:string; readonly registerId:string;
  readonly createdAt:string; readonly idempotencyKey:string;
};
export type RefundRequest = {id:string; purchaseId:string; studentId:string; status:'requested'|'under_review'|'approved'|'refunded'|'declined'; financialEventId:string|null};
export const refundedMinor = (purchaseId:string, events:readonly FinancialEvent[]) => events.filter(e=>e.type==='refund'&&e.originalPurchaseId===purchaseId).reduce((n,e)=>n+e.amountMinor,0);
export function spendingToday(studentId:string, purchases:readonly PosPurchaseRecord[], events:readonly FinancialEvent[], now:string) {
  const today=businessDay(now);
  const purchasesToday=purchases.filter(p=>p.studentId===studentId&&businessDay(p.createdAt)===today);
  return purchasesToday.reduce((sum,p)=>sum+p.totalMinor-events.filter(e=>e.type==='refund'&&e.originalPurchaseId===p.id&&businessDay(e.createdAt)===today).reduce((n,e)=>n+e.amountMinor,0),0);
}
export function prepareRefund(input:{purchase:PosPurchaseRecord; events:readonly FinancialEvent[]; policy:PosPolicy; actor:FinancialActor; amountMinor:number; reason:string; balanceMinor:number|null; id:string; key:string; now:string}) {
  const {purchase,events,policy,actor,amountMinor}=input;
  if(!actor.active||!['pos_operator','cafeteria_admin'].includes(actor.role)||purchase.organizationId!==actor.organizationId||purchase.locationId!==actor.locationId) throw new Error('Reembolso no autorizado para esta ubicación.');
  if(actor.role==='pos_operator'&&(!policy.allowCashierRefunds||policy.requireApproval)) throw new Error(policy.requireApproval?'Requiere aprobación: un administrador debe procesar el reembolso desde su sesión.':'Reembolsos de caja desactivados.');
  const duplicate=events.find(e=>e.idempotencyKey===input.key);
  if(duplicate){if(duplicate.type!=='refund'||duplicate.originalPurchaseId!==purchase.id||duplicate.amountMinor!==amountMinor||duplicate.actorId!==actor.id)throw new Error('Clave de operación reutilizada.');return duplicate;}
  const remaining=purchase.totalMinor-refundedMinor(purchase.id,events);
  if(purchase.status!=='completed'||!Number.isSafeInteger(amountMinor)||amountMinor<=0||amountMinor>remaining) throw new Error('El monto supera el importe reembolsable o no es válido.');
  if(!policy.partialRefunds&&amountMinor!==remaining)throw new Error('La política permite solo reembolso completo.');
  if(policy.requireReason&&!input.reason.trim())throw new Error('Indica el motivo del reembolso.');
  const wallet=purchase.paymentMethod==='student_wallet';
  if(wallet&&input.balanceMinor===null)throw new Error('Saldo no confirmado.');
  if(wallet&&!Number.isSafeInteger(input.balanceMinor!+amountMinor))throw new Error('Saldo fuera de rango.');
  return Object.freeze({id:input.id,type:'refund' as const,studentId:purchase.studentId,originalPurchaseId:purchase.id,amountMinor,walletImpactMinor:wallet?amountMinor:0,cashImpactMinor:wallet?0:-amountMinor,balanceBeforeMinor:input.balanceMinor,balanceAfterMinor:input.balanceMinor===null?null:input.balanceMinor+(wallet?amountMinor:0),destination:wallet?'wallet' as const:'cash' as const,reason:input.reason.trim(),actorId:actor.id,actorName:actor.name,approvedBy:actor.role==='cafeteria_admin'?actor.id:null,approvedByName:actor.role==='cafeteria_admin'?actor.name:null,organizationId:actor.organizationId,locationId:actor.locationId,registerId:actor.registerId,createdAt:input.now,idempotencyKey:input.key});
}
export function quickAccess(menu:PosMenuItemRecord[], purchases:readonly PosPurchaseRecord[], student:PosStudentRecord|undefined, organizationId:string, locationId:string, now:string) {
  const eligible=menu.filter(item=>item.available&&(!student||validateCashPurchase({...student,dailyLimitMinor:Number.MAX_SAFE_INTEGER,perTransactionLimitMinor:Number.MAX_SAFE_INTEGER,spentTodayMinor:0},[item],[{itemId:item.id,quantity:1}]).ok));
  const eligibleIds=new Set(eligible.map(p=>p.id));
  const rank=(days:number,customer?:string)=>{
    const counts=new Map<string,number>();
    purchases.filter(p=>p.organizationId===organizationId&&p.locationId===locationId&&(!customer||p.studentId===customer)&&Date.parse(p.createdAt)<=Date.parse(now)&&Date.parse(p.createdAt)>=Date.parse(now)-days*86400000).forEach(p=>p.items.forEach(i=>{if(eligibleIds.has(i.itemId))counts.set(i.itemId,(counts.get(i.itemId)??0)+i.quantity)}));
    return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([id])=>eligible.find(p=>p.id===id)!);
  };
  const cafeteria=rank(POPULARITY_DAYS).slice(0,5), used=new Set(cafeteria.map(p=>p.id));
  return {cafeteria,customer:student?rank(CUSTOMER_HISTORY_DAYS,student.id).filter(p=>!used.has(p.id)).slice(0,5):[]};
}

export function reportPeriodContains(timestamp:string, period:string, now:string) {
  const age=Date.parse(now)-Date.parse(timestamp);
  if(age<0)return false;
  return period==='all'||(period==='today'?businessDay(timestamp)===businessDay(now):age<(period==='week'?7:30)*86400000);
}
export function cashReconciliation(purchases:readonly PosPurchaseRecord[],events:readonly FinancialEvent[]) {
  const grossCashSales=purchases.reduce((sum,p)=>sum+p.cashRegisterImpactMinor,0);
  const cashReplenishments=events.filter(e=>e.type==='replenishment').reduce((sum,e)=>sum+e.cashImpactMinor,0);
  const cashRefunds=-events.filter(e=>e.type==='refund').reduce((sum,e)=>sum+e.cashImpactMinor,0);
  return {grossCashSales,cashReplenishments,cashRefunds,expectedCash:grossCashSales+events.reduce((sum,e)=>sum+e.cashImpactMinor,0)};
}
