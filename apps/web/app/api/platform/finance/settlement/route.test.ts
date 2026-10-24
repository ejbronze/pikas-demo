import { NextRequest } from 'next/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),create:vi.fn(),identity:vi.fn()}));
vi.mock('@/lib/auth/pikas-context',()=>({resolvePikasIdentity:mocks.identity}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:mocks.create}));
import { POST } from './route';
const key='5e000000-0000-4000-8000-000000000001', caf='5e000000-0000-4000-8000-000000000111';
const caps=(...c:string[])=>mocks.identity.mockResolvedValue({status:'ready',platform:{capabilities:c}});
function request(body:unknown,origin='http://localhost:3000',idem:string|null=key){const headers:Record<string,string>={origin,'Content-Type':'application/json'};if(idem)headers['Idempotency-Key']=idem;
 return new NextRequest('http://localhost:3000/api/platform/finance/settlement',{method:'POST',headers,body:JSON.stringify(body)});}
const settlement={reference:'LIQ-00000001',status:'due',cafeteria:'Cafetería Ficticia',customer:'Colegio Ficticio',week_start:'2026-10-19',week_end:'2026-10-25',due_on:'2026-10-27',
 cafeteria_owes_minor:'1000000',clearing_owes_minor:'750000',net_direction:'cafeteria_to_clearing',net_amount_minor:'250000',line_count:3,late_line_count:0,finalized_at:'2026-10-26T12:00:00Z',settled_at:null,replayed:false};
beforeEach(()=>{vi.clearAllMocks();mocks.create.mockResolvedValue({rpc:mocks.rpc});caps('platform:finance:read','platform:finance:settlement:manage');mocks.rpc.mockResolvedValue({data:settlement,error:null});});
describe('settlement API',()=>{
 it('finalizes one ended week with the request key',async()=>{const response=await POST(request({operation:'finalize',cafeteria_id:caf,week_start:'2026-10-19'}));
  expect(response.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('platform_finance_settlement_finalize',{p_cafeteria_id:caf,p_week_start:'2026-10-19',p_request_key:key});
  expect((await response.json()).result).toEqual({reference:'LIQ-00000001',status:'due',net_direction:'cafeteria_to_clearing',net_amount_minor:'250000',replayed:false});});
 it('runs every ended week',async()=>{mocks.rpc.mockResolvedValue({data:{count:1,finalized:[settlement]},error:null});const response=await POST(request({operation:'run'}));
  expect(response.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('platform_finance_settlement_run',{p_request_key:key});expect((await response.json()).result.count).toBe(1);});
 it('confirms a payment in integer centavos',async()=>{mocks.rpc.mockResolvedValue({data:{...settlement,status:'settled',event:'payment_confirmed'},error:null});
  await POST(request({operation:'payment',reference:'LIQ-00000001',amount_minor:'250000',payment_reference:'TRX-778',paid_on:'2026-10-27'}));
  expect(mocks.rpc).toHaveBeenCalledWith('platform_finance_settlement_confirm_payment',{p_reference:'LIQ-00000001',p_amount_minor:250000,p_payment_reference:'TRX-778',p_paid_on:'2026-10-27',p_note:null,p_request_key:key});});
 it('opens and resolves a review',async()=>{await POST(request({operation:'review',reference:'LIQ-00000001',action:'open',reason:'cash_total_differs',note:''}));
  expect(mocks.rpc).toHaveBeenLastCalledWith('platform_finance_settlement_review',{p_reference:'LIQ-00000001',p_action:'open',p_reason:'cash_total_differs',p_note:null,p_request_key:key});
  await POST(request({operation:'review',reference:'LIQ-00000001',action:'resolve',reason:null,note:'Cifras verificadas'}));
  expect(mocks.rpc).toHaveBeenLastCalledWith('platform_finance_settlement_review',{p_reference:'LIQ-00000001',p_action:'resolve',p_reason:null,p_note:'Cifras verificadas',p_request_key:key});});
 it.each([{operation:'finalize',cafeteria_id:'x',week_start:'2026-10-19'},{operation:'payment',reference:'LIQ-1',amount_minor:'1',payment_reference:'TRX',paid_on:'2026-10-27'},
  {operation:'payment',reference:'LIQ-00000001',amount_minor:'12.50',payment_reference:'TRX',paid_on:'2026-10-27'},{operation:'payment',reference:'LIQ-00000001',amount_minor:'0',payment_reference:'TRX',paid_on:'2026-10-27'},
  {operation:'payment',reference:'LIQ-00000001',amount_minor:'100',payment_reference:'T',paid_on:'2026-10-27'},{operation:'review',reference:'LIQ-00000001',action:'open',reason:null,note:''},
  {operation:'review',reference:'LIQ-00000001',action:'resolve',reason:null,note:''},{operation:'review',reference:'LIQ-00000001',action:'open',reason:'other',note:''},
  {operation:'settle',reference:'LIQ-00000001'},{operation:'run',account_id:caf}])
  ('refuses malformed command %j before the database',async body=>{expect((await POST(request(body))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it.each([[['platform:finance:read']],[['platform:finance:read','platform:finance:replenishments:verify','platform:finance:replenishments:reverse']],[['platform:tenant:lifecycle:manage']],[[]]])
  ('requires settlement authority (%j)',async c=>{caps(...c);expect((await POST(request({operation:'run'}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('refuses cross-origin, missing key and signed-out requests',async()=>{expect((await POST(request({operation:'run'},'https://untrusted.invalid'))).status).toBe(403);
  expect((await POST(request({operation:'run'},undefined,null))).status).toBe(400);mocks.identity.mockResolvedValue({status:'unauthenticated'});expect((await POST(request({operation:'run'}))).status).toBe(401);});
 it.each(['PERIOD_NOT_ENDED','EARLIER_PERIOD_PENDING','NOTHING_TO_SETTLE','SETTLEMENT_ALREADY_SETTLED','SETTLEMENT_STATUS_CONFLICT','IDEMPOTENCY_CONFLICT','SETTLEMENT_SANDBOX_REFUSED','INVALID_PAYMENT_DATE'])
  ('names the business refusal %s',async message=>{mocks.rpc.mockResolvedValue({data:null,error:{code:'23514',message}});const response=await POST(request({operation:'run'}));
  expect(response.status).toBe(422);expect((await response.json()).error).toBe(message);});
 it('never passes raw database errors through and keeps authority refusals 403',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{code:'XX000',message:'relation "settlements" does not exist'}});
  const response=await POST(request({operation:'run'}));expect(response.status).toBe(502);expect(JSON.stringify(await response.json())).not.toContain('relation');
  mocks.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'not_authorized'}});expect((await POST(request({operation:'run'}))).status).toBe(403);});
});
