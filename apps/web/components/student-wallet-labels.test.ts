import { describe,expect,it,vi } from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh(){}})}));
import { movementActorLabel,movementTypeLabel,originLabel } from './student-wallet';
import { historySchema } from '../lib/wallet/contracts';
const id='5bf00000-0000-4000-8000-000000000001';
const base={id,amount_minor:'194000',balance_after_minor:'194000',version:'1',occurred_at:'2026-10-22T15:00:00Z',source:null,reference:null,note:null,actor:null,replenishment_id:null,purchase_id:null,receipt_number:null,cafeteria:null,items:[]};
const parse=(movement:Record<string,unknown>)=>historySchema.parse({school_id:id,student_id:id,student_name:'Ana Ficticia',wallet:{id,status:'active',currency:'DOP',balance_minor:'194000',version:'1'},movements:[{...base,...movement}],next_before:null}).movements[0];
describe('School wallet history: PIKAS finance attribution',()=>{
 it('verified bank transfer reads as a PIKAS-verified transfer',()=>{const m=parse({type:'replenishment',source:'bank_transfer_verified',reference:'REC-00000001',replenishment_id:id,actor_kind:'pikas'});
  expect(movementTypeLabel(m)).toBe('Recarga por transferencia');expect(movementActorLabel(m)).toBe('PIKAS');expect(originLabel[m.source!]).toBe('Transferencia bancaria verificada por PIKAS');});
 it('finance reversal and funded adjustment are attributed to PIKAS',()=>{
  expect(movementTypeLabel(parse({type:'replenishment_reversal',amount_minor:'-97000',actor_kind:'pikas'}))).toBe('Reversión realizada por PIKAS');
  const adjustment=parse({type:'adjustment',amount_minor:'2500',actor_role:'pikas',actor_kind:'pikas',adjustment_reason:'administrative_correction'});
  expect(movementTypeLabel(adjustment)).toBe('Ajuste realizado por PIKAS');expect(movementActorLabel(adjustment)).toBe('PIKAS');});
 it('tenant actions keep their person and labels',()=>{const m=parse({type:'adjustment',amount_minor:'-500',actor:'Directora Ficticia',actor_role:'school_admin'});
  expect(movementTypeLabel(m)).toBe('Ajuste administrativo');expect(movementActorLabel(m)).toBe('Directora Ficticia');
  expect(movementTypeLabel(parse({type:'replenishment',source:'manual_verified',actor:'Directora Ficticia'}))).toBe('Recarga verificada');});
 it('only the PIKAS marker is accepted from the database',()=>{expect(()=>parse({type:'adjustment',actor_kind:'platform_finance_operator'})).toThrow();});
});
describe('School wallet history: FIN 4 cash collection support record',()=>{
 it('reads as a cash replenishment at the Cafetería, keeps gross/fee/net and the collector, and is never School-reversible',()=>{
  const m=parse({type:'replenishment',source:'cafeteria_cash_collected',reference:'REC-00000077',replenishment_id:id,actor:'Admin Ficticia',method:'cafeteria_cash',gross_minor:'200000',fee_minor:'6000',net_minor:'194000',cafeteria:'Cafetería Norte'});
  expect(movementTypeLabel(m)).toBe('Recarga en efectivo');expect(movementActorLabel(m)).toBe('Admin Ficticia');expect(originLabel[m.source!]).toBe('Efectivo recibido en la cafetería');
  expect([m.gross_minor,m.fee_minor,m.net_minor,m.method]).toEqual(['200000','6000','194000','cafeteria_cash']);});
 it('rows without the FIN 4 fields still parse (legacy and purchases)',()=>{expect(parse({type:'purchase',amount_minor:'-5000'}).gross_minor).toBeUndefined();});
});
