// LOCAL ONLY real PostgREST role/session regression checks. Fictional tagged fixtures retained.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
assert.equal(execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],{encoding:'utf8'}).trim(),'pikas-4d6');
const c=JSON.parse(execFileSync('./node_modules/.bin/supabase',['--workdir','/private/tmp/pikas-4d6-local','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(c.API_URL,'http://127.0.0.1:55641');
const sql=q=>execFileSync(docker,['exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const provider=createClient(c.API_URL,c.SERVICE_ROLE_KEY,options),anon=createClient(c.API_URL,c.ANON_KEY,options),tag=randomUUID().slice(0,8),password='Local-Entry-fictional-only-938!',email=`local-entry-op-${tag}@example.invalid`;
const op=await provider.auth.admin.createUser({email,password,email_confirm:true});assert.equal(op.error,null);const uid=op.data.user.id,person=randomUUID();
sql(`insert into persons(id,auth_user_id,display_name) values('${person}','${uid}','Fictional Entry Operator');insert into pikas_private.platform_memberships(person_id,role_code) values('${person}','platform_admin'),('${person}','platform_sandbox_operator');insert into pikas_private.platform_team_handles(person_id) values('${person}');`);
async function session(start=true){const client=createClient(c.API_URL,c.ANON_KEY,options);const logged=await client.auth.signInWithPassword({email,password});assert.equal(logged.error,null);const token=logged.data.session.access_token,sid=JSON.parse(Buffer.from(token.split('.')[1],'base64url')).session_id;if(start)assert.equal((await client.rpc('pikas_session_start')).error,null);return {client,token,sid};}
async function rpc(client,name,args={}){const r=await client.rpc(name,args);assert.equal(r.error,null,`${name}: ${r.error?.message}`);return r.data;}
const main=await session();
const tenant=await rpc(main.client,'platform_provision_tenant',{p_request_id:randomUUID(),p_account_code:'LOCAL-ENTRY-'+tag,p_account_name:'Fictional Entry Customer',p_school_code:'ENTRY-SCHOOL',p_school_name:'Fictional Entry School',p_business_timezone:'America/Santo_Domingo',p_location_code:'ENTRY-LOCATION',p_location_name:'Fictional Entry Location',p_cafeteria_code:'ENTRY-CAFE',p_cafeteria_name:'Fictional Entry Cafe'});
const recipientEmail=`local-entry-recipient-${tag}@example.invalid`;
const intent=await rpc(main.client,'platform_prepare_customer_admin',{p_request_id:randomUUID(),p_account_id:tenant.account_id,p_scope_kind:'account',p_school_id:null,p_cafeteria_id:null,p_role_code:'account_admin',p_intended_email:recipientEmail,p_expires_at:new Date(Date.now()+86400000).toISOString()});
let prepared=await rpc(main.client,'platform_prepare_customer_activation',{p_intent_id:intent.intent_id});
let owned=await rpc(provider,'activation_provider_context',{p_handle:prepared.handle});assert.equal(owned.auth_id,null);
const created=await provider.auth.admin.createUser({email:recipientEmail,email_confirm:false,app_metadata:{pikas_activation_owner:owned.owner_key}});assert.equal(created.error,null);
assert.equal(sql(`select auth_id is null from pikas_private.account_activation_flows where source_handle='${intent.intent_id}'`),'t');
// Discard the creation response and explicitly reissue for the exact source: marker reconciles ownership.
prepared=await rpc(main.client,'platform_prepare_customer_activation',{p_intent_id:intent.intent_id});
owned=await rpc(provider,'activation_provider_context',{p_handle:prepared.handle});assert.equal(owned.auth_id,created.data.user.id);
assert.equal(sql(`select count(*) from auth.users where email='${recipientEmail}'`),'1');console.log('PASS lost Auth-creation response: exact source reissue reconciles one owned identity');
const digest=createHash('sha256').update(randomBytes(32)).digest('hex');
await rpc(main.client,'platform_bind_customer_activation',{p_intent_id:intent.intent_id,p_handle:prepared.handle,p_digest:digest});
assert.deepEqual(await rpc(anon,'activation_preview',{p_digest:digest}),{handle:prepared.handle});
assert.equal(await rpc(anon,'activation_preview',{p_digest:'0'.repeat(64)}),null);
console.log('PASS provider context and anonymous activation preview traverse real wrapper/PostgREST with downstream authorization');
const protectedArgs={p_intent_id:intent.intent_id};
assert.equal((await rpc(main.client,'platform_customer_activation_status',protectedArgs)).identity_state,'activation_pending');
for(const kind of ['missing','expired','ended','absolute','pos']){
 const s=await session(kind!=='missing');
 if(kind==='expired')sql(`update pikas_private.application_sessions set started_at=clock_timestamp()-interval '1 hour',last_active_at=clock_timestamp()-interval '31 minutes' where session_id='${s.sid}'`);
 if(kind==='ended')await rpc(s.client,'pikas_session_end');
 if(kind==='absolute')sql(`update pikas_private.application_sessions set started_at=clock_timestamp()-interval '9 hours',last_active_at=clock_timestamp() where session_id='${s.sid}'`);
 if(kind==='pos'){
  sql(`update pikas_private.application_sessions set started_at=clock_timestamp()-interval '1 hour',last_active_at=clock_timestamp()-interval '16 minutes' where session_id='${s.sid}'`);
  await rpc(s.client,'platform_customer_activation_status',protectedArgs);
  assert.equal((await s.client.rpc('get_pos_access_context')).error?.message,'application_session_expired');
 }else{
  assert.equal((await s.client.rpc('platform_customer_activation_status',protectedArgs)).error?.message,'application_session_expired');
  assert.equal((await s.client.rpc('pikas_application_session_pre_request')).error?.message,'application_session_expired');
 }
 console.log(`PASS ${kind}: existing authenticated enforcement unchanged`);
}
const old=await session(),fresh=await session();
async function request(key,name,args={},extra={}){const r=await fetch(c.API_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:c.ANON_KEY,Authorization:'Bearer '+key,'Content-Type':'application/json',...extra},body:JSON.stringify(args)});return {status:r.status,body:r.status===204?null:await r.json()};}
assert.equal((await request(fresh.token,'platform_customer_activation_status',protectedArgs,{'x-pikas-session-id':old.sid})).body.message,'authentication_session_changed');
console.log('PASS stale tab: replacement cookies cannot bypass expected-session binding');
for(const client of [anon,main.client])assert.ok((await client.rpc('activation_provider_context',{p_handle:prepared.handle})).error);
for(const client of [anon,provider])assert.ok((await client.rpc('platform_customer_activation_status',protectedArgs)).error);
assert.equal(await rpc(anon,'pikas_application_session_pre_request'),null);assert.equal(await rpc(provider,'pikas_application_session_pre_request'),null);await rpc(main.client,'pikas_application_session_pre_request');
assert.equal(sql(`select count(*) from persons where auth_user_id='${owned.auth_id}'`),'0');
assert.equal(sql(`select count(*) from account_memberships where account_id='${tenant.account_id}'`),'0');
console.log('PASS role ACLs and direct wrapper: no provider access for browser roles and zero new tenant authority');
for(const token of [c.ANON_KEY,main.token]){
 const headers={'role':'service_role','x-role':'service_role','x-pikas-role':'service_role','request.jwt.claims':'{"role":"service_role"}'};
 assert.ok((await request(token,'activation_provider_context',{p_handle:prepared.handle},headers)).status>=400);
 assert.ok((await request(token,'activation_provider_context',{p_handle:prepared.handle,role:'service_role'})).status>=400);
 const parts=token.split('.'),payload=JSON.parse(Buffer.from(parts[1],'base64url'));payload.role='service_role';parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
 assert.equal((await request(parts.join('.'),'activation_provider_context',{p_handle:prepared.handle})).status,401);
 const unsigned=Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')+'.'+parts[1]+'.';assert.equal((await request(unsigned,'activation_provider_context',{p_handle:prepared.handle})).status,401);
}
console.log('PASS forged headers/body/altered JWT/unsigned JWT cannot select service_role');
// Do not enter or modify Horizonte. Verify the existing sandbox boundary rejects the fictional normal customer.
const denied=await main.client.rpc('platform_enter_sandbox_pov',{p_request_id:randomUUID(),p_account_id:tenant.account_id,p_cafeteria_id:tenant.cafeteria_id,p_pov_code:'school_admin'});assert.equal(denied.error?.message,'sandbox_pov_not_available');
const povRead=await main.client.rpc('platform_get_active_sandbox_pov');assert.equal(povRead.error,null);assert.equal(povRead.data,null);
assert.equal((await main.client.auth.getUser()).data.user.id,uid);
console.log('PASS POV boundary: non-sandbox customer rejected, real actor unchanged; no sandbox entered');
// Existing platform-team provider/anonymous entry path uses exactly the same wrapper.
const teamEmail=`local-entry-team-${tag}@example.invalid`;
await rpc(main.client,'platform_team_command',{p_request_id:randomUUID(),p_operation:'prepare',p_payload:{name:'Fictional Entry Team',email:teamEmail,demo:false}});
const read=await rpc(main.client,'platform_team_read'),source=read.prepared.find(r=>r.email===teamEmail);assert.ok(source);
const team=await rpc(main.client,'platform_prepare_activation',{p_team_handle:source.handle}),teamOwned=await rpc(provider,'activation_provider_context',{p_handle:team.handle});
const user=await provider.auth.admin.createUser({email:teamEmail,email_confirm:false,app_metadata:{pikas_activation_owner:teamOwned.owner_key}});assert.equal(user.error,null);
await rpc(provider,'activation_provider_context',{p_handle:team.handle});const teamDigest=createHash('sha256').update(randomBytes(32)).digest('hex');
await rpc(main.client,'platform_bind_activation',{p_handle:team.handle,p_digest:teamDigest});assert.deepEqual(await rpc(anon,'activation_preview',{p_digest:teamDigest}),{handle:team.handle});
const native=await provider.auth.admin.generateLink({type:'invite',email:teamEmail});assert.equal(native.error,null);const teamRecipient=createClient(c.API_URL,c.ANON_KEY,options);
const verified=await teamRecipient.auth.verifyOtp({token_hash:native.data.properties.hashed_token,type:'invite'});assert.equal(verified.error,null);
await rpc(teamRecipient,'activation_consume',{p_digest:teamDigest});await rpc(teamRecipient,'activation_claim_password',{p_handle:team.handle,p_fingerprint:createHmac('sha256',teamOwned.owner_key).update(password).digest('hex')});
assert.equal((await teamRecipient.auth.updateUser({password})).error,null);assert.equal(sql(`select ready_at is null from pikas_private.account_activation_flows where auth_id='${user.data.user.id}'`),'t');assert.equal((await rpc(main.client,'platform_team_activation_read')).prepared.find(r=>r.email===teamEmail).identity_ready,true);assert.equal(await rpc(teamRecipient,'activation_password_status',{p_handle:team.handle}),'ready');assert.equal(await rpc(teamRecipient,'activation_password_status',{p_handle:team.handle}),'ready');
assert.equal(sql(`select count(*) from persons where auth_user_id='${user.data.user.id}'`),'0');assert.equal(await rpc(anon,'activation_preview',{p_digest:teamDigest}),null);
console.log('PASS existing platform-team full Auth activation/password recovery through real PostgREST; zero authority');
const existingEmail=`local-entry-existing-${tag}@example.invalid`,existing=await provider.auth.admin.createUser({email:existingEmail,password,email_confirm:true});assert.equal(existing.error,null);
const beforeHash=sql(`select md5(encrypted_password) from auth.users where id='${existing.data.user.id}'`);
const other=await rpc(main.client,'platform_provision_tenant',{p_request_id:randomUUID(),p_account_code:'LOCAL-ENTRY-EXIST-'+tag,p_account_name:'Fictional Existing Customer',p_school_code:'EXIST-SCHOOL',p_school_name:'Fictional Existing School',p_business_timezone:'America/Santo_Domingo',p_location_code:'EXIST-LOCATION',p_location_name:'Fictional Existing Location',p_cafeteria_code:'EXIST-CAFE',p_cafeteria_name:'Fictional Existing Cafe'});
const existingIntent=await rpc(main.client,'platform_prepare_customer_admin',{p_request_id:randomUUID(),p_account_id:other.account_id,p_scope_kind:'account',p_school_id:null,p_cafeteria_id:null,p_role_code:'account_admin',p_intended_email:existingEmail,p_expires_at:new Date(Date.now()+86400000).toISOString()});
assert.deepEqual(await rpc(main.client,'platform_prepare_customer_activation',{p_intent_id:existingIntent.intent_id}),{status:'identity_ready'});
assert.equal(sql(`select count(*) from pikas_private.account_activation_flows where source_handle='${existingIntent.intent_id}'`),'0');
const completedArgs={p_request_id:randomUUID(),p_intent_id:existingIntent.intent_id,p_display_name:'Fictional Existing Admin'};
const completed=await rpc(main.client,'platform_complete_initial_customer_admin',completedArgs);assert.deepEqual(await rpc(main.client,'platform_complete_initial_customer_admin',completedArgs),completed);
assert.equal(sql(`select md5(encrypted_password) from auth.users where id='${existing.data.user.id}'`),beforeHash);
const existingLogin=createClient(c.API_URL,c.ANON_KEY,options);assert.equal((await existingLogin.auth.signInWithPassword({email:existingEmail,password})).error,null);await rpc(existingLogin,'pikas_session_start');const context=await rpc(existingLogin,'get_school_admin_context');assert.deepEqual(context.schools.map(s=>s.school_id),[other.school_id]);
console.log('PASS existing confirmed identity: no adoption/link/password mutation, explicit exact completion and normal scoped School Admin login');
// Real new-customer password succeeds, but finalize is deliberately never called before completion.
const recipientNative=await provider.auth.admin.generateLink({type:'invite',email:recipientEmail});assert.equal(recipientNative.error,null);const recipient=createClient(c.API_URL,c.ANON_KEY,options);
assert.equal((await recipient.auth.verifyOtp({token_hash:recipientNative.data.properties.hashed_token,type:'invite'})).error,null);await rpc(recipient,'activation_consume',{p_digest:digest});
await rpc(recipient,'activation_claim_password',{p_handle:prepared.handle,p_fingerprint:createHmac('sha256',owned.owner_key).update(password).digest('hex')});assert.equal((await recipient.auth.updateUser({password})).error,null);
assert.equal(sql(`select ready_at is null from pikas_private.account_activation_flows where auth_id='${owned.auth_id}'`),'t');assert.equal((await rpc(main.client,'platform_customer_activation_status',protectedArgs)).identity_state,'ready');
const firstCompleteArgs={p_request_id:randomUUID(),p_intent_id:intent.intent_id,p_display_name:'Fictional New Admin'},firstComplete=await rpc(main.client,'platform_complete_initial_customer_admin',firstCompleteArgs);
assert.deepEqual(await rpc(main.client,'platform_complete_initial_customer_admin',firstCompleteArgs),firstComplete);assert.equal(sql(`select count(*) from account_memberships where account_id='${tenant.account_id}' and role_code='account_admin'`),'1');
console.log('PASS new-customer lost-finalize recovery: actual first-password hash change permits exact source completion once');
assert.equal(sql("select has_schema_privilege('anon','pikas_private','USAGE') or has_schema_privilege('service_role','pikas_private','USAGE')"),'f');
assert.equal(sql("select has_function_privilege('anon','pikas_private.application_session_pre_request()','EXECUTE') or has_function_privilege('service_role','pikas_private.application_session_pre_request()','EXECUTE')"),'f');
console.log('PASS private schema and private hook permissions remain unchanged');
