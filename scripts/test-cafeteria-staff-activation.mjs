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
const provider=createClient(c.API_URL,c.SERVICE_ROLE_KEY,options),anon=createClient(c.API_URL,c.ANON_KEY,options),tag=randomUUID().slice(0,8),password='Local-Delegation-fictional-938!';
async function rpc(client,name,args={}){const r=await client.rpc(name,args);assert.equal(r.error,null,`${name}: ${r.error?.message}`);return r.data;}
async function identity(label){const email=`local-staff-${label}-${tag}@example.invalid`;const r=await provider.auth.admin.createUser({email,password,email_confirm:true});assert.equal(r.error,null);const id=r.data.user.id,person=randomUUID(),client=createClient(c.API_URL,c.ANON_KEY,options);sql(`insert into persons(id,auth_user_id,display_name) values('${person}','${id}','Fictional ${label}');`);assert.equal((await client.auth.signInWithPassword({email,password})).error,null);await rpc(client,'pikas_session_start');return {email,id,person,client};}
const owner=await identity('owner'),other=await identity('other'),schoolOnly=await identity('school'),cross=await identity('cross');
const a=randomUUID(),s=randomUUID(),l=randomUUID(),caf=randomUUID(),a2=randomUUID();
sql(`insert into accounts(id,code,name) values('${a}','STAFF-${tag}','Fictional Delegation'),('${a2}','STAFF2-${tag}','Fictional Other');insert into schools(id,account_id,code,name) values('${s}','${a}','SCHOOL','Fictional School');insert into school_locations(id,account_id,school_id,code,name) values('${l}','${a}','${s}','CAMPUS','Fictional Campus');insert into cafeterias(id,account_id,school_id,school_location_id,code,name) values('${caf}','${a}','${s}','${l}','CAFE','Fictional Cafe');insert into account_memberships(account_id,person_id,role_code) values('${a}','${owner.person}','account_admin'),('${a2}','${cross.person}','account_admin');insert into school_memberships(account_id,school_id,person_id,role_code) values('${a}','${s}','${schoolOnly.person}','school_admin');`);

