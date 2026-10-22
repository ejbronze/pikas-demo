import { NextRequest } from 'next/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),create:vi.fn(),identity:vi.fn()}));
vi.mock('@/lib/auth/pikas-context',()=>({resolvePikasIdentity:mocks.identity}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:mocks.create}));
import { POST } from './route';
const id='4d400000-0000-4000-8000-000000000001';
const command={operation:'prepare',payload:{name:'Internal operator',email:'operator@example.invalid',demo:true}};
function request(body:unknown=command,origin='http://localhost:3000'){return new NextRequest('http://localhost:3000/api/platform/team',{method:'POST',headers:{origin,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();mocks.create.mockResolvedValue({rpc:mocks.rpc});mocks.identity.mockResolvedValue({status:'ready',platform:{capabilities:['platform:team:manage']}});});
describe('team API authority',()=>{
 it.each(['authUserId','personId','actor','role','accountId'])('rejects supplied %s',async field=>{expect((await POST(request({...command,payload:{...command.payload,[field]:id}}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('rejects cross origin',async()=>{expect((await POST(request(command,'https://untrusted.invalid'))).status).toBe(403);});
 it.each([null,{capabilities:[]},{capabilities:['platform:sandbox:pov:enter']},{capabilities:['platform:customer_admin:provision']}])('rejects insufficient authority %j',async platform=>{mocks.identity.mockResolvedValue({status:'ready',platform});expect((await POST(request())).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('rejects unauthenticated users',async()=>{mocks.identity.mockResolvedValue({status:'unauthenticated'});expect((await POST(request())).status).toBe(401);});
 it('passes only validated command and request key',async()=>{mocks.rpc.mockResolvedValue({data:{request_id:id,operation:'prepare',status:'confirmed'},error:null});expect((await POST(request())).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('platform_team_command',{p_request_id:id,p_operation:'prepare',p_payload:command.payload});});
 it.each(['42501','23514','23505'])('does not claim success on %s',async code=>{mocks.rpc.mockResolvedValue({data:null,error:{code}});expect((await POST(request())).status).not.toBe(200);});
 it('rejects security identifiers in the result',async()=>{mocks.rpc.mockResolvedValue({data:{request_id:id,operation:'prepare',status:'confirmed',person_id:id},error:null});expect((await POST(request())).status).toBe(502);});
});
describe('UX 11: real Platform mutations during a current Demo (shared RPC handler)',()=>{
 const active=(expires='2030-01-01T00:00:00Z')=>({session_id:id,account_id:id,account_name:'Colegio Horizonte',school_id:id,cafeteria_id:id,cafeteria_name:'Cafetería Escolar',pov_code:'cafeteria_admin',persona_display_name:'Marta Demo',expires_at:expires});
 const withDemo=(pov:unknown)=>{mocks.identity.mockResolvedValue({status:'ready',platform:{capabilities:['platform:team:manage','platform:sandbox:pov:enter']}});mocks.rpc.mockImplementation(async(name:string)=>name==='platform_get_active_sandbox_pov'?{data:pov,error:null}:{data:{request_id:id,operation:'prepare',status:'confirmed'},error:null});};
 it('2/6. current POV: the stale-tab command is refused and the mutation RPC never runs',async()=>{withDemo(active());const response=await POST(request());expect(response.status).toBe(403);expect((await response.json()).error).toBe('demo_mode_active');expect(mocks.rpc).not.toHaveBeenCalledWith('platform_team_command',expect.anything());});
 it('1/4. no current POV (none or exited): the same command succeeds',async()=>{withDemo(null);expect((await POST(request())).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('platform_team_command',expect.anything());});
 it('3. expired POV: the command works normally',async()=>{withDemo(active('2020-01-01T00:00:00Z'));expect((await POST(request())).status).toBe(200);});
 it('an operator without Demo access never consults the Demo state',async()=>{mocks.rpc.mockResolvedValue({data:{request_id:id,operation:'prepare',status:'confirmed'},error:null});expect((await POST(request())).status).toBe(200);expect(mocks.rpc).not.toHaveBeenCalledWith('platform_get_active_sandbox_pov');});
 it('unknown Demo state fails closed',async()=>{mocks.identity.mockResolvedValue({status:'ready',platform:{capabilities:['platform:team:manage','platform:sandbox:pov:enter']}});mocks.rpc.mockImplementation(async(name:string)=>name==='platform_get_active_sandbox_pov'?{data:null,error:{code:'XX000'}}:{data:{},error:null});expect((await POST(request())).status).toBe(503);expect(mocks.rpc).not.toHaveBeenCalledWith('platform_team_command',expect.anything());});
});
