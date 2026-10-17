import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn(),access:vi.fn(),rpc:vi.fn()}));
vi.mock('../../../../lib/supabase/server',()=>({createSupabaseServerClient:mocks.create}));
vi.mock('../../../../lib/auth/school-access',()=>({resolveSchoolAccess:mocks.access}));
import {POST} from './route';
const id='5b000000-0000-4000-8000-000000000001';
const read={operation:'read',school_id:id,student_id:id,before:null};
const credit={operation:'replenish',school_id:id,student_id:id,amount_minor:'2500',reference:'Verificado',note:'',request_key:id};
function req(body:unknown=read,origin='http://localhost',key=id){return new Request('http://localhost/api/school/wallet',{method:'POST',headers:{origin,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});}
beforeEach(()=>{vi.resetAllMocks();mocks.create.mockResolvedValue({rpc:mocks.rpc});mocks.access.mockResolvedValue({status:'authorized',context:{schools:[{school_id:id}]}});mocks.rpc.mockResolvedValue({data:{school_id:id,student_id:id,student_name:'Estudiante ficticio',wallet:null,movements:[],next_before:null},error:null});});
describe('school wallet boundary',()=>{
 it('uses no-store and server-derived scope',async()=>{const r=await POST(req());expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(mocks.rpc).toHaveBeenCalledWith('school_wallet_read',{p_school_id:id,p_student_id:id,p_before:null});});
 it.each([['unauthenticated',401],['forbidden',403],['unavailable',503]])('denies %s',async(status,code)=>{mocks.access.mockResolvedValue({status});expect((await POST(req())).status).toBe(code);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('denies financial admin POV',async()=>{mocks.access.mockResolvedValue({status:'authorized',context:{schools:[{school_id:id}],pov:{}}});expect((await POST(req())).status).toBe(403);});
 it('denies other school',async()=>{expect((await POST(req({...read,school_id:'5b000000-0000-4000-8000-000000000002'}))).status).toBe(403);});
 it('denies cross-origin before auth',async()=>{expect((await POST(req(read,'https://other.invalid'))).status).toBe(403);expect(mocks.create).not.toHaveBeenCalled();});
 it.each([{actor:id},{balance_minor:'2500'},{wallet_id:id}])('rejects client authority/result %j',async x=>{expect((await POST(req({...credit,...x}))).status).toBe(400);});
 it('requires matching request header',async()=>{expect((await POST(req(credit,'http://localhost','other'))).status).toBe(400);});
 it('forwards exact minor units and evidence',async()=>{mocks.rpc.mockResolvedValue({data:{...credit,wallet_id:id,replenishment_id:id,balance_after_minor:'2500',version:'1'},error:null});expect((await POST(req(credit))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('school_wallet_replenish',{p_school_id:id,p_student_id:id,p_amount_minor:'2500',p_request_key:id,p_reference:'Verificado',p_note:''});});
 it('malformed success remains uncertain',async()=>{mocks.rpc.mockResolvedValue({data:{},error:null});expect((await POST(req(credit))).status).toBe(502);});
 it.each([['42501',403],['23514',422],['22003',422],['XX000',502],['23505',502]])('maps %s safely',async(code,status)=>{mocks.rpc.mockResolvedValue({error:{code,message:'private-details'}});const r=await POST(req(credit));expect(r.status).toBe(status);expect(await r.text()).not.toContain('private-details');});
});