sql(`insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code) values('${a}','${s}','${caf}','${owner.person}','cafeteria_admin');`);
const args=(operation,payload,key=randomUUID())=>({p_cafeteria_id:caf,p_request_id:key,p_operation:operation,p_payload:payload});
const cmd=(operation,payload,key)=>rpc(owner.client,'cafeteria_admin_command',args(operation,payload,key));
const prepare=async email=>(await cmd('staff_prepare',{email,role:'pos_cashier'})).target_id;
const status=invitation=>rpc(owner.client,'cafeteria_staff_activation_status',{p_invitation_id:invitation});
const issue=invitation=>rpc(owner.client,'cafeteria_prepare_staff_activation',{p_invitation_id:invitation});
const bind=(invitation,handle,digest)=>rpc(owner.client,'cafeteria_bind_staff_activation',{p_invitation_id:invitation,p_handle:handle,p_digest:digest});
const digest=()=>createHash('sha256').update(randomBytes(32)).digest('hex');
const newEmail=`new-staff-${tag}@example.invalid`,invitation=await prepare(newEmail),source=sql(`select row_to_json(i)::text from invitations i where id='${invitation}'`);
for(const x of [other,schoolOnly,cross])assert.equal((await x.client.rpc('cafeteria_prepare_staff_activation',{p_invitation_id:invitation})).error.code,'42501');
assert.equal((await owner.client.rpc('cafeteria_prepare_staff_activation',{p_invitation_id:randomUUID()})).error.code,'42501');
let reservation=await issue(invitation),owned=await rpc(provider,'activation_provider_context',{p_handle:reservation.handle});
assert.equal(owned.auth_id,null);const created=await provider.auth.admin.createUser({email:newEmail,email_confirm:false,app_metadata:{pikas_activation_owner:owned.owner_key}});assert.equal(created.error,null);
// Explicit retry after a lost identity-creation response reconciles the same provenance-owned UUID.
reservation=await issue(invitation);owned=await rpc(provider,'activation_provider_context',{p_handle:reservation.handle});assert.equal(owned.auth_id,created.data.user.id);
let token=digest();await bind(invitation,reservation.handle,token);await bind(invitation,reservation.handle,token);assert.ok(await rpc(anon,'activation_preview',{p_digest:token}));assert.ok((await owner.client.rpc('cafeteria_bind_staff_activation',{p_invitation_id:invitation,p_handle:reservation.handle,p_digest:digest()})).error);
const old=token;reservation=await issue(invitation);token=digest();await bind(invitation,reservation.handle,token);assert.equal(await rpc(anon,'activation_preview',{p_digest:old}),null);
assert.equal(sql(`select row_to_json(i)::text from invitations i where id='${invitation}'`),source);
console.log('PASS same invitation preserved, authorized issuance, exact bind, changed digest denial, lost creation recovery and replacement');
const native=await provider.auth.admin.generateLink({type:'magiclink',email:newEmail});assert.equal(native.error,null);const recipient=createClient(c.API_URL,c.ANON_KEY,options);assert.equal((await recipient.auth.verifyOtp({token_hash:native.data.properties.hashed_token,type:'magiclink'})).error,null);await rpc(recipient,'activation_consume',{p_digest:token});
const completion={invitation_id:invitation,display_name:'Fictional Cashier'};
assert.equal((await owner.client.rpc('cafeteria_admin_command',args('staff_complete',completion))).error.message,'confirmed_identity_pending');
assert.equal(sql(`select count(*) from persons where auth_user_id='${created.data.user.id}'`),'0');assert.equal(sql(`select count(*) from cafeteria_register_assignments where cafeteria_id='${caf}'`),'0');
await rpc(recipient,'activation_claim_password',{p_handle:reservation.handle,p_fingerprint:createHmac('sha256',owned.owner_key).update(password).digest('hex')});assert.equal((await recipient.auth.updateUser({password})).error,null);
assert.equal(sql(`select ready_at is null from pikas_private.account_activation_flows where auth_id='${created.data.user.id}'`),'t');assert.equal((await status(invitation)).identity_state,'ready');
const key=randomUUID(),completed=await cmd('staff_complete',completion,key);assert.deepEqual(await cmd('staff_complete',completion,key),completed);assert.equal((await owner.client.rpc('cafeteria_admin_command',args('staff_complete',{...completion,display_name:'Changed'},key))).error.message,'request_key_reused');
assert.equal(sql(`select role_code from cafeteria_memberships where id='${completed.target_id}'`),'pos_cashier');assert.equal(sql(`select count(*) from cafeteria_memberships where person_id=(select id from persons where auth_user_id='${created.data.user.id}') and role_code='cafeteria_admin'`),'0');assert.equal(sql(`select count(*) from cafeteria_register_assignments where cafeteria_id='${caf}'`),'0');
console.log('PASS activation-only zero authority, first-password guard, lost-finalize recovery, explicit cashier-only completion and exact lost-success replay');
const existing=await prepare(other.email),hash=sql(`select md5(encrypted_password) from auth.users where id='${other.id}'`);assert.equal((await issue(existing)).status,'identity_ready');await cmd('staff_complete',{invitation_id:existing,display_name:'Existing Cashier'});assert.equal(sql(`select md5(encrypted_password) from auth.users where id='${other.id}'`),hash);
for(const target of [cross.email,owner.email]){const id=await prepare(target);assert.equal((await owner.client.rpc('cafeteria_prepare_staff_activation',{p_invitation_id:id})).error.code,'42501');}
sql(`insert into pikas_private.platform_memberships(person_id,role_code) values('${schoolOnly.person}','platform_admin');`);const platform=await prepare(schoolOnly.email);assert.equal((await owner.client.rpc('cafeteria_prepare_staff_activation',{p_invitation_id:platform})).error.code,'42501');
const stranger=`unowned-staff-${tag}@example.invalid`;assert.equal((await provider.auth.admin.createUser({email:stranger,email_confirm:false})).error,null);const unowned=await prepare(stranger);assert.equal((await owner.client.rpc('cafeteria_prepare_staff_activation',{p_invitation_id:unowned})).error.code,'42501');
console.log('PASS existing confirmed path keeps password, cross-account/platform/self and unowned identity denials');
const expired=await prepare(`expired-staff-${tag}@example.invalid`);let exp=await issue(expired);let eo=await rpc(provider,'activation_provider_context',{p_handle:exp.handle});assert.equal((await provider.auth.admin.createUser({email:eo.email,email_confirm:false,app_metadata:{pikas_activation_owner:eo.owner_key}})).error,null);const ed=digest();await bind(expired,exp.handle,ed);sql(`update pikas_private.account_activation_invitations set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second' where handle='${exp.handle}'`);assert.equal(await rpc(anon,'activation_preview',{p_digest:ed}),null);
const sourceExpired=randomUUID();sql(`insert into invitations(id,account_id,school_id,cafeteria_id,scope_kind,role_code,intended_email,token_hash,invited_by,created_at,expires_at) values('${sourceExpired}','${a}','${s}','${caf}','cafeteria','pos_cashier','expired-source-${tag}@example.invalid','${digest()}','${owner.person}',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 second');`);assert.ok((await owner.client.rpc('cafeteria_prepare_staff_activation',{p_invitation_id:sourceExpired})).error);
const login=createClient(c.API_URL,c.ANON_KEY,options);assert.equal((await login.auth.signInWithPassword({email:newEmail,password})).error,null);await rpc(login,'pikas_session_start');assert.equal((await rpc(login,'get_pos_access_context')).memberships[0].cafeteria_id,caf);
const current=await owner.client.auth.getSession(),sid=JSON.parse(Buffer.from(current.data.session.access_token.split('.')[1],'base64url')).session_id;
sql(`update pikas_private.application_sessions set started_at=clock_timestamp()-interval '2 hours',last_active_at=clock_timestamp()-interval '16 minutes' where session_id='${sid}'`);await status(invitation);assert.equal((await owner.client.rpc('get_pos_access_context')).error.message,'application_session_expired');assert.equal((await login.rpc('get_pos_access_context')).error,null);
sql(`update pikas_private.application_sessions set started_at=clock_timestamp()-interval '2 hours',last_active_at=clock_timestamp()-interval '31 minutes' where session_id='${sid}'`);assert.equal((await owner.client.rpc('cafeteria_staff_activation_status',{p_invitation_id:invitation})).error.message,'application_session_expired');
for(const x of [anon,provider])assert.ok((await x.rpc('cafeteria_staff_activation_status',{p_invitation_id:invitation})).error);
console.log('PASS activation/source expiry, cashier scoped login, application session/ACL enforcement; no production/Horizonte access');
