import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn(),access:vi.fn(),rpc:vi.fn()}));
vi.mock('../../../../lib/supabase/server',()=>({createSupabaseServerClient:mocks.create}));
vi.mock('../../../../lib/auth/cafeteria-access',()=>({resolveCafeteriaAccess:mocks.access}));
import {POST} from './route';
const id='5c100000-0000-4000-8000-000000000001';
function req(b:unknown,origin='http://localhost'){return new Request('http://localhost/api/cafeteria/refund-limits',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(b)});}
beforeEach(()=>{vi.resetAllMocks();mocks.create.mockResolvedValue({rpc:mocks.rpc});mocks.access.mockResolvedValue({status:'authorized',context:{cafeterias:[{cafeteria_id:id}]}});mocks.rpc.mockResolvedValue({data:{cafeteria_id:id,version:2,count_limit:3,amount_limit_minor:'20000'},error:null});});
describe('cashier refund limits boundary',()=>{
 it('configures exact count and minor-unit amount',async()=>{expect((await POST(req({operation:'configure',cafeteria_id:id,expected_version:1,count_limit:3,amount_limit_minor:'20000'}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('configure_cashier_refund_limits',{p_cafeteria_id:id,p_expected_version:1,p_count_limit:3,p_amount_limit_minor:'20000'});});
 it.each([{count_limit:-1},{count_limit:1.5},{amount_limit_minor:'1.5'},{amount_limit_minor:'-1'}])('rejects invalid limits %j',async x=>{expect((await POST(req({operation:'configure',cafeteria_id:id,expected_version:1,count_limit:3,amount_limit_minor:'1',...x}))).status).toBe(400);});
 it('denies other cafeteria, POV and cross-origin',async()=>{expect((await POST(req({operation:'read',cafeteria_id:'5c100000-0000-4000-8000-000000000002'}))).status).toBe(403);mocks.access.mockResolvedValue({status:'authorized',context:{cafeterias:[{cafeteria_id:id}],pov:{}}});expect((await POST(req({operation:'read',cafeteria_id:id}))).status).toBe(403);expect((await POST(req({operation:'read',cafeteria_id:id},'https://x.invalid'))).status).toBe(403);});
 it('maps cashier denial and version conflict',async()=>{mocks.rpc.mockResolvedValue({error:{code:'42501',message:'REFUND_NOT_AUTHORIZED'}});expect((await POST(req({operation:'read',cafeteria_id:id}))).status).toBe(403);mocks.rpc.mockResolvedValue({error:{code:'40001',message:'POLICY_VERSION_CONFLICT'}});expect((await POST(req({operation:'configure',cafeteria_id:id,expected_version:1,count_limit:1,amount_limit_minor:'1'}))).status).toBe(409);});
});
