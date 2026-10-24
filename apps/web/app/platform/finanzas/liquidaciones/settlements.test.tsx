import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({require:vi.fn(),read:vi.fn()}));
vi.mock('@/lib/platform/customer-console',()=>({requirePlatform:mocks.require,readPlatform:mocks.read}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh(){},push(){}}),usePathname:()=>'/platform/finanzas/liquidaciones'}));
(globalThis as {React?:typeof React}).React=React;
import SettlementsPage from './page';
import SettlementPage from './[reference]/page';
import ReadyWeekPage from './semana/page';
import { directionOf, dueLabel, netOf, parseAmount, weekLabel } from '../../../../lib/platform/settlements';
const manage=['platform:finance:read','platform:finance:settlement:manage'];
const session=(capabilities:string[])=>({identity:{person:{id:'00000000-0000-4000-8000-00000000f5e1',displayName:'Liquidaciones Ficticia'}},supabase:{},capabilities});
const caf='5e000000-0000-4000-8000-000000000111';
const ready={cafeteria_id:caf,cafeteria:'Cafetería Las Palmas',customer:'Colegio Ficticio',school:'Colegio Ficticio',week_start:'2026-10-19',week_end:'2026-10-25',due_on:'2026-10-27',
 cafeteria_owes_minor:'1000000',clearing_owes_minor:'750000',net_direction:'cafeteria_to_clearing',net_amount_minor:'250000',line_count:3,late_line_count:0};
const row={...ready,reference:'LIQ-00000001',status:'due',finalized_at:'2026-10-26T12:00:00Z',settled_at:null,overdue:false};
delete (row as Partial<typeof ready>).cafeteria_id;
const lines=[{reason:'cash_collection',direction:'cafeteria_to_clearing',amount_minor:'1000000',occurred_at:'2026-10-20T14:00:00Z',week_start:'2026-10-19',late:false,replenishment_reference:'REC-00000007',student:'Ana Ficticia',receipt_number:null,refund_ordinal:null},
 {reason:'wallet_purchase_fulfillment',direction:'clearing_to_cafeteria',amount_minor:'750000',occurred_at:'2026-10-21T14:00:00Z',week_start:'2026-10-19',late:false,replenishment_reference:null,student:'Ana Ficticia',receipt_number:'12',refund_ordinal:null},
 {reason:'wallet_refund_correction',direction:'cafeteria_to_clearing',amount_minor:'5000',occurred_at:'2026-10-27T14:00:00Z',week_start:'2026-10-12',late:true,replenishment_reference:null,student:'Ana Ficticia',receipt_number:'9',refund_ordinal:1}];
