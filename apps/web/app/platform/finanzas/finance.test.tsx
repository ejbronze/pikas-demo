import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({require:vi.fn(),read:vi.fn()}));
vi.mock('@/lib/platform/customer-console',()=>({requirePlatform:mocks.require,readPlatform:mocks.read}));
vi.mock('../../../lib/platform/customer-console',()=>({requirePlatform:mocks.require,readPlatform:mocks.read}));
vi.mock('@/components/brand-logo',()=>({BrandLogo:()=>null}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh(){}}),usePathname:()=>'/platform/finanzas'}));
(globalThis as {React?:typeof React}).React=React;
import FinancePage from './page';
import FinanceRequestPage from './[reference]/page';
import PlatformLayout from '../layout';
import PlatformHomePage from '../page';
import { financeMessage } from '../../../lib/platform/finance';
const all=['platform:finance:read','platform:finance:replenishments:verify','platform:finance:replenishments:reverse'];
const session=(capabilities:string[])=>({identity:{person:{id:'00000000-0000-4000-8000-00000000f3e2',displayName:'Marisol Finanzas'}},supabase:{},capabilities});
const row={reference:'REC-00000001',status:'pending',customer:'Colegio Ficticio',school:'Sede Norte',student:'Ana Ficticia',student_code:'A-001',gross_minor:'200000',fee_minor:'6000',net_minor:'194000',
 payer_reference:'BHD-48213',has_proof:true,submitted_at:'2026-10-22T14:00:00Z',decided_at:null,reversed_at:null,decided_by:null,reversed_by:null};
const list=(requests:unknown[],view='pending')=>({kind:'ready',value:{view,status:null,query:null,requests,truncated:false}});
const detail={reference:'REC-00000001',status:'pending',method:'bank_transfer',customer:'Colegio Ficticio',customer_activated:true,school:'Sede Norte',student:'Ana Ficticia',student_code:'A-001',
 currency:'DOP',policy_version:1,fee_bps:300,gross_minor:'200000',fee_minor:'6000',net_minor:'194000',payer_reference:'BHD-48213',payer_name:'Laura Méndez',payer_note:'Semana 2',proof_reference:'WhatsApp 22/10',
 submitted_at:'2026-10-22T14:00:00Z',submitted_by:'Directora Ficticia',submitted_role:'school_admin',decided_at:null,decided_by:null,rejection_reason:null,posted_at:null,reversal:null,wallet:null};
const uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const page=async(params:Record<string,string>={})=>renderToStaticMarkup(await FinancePage({searchParams:Promise.resolve(params)}));
const open=async(value:unknown)=>{mocks.read.mockResolvedValue({kind:'ready',value});return renderToStaticMarkup(await FinanceRequestPage({params:Promise.resolve({reference:'REC-00000001'})}));};
beforeEach(()=>{vi.clearAllMocks();mocks.require.mockResolvedValue(session(all));});
describe('Finanzas navigation',()=>{
 it('appears only with finance read',async()=>{expect(renderToStaticMarkup(await PlatformLayout({children:'x'}))).toContain('/platform/finanzas');
  mocks.require.mockResolvedValue(session(['platform:tenant:lifecycle:read','platform:team:manage','platform:finance:replenishments:verify']));
  expect(renderToStaticMarkup(await PlatformLayout({children:'x'}))).not.toContain('/platform/finanzas');});
 it('home offers the finance card to a finance-only operator',async()=>{mocks.require.mockResolvedValue(session(['platform:finance:read']));const html=renderToStaticMarkup(await PlatformHomePage());
  expect(html).toContain('href="/platform/finanzas"');expect(html).toContain('operaciones financieras');});
 it('direct route is denied without finance read, before any read',async()=>{mocks.require.mockResolvedValue(session(['platform:tenant:lifecycle:read']));
  expect(await page()).toContain('No tienes permiso para consultar finanzas');
  expect(renderToStaticMarkup(await FinanceRequestPage({params:Promise.resolve({reference:'REC-00000001'})}))).toContain('No tienes permiso');expect(mocks.read).not.toHaveBeenCalled();});
});
describe('Finanzas queue and history',()=>{
 it('shows pending transfers with gross, fee and net and no identifiers',async()=>{mocks.read.mockResolvedValue(list([row]));const html=await page();
  expect(mocks.read).toHaveBeenCalledWith(expect.anything(),'platform:finance:read','platform_finance_replenishments_read',{p_view:'pending',p_status:null,p_query:null},expect.anything());
  for(const text of ['Transferencias por verificar','REC-00000001','Ana Ficticia · A-001','Colegio Ficticio · Sede Norte','RD$ 2,000.00','Cargo por recarga PIKAS (3 %)','− RD$ 60.00','Se acredita a PIKAS Cash','RD$ 1,940.00','BHD-48213','Con referencia de comprobante','href="/platform/finanzas/REC-00000001"','Por verificar'])expect(html).toContain(text);
  expect(html).not.toMatch(uuid);});
 it('useful empty states',async()=>{mocks.read.mockResolvedValue(list([]));expect(await page()).toContain('No hay transferencias pendientes de verificación.');
  mocks.read.mockResolvedValue(list([],'history'));expect(await page({vista:'historial'})).toContain('Todavía no hay decisiones registradas.');});
 it('history filters map to database states',async()=>{mocks.read.mockResolvedValue(list([{...row,status:'reversed',decided_at:'2026-10-22T15:00:00Z',decided_by:'Marisol',reversed_at:'2026-10-22T16:00:00Z',reversed_by:'Marisol'}],'history'));
  const html=await page({vista:'historial',estado:'revertidas',q:'Ana'});
  expect(mocks.read).toHaveBeenCalledWith(expect.anything(),'platform:finance:read','platform_finance_replenishments_read',{p_view:'history',p_status:'reversed',p_query:'Ana'},expect.anything());
  expect(html).toContain('Revertida');expect(html).toContain('por Marisol');expect(html).toContain('aria-current="page"');});
 it.each([{vista:'todo'},{estado:'submitted'},{q:'x'.repeat(81)}] as Record<string,string>[])('invalid filters never reach the read (%j)',async params=>{expect(await page(params)).toContain('Los filtros no son válidos');expect(mocks.read).not.toHaveBeenCalled();});
 it('read failures fail closed',async()=>{mocks.read.mockResolvedValue({kind:'unavailable'});expect(await page()).toContain('No pudimos cargar la información financiera');});
});
describe('Transfer review',()=>{
 it('shows identity, arithmetic, manual evidence and verify actions',async()=>{const html=await open(detail);
  for(const text of ['REC-00000001','Por verificar','Pagado','RD$ 2,000.00','Cargo por recarga PIKAS (3 %)','RD$ 1,940.00','Las compras con PIKAS Cash no tienen cargo','Ana Ficticia · A-001','Sede Norte','pesos dominicanos',
   'PIKAS no confirma transacciones bancarias automáticamente','Laura Méndez','Semana 2','WhatsApp 22/10','Directora Ficticia','Administración escolar','Verificar transferencia','Rechazar'])expect(html).toContain(text);
  expect(html).not.toMatch(uuid);});
 it('read-only operators see no decision controls',async()=>{mocks.require.mockResolvedValue(session(['platform:finance:read']));const html=await open(detail);
  expect(html).not.toContain('Verificar transferencia');expect(html).toContain('requiere el permiso de verificación');});
 it('an inactive customer cannot be verified',async()=>{const html=await open({...detail,customer_activated:false});expect(html).toContain('no está activo para este cliente');expect(html).not.toContain('Verificar transferencia');});
 it('posted: reversal with wallet context; warns when the credit was spent',async()=>{const posted={...detail,status:'posted',decided_at:'2026-10-22T15:00:00Z',decided_by:'Marisol Finanzas',posted_at:'2026-10-22T15:00:00Z',wallet:{status:'active',balance_minor:'5000',covers_net:false}};
  const html=await open(posted);for(const text of ['Verificada','Marisol Finanzas','Saldo actual','RD$ 50.00','Revertir transferencia','Parte del crédito ya se utilizó','Se acreditó a PIKAS Cash'])expect(html).toContain(text);
  mocks.require.mockResolvedValue(session(['platform:finance:read','platform:finance:replenishments:verify']));expect(await open(posted)).not.toContain('Revertir transferencia');});
 it('rejected and reversed records keep their decision',async()=>{expect(await open({...detail,status:'rejected',decided_at:'2026-10-22T15:00:00Z',decided_by:'Marisol',rejection_reason:'Monto no coincide'})).toContain('Monto no coincide');
  const html=await open({...detail,status:'reversed',decided_at:'2026-10-22T15:00:00Z',decided_by:'Marisol',reversal:{reversed_at:'2026-10-22T16:00:00Z',reason:'wrong_amount',note:null,reversed_by:'Marisol',gross_minor:'200000',fee_minor:'6000',net_minor:'194000'}});
  expect(html).toContain('Monto incorrecto');expect(html).toContain('Sin acciones pendientes');expect(html).not.toContain('Revertir transferencia');});
 it('malformed or unknown references',async()=>{expect(renderToStaticMarkup(await FinanceRequestPage({params:Promise.resolve({reference:'abc'})}))).toContain('No encontramos esta solicitud');
  mocks.read.mockResolvedValue({kind:'missing'});expect(renderToStaticMarkup(await FinanceRequestPage({params:Promise.resolve({reference:'REC-00000009'})}))).toContain('No encontramos esta solicitud');});
});
describe('finance messages',()=>{
 it('translates known business states and never echoes raw errors',()=>{
  expect(financeMessage('FINANCIAL_RESOLUTION_REQUIRED')).toBe('No se puede revertir automáticamente porque parte del saldo acreditado ya fue utilizado. Este caso requiere resolución financiera.');
  expect(financeMessage('REQUEST_ALREADY_DECIDED')).toBe('Esta solicitud ya fue procesada.');expect(financeMessage('23514')).toBe('PIKAS no pudo completar la operación. No se movió dinero.');});
});
describe('FIN 4: Cafetería cash collections in Finanzas',()=>{
 const cash={...row,reference:'REC-00000002',status:'posted',method:'cafeteria_cash',cafeteria:'Cafetería Norte',submitted_by:'Admin Ficticia',payer_reference:null,has_proof:false,decided_at:null};
 it('history names the method and Cafetería, says «Acreditada» and who received the cash; the queue keeps bank transfers',async()=>{
  mocks.read.mockResolvedValue(list([cash],'history'));const html=await page({vista:'historial'});
  expect(html).toContain('Efectivo en Cafetería Norte');expect(html).toContain('Acreditada');expect(html).toContain('Recibida en Cafetería Norte');expect(html).toContain('Admin Ficticia');expect(html).not.toMatch(uuid);});
 it('detail explains the cash collection without verification controls; reversal stays available with its capability',async()=>{
  const html=await open({...detail,reference:'REC-00000002',status:'posted',method:'cafeteria_cash',cafeteria:'Cafetería Norte',payer_reference:null,payer_name:'Madre Ficticia',payer_note:null,proof_reference:null,
   submitted_by:'Admin Ficticia',submitted_role:'cafeteria_staff',posted_at:'2026-10-24T14:00:00Z',wallet:{status:'active',balance_minor:'244000',covers_net:true}});
  for(const s of['Efectivo en Cafetería Norte','Efectivo recibido','Cargo por recarga PIKAS (3 %)','Se acreditó a PIKAS Cash','Efectivo recibido en la cafetería','Recibido por','Admin Ficticia','Entregado por','Madre Ficticia','Acreditada'])expect(html).toContain(s);
  expect(html).not.toContain('Evidencia de la transferencia');expect(html).not.toContain('Verificar');expect(html).toContain('Revertir');expect(html).not.toMatch(uuid);});
 it('a legacy bank row without the new fields still parses as a bank transfer',async()=>{mocks.read.mockResolvedValue(list([row]));const html=await page();expect(html).toContain('REC-00000001');expect(html).not.toContain('Efectivo en');});
});
