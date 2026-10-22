import { NextRequest } from 'next/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),create:vi.fn(),identity:vi.fn()}));
vi.mock('@/lib/auth/pikas-context',()=>({resolvePikasIdentity:mocks.identity}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:mocks.create}));
import { POST as decide } from './decision/route';
import { POST as reverse } from './reversal/route';
const key='f3000000-0000-4000-8000-000000000001';
const approve={reference:'REC-00000001',decision:'approve'};
const reversal={reference:'REC-00000003',reason:'wrong_amount',note:''};
const caps=(...c:string[])=>mocks.identity.mockResolvedValue({status:'ready',platform:{capabilities:c}});
function request(path:string,body:unknown,origin='http://localhost:3000'){return new NextRequest(`http://localhost:3000/api/platform/finance/${path}`,{method:'POST',headers:{origin,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});}
const result={reference:'REC-00000001',state:'posted',method:'bank_transfer',gross_minor:'200000',fee_minor:'6000',net_minor:'194000',fee_bps:300,wallet_replenishment_id:key,rejection_reason:null,balance_after_minor:'194000'};
beforeEach(()=>{vi.clearAllMocks();mocks.create.mockResolvedValue({rpc:mocks.rpc});caps('platform:finance:read','platform:finance:replenishments:verify','platform:finance:replenishments:reverse');});
describe('finance decision API',()=>{
 it('verifies with the request key as the FIN 2 decision key and returns no internal identifiers',async()=>{
  mocks.rpc.mockResolvedValue({data:result,error:null});const response=await decide(request('decision',approve));const body=await response.json();
  expect(response.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('platform_finance_decide_bank_replenishment',{p_reference:'REC-00000001',p_decision:'approve',p_rejection_reason:null,p_decision_key:key});
  expect(body.result).toEqual({reference:'REC-00000001',state:'posted',gross_minor:'200000',fee_minor:'6000',net_minor:'194000'});expect(JSON.stringify(body)).not.toContain(key);
 });
 it('passes a rejection reason',async()=>{mocks.rpc.mockResolvedValue({data:{...result,state:'rejected'},error:null});await decide(request('decision',{reference:'REC-00000002',decision:'reject',reason:'Monto no coincide'}));
  expect(mocks.rpc).toHaveBeenCalledWith('platform_finance_decide_bank_replenishment',expect.objectContaining({p_decision:'reject',p_rejection_reason:'Monto no coincide'}));});
 it.each([{reference:'REC-1',decision:'approve'},{reference:'REC-00000002',decision:'reject'},{reference:'REC-00000002',decision:'reject',reason:'no'},{...approve,account_id:key},{reference:'REC-00000001',decision:'post'}])
  ('refuses malformed command %j before the database',async body=>{expect((await decide(request('decision',body))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it.each([[['platform:finance:read']],[['platform:finance:replenishments:reverse']],[['platform:tenant:lifecycle:read','platform:team:manage']],[[]]])('requires the verify capability (%j)',async c=>{
  caps(...c);expect((await decide(request('decision',approve))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('refuses cross-origin and signed-out requests',async()=>{expect((await decide(request('decision',approve,'https://untrusted.invalid'))).status).toBe(403);
  mocks.identity.mockResolvedValue({status:'unauthenticated'});expect((await decide(request('decision',approve))).status).toBe(401);});
 it.each(['REQUEST_ALREADY_DECIDED','IDEMPOTENCY_CONFLICT','FINANCIAL_POLICY_NOT_ACTIVE','wallet_not_active'])('names the business refusal %s',async message=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:message==='IDEMPOTENCY_CONFLICT'?'23505':'23514',message}});const response=await decide(request('decision',approve));
  expect(response.status).toBe(422);expect((await response.json()).error).toBe(message);});
 it('never passes raw database errors through',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{code:'XX000',message:'relation "x" does not exist'}});const response=await decide(request('decision',approve));
  expect(response.status).toBe(502);expect(JSON.stringify(await response.json())).not.toContain('relation');});
 it('database authority refusal stays a 403',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'finance_authority_required'}});expect((await decide(request('decision',approve))).status).toBe(403);});
});
describe('finance reversal API',()=>{
 it('reverses with the request key',async()=>{mocks.rpc.mockResolvedValue({data:{reference:'REC-00000003',state:'reversed',gross_minor:'100000',fee_minor:'3000',net_minor:'97000',reason:'wrong_amount',reversed_at:'2026-10-22T15:00:00Z'},error:null});
  const response=await reverse(request('reversal',reversal));expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith('platform_finance_reverse_replenishment',{p_reference:'REC-00000003',p_reason:'wrong_amount',p_note:null,p_request_key:key});});
 it('requires the reverse capability, not verify',async()=>{caps('platform:finance:read','platform:finance:replenishments:verify');expect((await reverse(request('reversal',reversal))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('other needs an explanation',async()=>{expect((await reverse(request('reversal',{...reversal,reason:'other',note:''}))).status).toBe(400);});
 it.each(['FINANCIAL_RESOLUTION_REQUIRED','REPLENISHMENT_ALREADY_REVERSED'])('names %s',async message=>{mocks.rpc.mockResolvedValue({data:null,error:{code:'23514',message}});
  const response=await reverse(request('reversal',reversal));expect(response.status).toBe(422);expect((await response.json()).error).toBe(message);});
});
