import {describe,it,expect} from 'vitest';
import {lookupPosStudent,type PosStudentRecord,type PosPurchaseRecord} from './pos';
import {projectPosCustomer,checkoutCustomer,type CustomerScope} from './pos-projection';
import {cashReconciliation,reportPeriodContains,type FinancialEvent} from './financial';
const student:PosStudentRecord={id:'sofi',preferredName:'Sofi',grade:'5A',code:'PK-10982',school:'School',status:'active',walletStatus:'active',balanceMinor:245000,dailyLimitMinor:35000,dailyLimitEnabled:true,perTransactionLimitMinor:25000,spentTodayMinor:16000,allergies:['Lactosa'],blockedProducts:['Energy'],blockedProductIds:['energy']};
describe('0.6.1 identity and scope contracts',()=>{
  it('rejects ambiguous codes, including archived duplicates and case variants',()=>{expect(lookupPosStudent([student,{...student,id:'other',code:'pk-10982',status:'archived'}],'PK-10982')).toEqual({ok:false,reason:'ambiguous_code'});expect(lookupPosStudent([student],' pk-10982 ')).toMatchObject({ok:true,student:{id:'sofi'}})});
  it.each<CustomerScope[]>([['eligibility'],['eligibility','transactions'],['eligibility','balance'],['eligibility','limits'],['eligibility','restrictions'],['eligibility','balance','limits','restrictions','transactions']])('projects only permitted fields for %j',(...scopes:CustomerScope[])=>{
    const result=projectPosCustomer(student,scopes)!;
    expect('balanceMinor' in result).toBe(scopes.includes('balance'));
    expect('spentTodayMinor' in result).toBe(scopes.includes('limits'));
    expect('allergies' in result).toBe(scopes.includes('restrictions'));
    expect(checkoutCustomer(result,'student_wallet')!==null).toBe(scopes.length===5);
  });
  it('requires identity permission and active enrollment',()=>{expect(projectPosCustomer(student,['balance'])).toBeNull();expect(projectPosCustomer({...student,status:'inactive'},['eligibility'])).toBeNull()});
});
describe('0.6.1 reports',()=>{
  it('today follows Santo Domingo midnight rather than a rolling 24-hour window',()=>{const now='2026-09-23T04:00:00Z';expect(reportPeriodContains('2026-09-23T03:59:59Z','today',now)).toBe(false);expect(reportPeriodContains(now,'today',now)).toBe(true);expect(reportPeriodContains('2026-09-23T04:00:01Z','today',now)).toBe(false)});
  it('separates gross sales, cash replenishments, cash refunds, and expected cash',()=>{
    const purchases=[{cashRegisterImpactMinor:18000},{cashRegisterImpactMinor:0}] as PosPurchaseRecord[];
    const events=[{type:'replenishment',cashImpactMinor:50000},{type:'replenishment',cashImpactMinor:0},{type:'refund',cashImpactMinor:-10000},{type:'refund',cashImpactMinor:0}] as FinancialEvent[];
    expect(cashReconciliation(purchases,events)).toEqual({grossCashSales:18000,cashReplenishments:50000,cashRefunds:10000,expectedCash:58000});
  });
});
