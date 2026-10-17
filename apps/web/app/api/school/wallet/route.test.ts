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
const reverse={operation:'reverse',school_id:id,student_id:id,replenishment_id:id,reason:'wrong_amount',note:'',request_key:id};
describe('replenishment reversal boundary',()=>{
 it('forwards the exact reversal and returns the authoritative negative balance',async()=>{mocks.rpc.mockResolvedValue({data:{request_key:id,school_id:id,student_id:id,reversal_id:id,replenishment_id:id,amount_minor:'10000',balance_after_minor:'-7500',reason:'wrong_amount',reversed_at:'t'},error:null});const r=await POST(req(reverse));expect(r.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('school_wallet_reverse_replenishment',{p_school_id:id,p_student_id:id,p_replenishment_id:id,p_reason:'wrong_amount',p_note:null,p_request_key:id});expect((await r.json()).result.balance_after_minor).toBe('-7500');});
 it.each([{reason:'other',note:''},{reason:'refund'},{amount_minor:'1'},{reason:''}])('rejects invalid reversal %j',async x=>{expect((await POST(req({...reverse,...x}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('requires matching request header',async()=>{expect((await POST(req(reverse,'http://localhost','other'))).status).toBe(400);});
 it('reports an already reversed replenishment as a definite conflict',async()=>{mocks.rpc.mockResolvedValue({error:{code:'23514',message:'REPLENISHMENT_ALREADY_REVERSED'}});expect((await POST(req(reverse))).status).toBe(409);});
 it('denies sandbox POV and other schools',async()=>{mocks.access.mockResolvedValue({status:'authorized',context:{schools:[{school_id:id}],pov:{}}});expect((await POST(req(reverse))).status).toBe(403);mocks.access.mockResolvedValue({status:'authorized',context:{schools:[{school_id:'5bf00000-0000-4000-8000-000000000002'}]}});expect((await POST(req(reverse))).status).toBe(403);});
 it('treats a result for another replenishment as uncertain',async()=>{mocks.rpc.mockResolvedValue({data:{request_key:id,school_id:id,student_id:id,reversal_id:id,replenishment_id:'5bf00000-0000-4000-8000-000000000002',amount_minor:'1',balance_after_minor:'0',reason:'wrong_amount',reversed_at:'t'},error:null});expect((await POST(req(reverse))).status).toBe(502);});
});
const adjust={operation:'adjust',school_id:id,student_id:id,amount_minor:'-7500',reason:'authorized_debit',explanation:'Débito documentado',request_key:id};
const adjusted={request_key:id,adjustment_id:id,student_id:id,amount_minor:'-7500',balance_before_minor:'5000',balance_after_minor:'-2500',reason:'authorized_debit',actor_role:'school_admin',posted_at:'t',school_id:id};
describe('administrative adjustment boundary',()=>{
 it('forwards the exact signed amount, reason and explanation',async()=>{mocks.rpc.mockResolvedValue({data:adjusted,error:null});const r=await POST(req(adjust));expect(r.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('school_wallet_adjust',{p_school_id:id,p_student_id:id,p_amount_minor:'-7500',p_reason:'authorized_debit',p_explanation:'Débito documentado',p_request_key:id});});
 it.each([{explanation:''},{explanation:'abc'},{reason:''},{amount_minor:'0'},{amount_minor:'1.5'},{reason:'authorized_credit'},{reason:'duplicate_manual_credit_correction'},{balance_minor:'1'}])('rejects invalid adjustment %j',async x=>{expect((await POST(req({...adjust,...x}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('requires matching request header',async()=>{expect((await POST(req(adjust,'http://localhost','other'))).status).toBe(400);});
 it('treats a result with another amount as uncertain',async()=>{mocks.rpc.mockResolvedValue({data:{...adjusted,amount_minor:'-1'},error:null});expect((await POST(req(adjust))).status).toBe(502);});
 it('denies sandbox POV',async()=>{mocks.access.mockResolvedValue({status:'authorized',context:{schools:[{school_id:id}],pov:{}}});expect((await POST(req(adjust))).status).toBe(403);});
});
