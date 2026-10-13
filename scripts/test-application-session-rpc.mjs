// LOCAL ONLY: direct RPC timeout enforcement, independent of the Next/browser controller.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
const root=process.cwd(),docker='/Applications/Docker.app/Contents/Resources/bin/docker';
assert.equal(execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],{encoding:'utf8'}).trim(),'pikas-4d6');
const config=JSON.parse(execFileSync(resolve(root,'node_modules/.bin/supabase'),['--workdir','/private/tmp/pikas-4d6-local','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(config.API_URL,'http://127.0.0.1:55641');
const sql=q=>execFileSync(docker,['exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
const client=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
assert.equal((await client.auth.signInWithPassword({email:'browser-edwin-4d6@example.invalid',password:'Local-4D6-fictional-only-938!'})).error,null);
assert.equal((await client.rpc('platform_get_active_sandbox_pov')).error?.message,'application_session_expired');
const start=await client.rpc('pikas_session_start');assert.equal(start.error,null);const sid=start.data.session_id;
assert.equal((await client.auth.refreshSession()).error,null);
const after=await client.rpc('pikas_session_status');assert.equal(after.error,null);
for(const key of ['session_id','started_at','last_active_at','absolute_deadline'])assert.equal(after.data[key],start.data[key],key+' changed during token refresh');
const paths=['get_pos_access_context','list_my_operable_registers','get_my_open_register_session','get_pos_register_session','open_register_session','close_my_register_session','checkout_purchase','get_pos_customer_purchase_context','cafeteria_customer_projection','get_cafeteria_saleable_catalog','exceptionally_close_register_session','create_purchase_refund','create_purchase_refund_approval','get_purchase_refundability','revoke_financial_approval','claim_purchase_receipt_print_job','report_receipt_print_job','retry_receipt_print_job','request_purchase_receipt_reprint','get_staff_credit_pos_projection','settle_staff_receivable'];
try{
 sql(`update pikas_private.application_sessions set started_at=clock_timestamp()-interval '1 hour',last_active_at=clock_timestamp()-interval '16 minutes' where session_id='${sid}';`);
 assert.equal((await client.rpc('platform_get_active_sandbox_pov')).error,null,'30m admin session remains valid without POS registration');
 for(const name of paths){
  const args=JSON.parse(sql(`select coalesce(json_object_agg(name,typ),'{}'::json) from (select unnest(proargnames) name,unnest(proargtypes::oid[])::regtype::text typ from pg_proc where pronamespace='public'::regnamespace and proname='${name}') a where typ is not null;`));
  const payload=Object.fromEntries(Object.entries(args).map(([name,type])=>[name,type==='uuid'?'7f000000-0000-4000-8000-000000000099':type==='jsonb'?{}:type==='boolean'?false:['integer','bigint','numeric'].includes(type)?0:'local-timeout-fixture']));
  const response=await client.rpc(name,payload);assert.equal(response.error?.code,'42501',name+JSON.stringify(response.error));assert.equal(response.error.message,'application_session_expired',name);
 }
 console.log('PASS 21/21 dedicated POS RPCs reject at 15m even without controller/POS-policy registration.');
 console.log('PASS token refresh preserves application session_id, activity, start and absolute deadline.');
 sql(`update pikas_private.application_sessions set last_active_at=clock_timestamp() where session_id='${sid}';`);
 for(const [code,contextRpc] of [['school_admin','get_school_admin_context'],['cafeteria_admin','get_cafeteria_admin_context']]){
  const entered=await client.rpc('platform_enter_sandbox_pov',{p_request_id:randomUUID(),p_account_id:'03e71159-69e9-4387-9b3b-65799d49faf0',p_cafeteria_id:'b9496342-5079-46ae-83b8-05c39bcbd7fe',p_pov_code:code});assert.equal(entered.error,null);
  const before=await client.rpc('platform_get_active_sandbox_pov');assert.equal(before.error,null);
  const newClient=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  assert.equal((await newClient.auth.signInWithPassword({email:'browser-edwin-4d6@example.invalid',password:'Local-4D6-fictional-only-938!'})).error,null);
  const reauthenticated=await newClient.rpc('pikas_session_start');assert.equal(reauthenticated.error,null);assert.notEqual(reauthenticated.data.session_id,sid);
  const resumed=await newClient.rpc(contextRpc);assert.equal(resumed.error,null);assert.equal(resumed.data.pov.session_id,before.data.session_id);assert.equal(resumed.data.pov.pov_code,code);
  assert.equal(reauthenticated.data.user_id,start.data.user_id);assert.equal((await newClient.auth.getUser()).data.user.id,start.data.user_id);
  assert.equal((await newClient.rpc('pikas_session_end',{p_expected_session_id:reauthenticated.data.session_id})).error,null);assert.equal((await newClient.auth.signOut({scope:'local'})).error,null);
 }
 assert.equal(sql("select count(*) from public.cafeteria_memberships where person_id='4d6b0000-0000-4000-8000-000000000001'"),'0');
 console.log('PASS School/Cafeteria reauthentication: exact existing POV revalidated, real Auth user retained, no operator tenant membership.');
}finally{assert.equal((await client.rpc('pikas_session_end',{p_expected_session_id:sid})).error,null);assert.equal((await client.auth.signOut({scope:'local'})).error,null);}
