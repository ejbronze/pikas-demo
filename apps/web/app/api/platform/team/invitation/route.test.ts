import {NextRequest} from 'next/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),providerRpc:vi.fn(),create:vi.fn(),get:vi.fn(),generate:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('../../../../../lib/supabase/server',()=>({createSupabaseServerClient:async()=>({rpc:mocks.rpc})}));
vi.mock('../../../../../lib/auth/activation',async original=>({...await original<typeof import('../../../../../lib/auth/activation')>(),activationOrigin:()=> 'https://pikas.example',invitationProvider:()=>({rpc:mocks.providerRpc,auth:{admin:{createUser:mocks.create,getUserById:mocks.get,generateLink:mocks.generate}}})}));
import {POST} from './route';
const id='4d500000-0000-4000-8000-000000000002',marker='d'.repeat(64);
const context={email:'recipient@example.invalid',owner_key:marker,auth_id:id,ready:false};
function request(body:unknown={handle:'a'.repeat(32)}){return new NextRequest('https://pikas.example/api/platform/team/invitation',{method:'POST',headers:{origin:'https://pikas.example'},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();mocks.rpc.mockResolvedValue({data:{handle:'b'.repeat(32),email:context.email},error:null});mocks.providerRpc.mockResolvedValue({data:context,error:null});mocks.get.mockResolvedValue({data:{user:{id,email:context.email,app_metadata:{pikas_activation_owner:marker}}},error:null});mocks.create.mockResolvedValue({data:{user:{id}},error:null});});
describe('owned-identity invitation issuance',()=>{
 it('binds an independent 256-bit credential and exposes no native token or UUID',async()=>{const response=await POST(request());expect(response.status).toBe(200);const result=await response.json();expect(result.link).toMatch(/^https:\/\/pikas.example\/activar#token=[0-9a-f]{64}$/);expect(result.delivery).toBe('link_only');expect(JSON.stringify(result)).not.toContain(id);expect(mocks.generate).not.toHaveBeenCalled();expect(mocks.rpc.mock.calls[1][1].p_digest).not.toBe(result.link.split('=')[1]);});
 it('denies insufficient authority before any privileged provider operation',async()=>{mocks.rpc.mockResolvedValue({error:{code:'42501'}});expect((await POST(request())).status).toBe(403);expect(mocks.providerRpc).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();});
 it('rejects browser email, UUID and source substitution',async()=>{for(const field of ['email','authUserId','source_kind'])expect((await POST(request({handle:'a'.repeat(32),[field]:'arbitrary'}))).status).toBe(400);expect(mocks.providerRpc).not.toHaveBeenCalled();});
 it.each(['unconfirmed','confirmed','linked'])('rejects unrelated %s identity before generateLink',async()=>{mocks.providerRpc.mockResolvedValue({error:{code:'42501'}});expect((await POST(request())).status).toBe(409);expect(mocks.create).not.toHaveBeenCalled();expect(mocks.generate).not.toHaveBeenCalled();});
 it('creates a passwordless identity with server-controlled provenance only when absent',async()=>{mocks.providerRpc.mockResolvedValueOnce({data:{...context,auth_id:null},error:null});expect((await POST(request())).status).toBe(200);expect(mocks.create).toHaveBeenCalledWith({email:context.email,email_confirm:false,app_metadata:{pikas_activation_owner:marker}});});
 it('fails closed on createUser conflict rather than inviting the conflicting identity',async()=>{mocks.providerRpc.mockResolvedValueOnce({data:{...context,auth_id:null},error:null});mocks.create.mockResolvedValue({error:{code:'email_exists'}});expect((await POST(request())).status).toBe(409);expect(mocks.generate).not.toHaveBeenCalled();});
 it('reissues the same owned identity without creating another user',async()=>{expect((await POST(request())).status).toBe(200);expect((await POST(request())).status).toBe(200);expect(mocks.create).not.toHaveBeenCalled();expect(mocks.get).toHaveBeenCalledWith(id);});
 it('rejects provider metadata mismatch',async()=>{mocks.get.mockResolvedValue({data:{user:{id,email:context.email,app_metadata:{}}},error:null});expect((await POST(request())).status).toBe(503);expect(mocks.generate).not.toHaveBeenCalled();});
 it('does not return a link after failed binding',async()=>{mocks.rpc.mockResolvedValueOnce({data:{handle:'b'.repeat(32),email:context.email}}).mockResolvedValueOnce({error:{code:'42501'}});expect((await POST(request())).status).toBe(409);});
});
