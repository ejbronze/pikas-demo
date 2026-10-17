import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn(),access:vi.fn(),rpc:vi.fn()}));
vi.mock('../../../../lib/supabase/server',()=>({createSupabaseServerClient:mocks.create}));
vi.mock('../../../../lib/auth/cafeteria-access',()=>({resolveCafeteriaAccess:mocks.access}));
import {POST} from './route';
const id='5bf00000-0000-4000-8000-000000000001';
const body={cafeteria_id:id,query:'sol'};
function req(b:unknown=body,origin='http://localhost'){return new Request('http://localhost/api/cafeteria/wallet',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(b)});}
beforeEach(()=>{vi.resetAllMocks();mocks.create.mockResolvedValue({rpc:mocks.rpc});mocks.access.mockResolvedValue({status:'authorized',context:{cafeterias:[{cafeteria_id:id}]}});mocks.rpc.mockResolvedValue({data:{cafeteria_id:id,students:[{student_id:id,display_name:'Sol Ficticia',wallet_status:'active',balance_minor:'2500'}]},error:null});});
describe('cafeteria wallet read boundary',()=>{
 it('reads scoped balances with no-store',async()=>{const r=await POST(req());expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(mocks.rpc).toHaveBeenCalledWith('cafeteria_wallet_read',{p_cafeteria_id:id,p_query:'sol'});});
 it.each([['unauthenticated',401],['forbidden',403],['unavailable',503]])('denies %s',async(status,code)=>{mocks.access.mockResolvedValue({status});expect((await POST(req())).status).toBe(code);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('denies sandbox POV',async()=>{mocks.access.mockResolvedValue({status:'authorized',context:{cafeterias:[{cafeteria_id:id}],pov:{}}});expect((await POST(req())).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('denies another cafeteria',async()=>{expect((await POST(req({...body,cafeteria_id:'5bf00000-0000-4000-8000-000000000002'}))).status).toBe(403);});
 it('denies cross-origin before auth',async()=>{expect((await POST(req(body,'https://other.invalid'))).status).toBe(403);expect(mocks.create).not.toHaveBeenCalled();});
 it.each([{amount_minor:'100'},{operation:'replenish'},{student_id:id}])('accepts no mutation fields %j',async x=>{expect((await POST(req({...body,...x}))).status).toBe(400);});
 it('maps database denial without detail',async()=>{mocks.rpc.mockResolvedValue({error:{code:'42501',message:'private-details'}});const r=await POST(req());expect(r.status).toBe(403);expect(await r.text()).not.toContain('private-details');});
 it('rejects results carrying history or another cafeteria',async()=>{mocks.rpc.mockResolvedValue({data:{cafeteria_id:id,students:[{student_id:id,display_name:'Sol',wallet_status:'active',balance_minor:'1',reference:'x'}]},error:null});expect((await POST(req())).status).toBe(502);mocks.rpc.mockResolvedValue({data:{cafeteria_id:'5bf00000-0000-4000-8000-000000000002',students:[]},error:null});expect((await POST(req())).status).toBe(502);});
});
describe('cafeteria scoped adjustment',()=>{
 const adjust={operation:'adjust',cafeteria_id:id,student_id:id,amount_minor:'2500',reason:'administrative_correction',explanation:'Corrección documentada',request_key:id};
 const reqA=(b:unknown,key=id)=>new Request('http://localhost/api/cafeteria/wallet',{method:'POST',headers:{origin:'http://localhost','Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(b)});
 it('forwards to the scoped RPC and validates the result',async()=>{mocks.rpc.mockResolvedValue({data:{request_key:id,adjustment_id:id,student_id:id,amount_minor:'2500',balance_before_minor:'0',balance_after_minor:'2500',reason:'administrative_correction',actor_role:'cafeteria_admin',posted_at:'t',cafeteria_id:id},error:null});
  expect((await POST(reqA(adjust))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('cafeteria_wallet_adjust',{p_cafeteria_id:id,p_student_id:id,p_amount_minor:'2500',p_reason:'administrative_correction',p_explanation:'Corrección documentada',p_request_key:id});});
 it('maps scope denial and requires key/explanation',async()=>{mocks.rpc.mockResolvedValue({error:{code:'42501',message:'cafeteria_authority_required'}});expect((await POST(reqA(adjust))).status).toBe(403);expect((await POST(reqA(adjust,'5bf00000-0000-4000-8000-000000000009'))).status).toBe(400);expect((await POST(reqA({...adjust,explanation:''}))).status).toBe(400);});
});