const events=[{kind:'finalized',from_status:null,to_status:'due',amount_minor:null,payment_reference:null,paid_on:null,reason:null,note:null,occurred_at:'2026-10-26T12:00:00Z',actor:'Liquidaciones Ficticia'}];
const detail={...row,finalized_by:'Liquidaciones Ficticia',lines,events};
const list=(value:Record<string,unknown>)=>({kind:'ready',value:{view:'action',query:null,ready:[],settlements:[],truncated:false,...value}});
const uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
beforeEach(()=>{vi.clearAllMocks();mocks.require.mockResolvedValue(session(manage));});
describe('settlement language',()=>{
 it('names weeks, due dates and directions in operational Spanish',()=>{expect(weekLabel('2026-10-19','2026-10-25')).toBe('Semana 19–25 oct');expect(weekLabel('2026-10-26','2026-11-01')).toBe('Semana 26 oct – 1 nov');
  expect(dueLabel('2026-10-27')).toMatch(/mar.* 27 oct/);expect(directionOf('1000000','750000')).toBe('cafeteria_to_clearing');expect(directionOf('400000','800000')).toBe('clearing_to_cafeteria');
  expect(directionOf('5','5')).toBe('none');expect(netOf('400000','800000')).toBe('400000');});
 it('parses operator amounts to integer centavos only',()=>{expect(parseAmount('2,500.00')).toBe('250000');expect(parseAmount('RD$ 0.1')).toBe('10');expect(parseAmount('2500')).toBe('250000');
  for(const bad of ['','0','-5','1.234','abc','1e3'])expect(parseAmount(bad)).toBeNull();});
});
describe('Liquidaciones queue',()=>{
 it('is denied without finance read, before any read',async()=>{mocks.require.mockResolvedValue(session(['platform:tenant:lifecycle:read']));
  expect(renderToStaticMarkup(await SettlementsPage({searchParams:Promise.resolve({})}))).toContain('No tienes permiso');expect(mocks.read).not.toHaveBeenCalled();});
 it('keeps transfers and settlements distinct and shows ready weeks and due settlements with direction in words',async()=>{
  mocks.read.mockResolvedValue(list({ready:[ready],settlements:[row]}));const html=renderToStaticMarkup(await SettlementsPage({searchParams:Promise.resolve({})}));
  expect(mocks.read).toHaveBeenCalledWith(expect.anything(),'platform:finance:read','platform_finance_settlements_read',{p_view:'action',p_query:null},expect.anything());
  for(const t of ['Por verificar','Liquidaciones','aria-current="page"','Semanas cerradas por liquidar','Semana 19–25 oct','Cafetería Las Palmas','Por liquidar','La cafetería debe enviar a PIKAS',
   'RD$ 2,500.00','RD$ 10,000.00','RD$ 7,500.00','Liquidar semanas cerradas','Revisar movimientos','LIQ-00000001','Pendiente de pago','No mueve dinero'])expect(html).toContain(t);
  expect(html.replace(/<[^>]+>/g,' ')).not.toMatch(uuid);});
 it('a read-only operator sees no settlement action',async()=>{mocks.require.mockResolvedValue(session(['platform:finance:read']));mocks.read.mockResolvedValue(list({ready:[ready]}));
  expect(renderToStaticMarkup(await SettlementsPage({searchParams:Promise.resolve({})}))).not.toContain('Liquidar semanas cerradas');});
 it('history and invalid filters',async()=>{mocks.read.mockResolvedValue(list({view:'history',settlements:[{...row,status:'settled',settled_at:'2026-10-27T15:00:00Z'}]}));
  const html=renderToStaticMarkup(await SettlementsPage({searchParams:Promise.resolve({vista:'historial'})}));expect(html).toContain('Liquidada');expect(html).toContain('Historial de liquidaciones');
  expect(renderToStaticMarkup(await SettlementsPage({searchParams:Promise.resolve({vista:'todo'})}))).toContain('Los filtros no son válidos');});
 it('empty states',async()=>{mocks.read.mockResolvedValue(list({}));const html=renderToStaticMarkup(await SettlementsPage({searchParams:Promise.resolve({})}));
  expect(html).toContain('No hay semanas cerradas pendientes de liquidar');expect(html).toContain('No hay liquidaciones pendientes');});
});
describe('Liquidación detail',()=>{
 it('shows the snapshot, every line with its source, late items and history; actions with authority',async()=>{mocks.read.mockResolvedValue({kind:'ready',value:detail});
  const html=renderToStaticMarkup(await SettlementPage({params:Promise.resolve({reference:'LIQ-00000001'})}));
  for(const t of ['LIQ-00000001','Efectivo recibido para PIKAS Cash','REC-00000007 · Ana Ficticia','Ventas pagadas con PIKAS Cash','Recibo #12','Reembolsos y correcciones','reembolso 1',
   'registrado después de su liquidación','Liquidación calculada','Liquidaciones Ficticia','Confirmar pago recibido','Poner en revisión','no cobra otro cargo'])expect(html).toContain(t);
  expect(html).not.toMatch(uuid);});
 it('PIKAS owes: payout wording; read-only: no actions; settled: nothing pending',async()=>{mocks.read.mockResolvedValue({kind:'ready',value:{...detail,net_direction:'clearing_to_cafeteria'}});
  expect(renderToStaticMarkup(await SettlementPage({params:Promise.resolve({reference:'LIQ-00000001'})}))).toContain('Confirmar pago a la cafetería');
  mocks.require.mockResolvedValue(session(['platform:finance:read']));expect(renderToStaticMarkup(await SettlementPage({params:Promise.resolve({reference:'LIQ-00000001'})}))).toContain('Tu acceso permite consultar');
  mocks.require.mockResolvedValue(session(manage));mocks.read.mockResolvedValue({kind:'ready',value:{...detail,status:'settled',settled_at:'2026-10-27T15:00:00Z'}});
  expect(renderToStaticMarkup(await SettlementPage({params:Promise.resolve({reference:'LIQ-00000001'})}))).toContain('Sin acciones pendientes');});
 it('refuses malformed references before the read',async()=>{expect(renderToStaticMarkup(await SettlementPage({params:Promise.resolve({reference:'REC-00000001'})}))).toContain('No encontramos');expect(mocks.read).not.toHaveBeenCalled();});
 it('ready week preview offers finalization',async()=>{mocks.read.mockResolvedValue({kind:'ready',value:{...ready,status:'ready',lines}});
  const html=renderToStaticMarkup(await ReadyWeekPage({searchParams:Promise.resolve({cafeteria:caf,semana:'2026-10-19'})}));
  expect(mocks.read).toHaveBeenCalledWith(expect.anything(),'platform:finance:read','platform_finance_settlement_preview',{p_cafeteria_id:caf,p_week_start:'2026-10-19'},expect.anything());
  for(const t of ['Semana 19–25 oct','Cálculo actual','Calcular liquidación','RD$ 2,500.00'])expect(html).toContain(t);});
});
