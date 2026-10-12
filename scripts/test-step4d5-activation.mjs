// LOCAL Docker/Auth only. Synthetic fixtures; reset pikas-activation after this script.
import {execFileSync} from 'node:child_process';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
const endpoint=process.env.DOCKER_HOST||execFileSync(docker,['context','inspect','--format','{{.Endpoints.docker.Host}}'],{encoding:'utf8'}).trim();
if(!['unix:///var/run/docker.sock',`unix://${process.env.HOME}/.docker/run/docker.sock`].includes(endpoint))throw Error('Non-local Docker refused');
const label=execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-activation'],{encoding:'utf8'}).trim();
if(label!=='pikas-activation')throw Error('Wrong local project');
const sql=(query)=>execFileSync(docker,['exec','-i','supabase_db_pikas-activation','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:query,encoding:'utf8'}).trim();
if(sql('select max(version) from supabase_migrations.schema_migrations;')!=='202610120001')throw Error('Wrong migration');
const config=JSON.parse(execFileSync('./node_modules/.bin/supabase',['status','--workdir',process.env.PIKAS_ACTIVATION_WORKDIR||'/private/tmp/pikas-activation-local', '-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(new URL(config.API_URL).hostname!=='127.0.0.1'||new URL(config.API_URL).port!=='55541')throw Error('Non-local API refused');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const provider=createClient(config.API_URL,config.SERVICE_ROLE_KEY,options);
const anon=()=>createClient(config.API_URL,config.ANON_KEY,options);
const digest=token=>createHash('sha256').update(token).digest('hex');
const rpc=async(client,name,args={})=>{const result=await client.rpc(name,args);assert.equal(result.error,null,`${name}: ${result.error?.code}`);return result.data;};
const id=randomUUID(),person=randomUUID(),password='Local-synthetic-password-938!',suffix=randomUUID();
const email=`activation-${suffix}@example.invalid`,adminEmail=`activation-admin-${suffix}@example.invalid`;
const adminUser=await provider.auth.admin.createUser({email:adminEmail,password,email_confirm:true});assert.equal(adminUser.error,null);
sql(`insert into public.persons(id,auth_user_id,display_name) values('${person}','${adminUser.data.user.id}','Synthetic activation admin');insert into pikas_private.platform_memberships(person_id,role_code) values('${person}','platform_admin');insert into pikas_private.platform_team_handles(person_id) values('${person}');`);
const admin=anon();assert.equal((await admin.auth.signInWithPassword({email:adminEmail,password})).error,null);
await rpc(admin,'platform_team_command',{p_request_id:id,p_operation:'prepare',p_payload:{name:'Synthetic invited operator',email,demo:true}});
let read=await rpc(admin,'platform_team_activation_read');
const intent=read.prepared.find(row=>row.email===email);assert.ok(intent);assert.equal(intent.identity_ready,false);
let reservation=await rpc(admin,'platform_prepare_activation',{p_team_handle:intent.handle});
let owned=await rpc(provider,'activation_provider_context',{p_handle:reservation.handle});assert.equal(owned.auth_id,null);
// Simulate createUser success with a lost response, before DB knows the Auth UUID.
const generated=await provider.auth.admin.createUser({email,email_confirm:false,app_metadata:{pikas_activation_owner:owned.owner_key}});assert.equal(generated.error,null);
owned=await rpc(provider,'activation_provider_context',{p_handle:reservation.handle});assert.equal(owned.auth_id,generated.data.user.id);
assert.equal((await provider.auth.admin.getUserById(owned.auth_id)).data.user.app_metadata.pikas_activation_owner,owned.owner_key);
let token=randomBytes(32).toString('hex');
await rpc(admin,'platform_bind_activation',{p_handle:reservation.handle,p_digest:digest(token)});
assert.deepEqual(await rpc(anon(),'activation_preview',{p_digest:digest(token)}),{handle:reservation.handle});
assert.equal(sql(`select count(*) from public.persons where auth_user_id='${owned.auth_id}';`),'0');
assert.equal(await rpc(anon(),'activation_preview',{p_digest:digest(token)})!==null,true);
assert.ok((await admin.rpc('activation_consume',{p_digest:digest(token)})).error);
// Stage 1: before provider verification, identical application link remains resumable.
assert.equal(await rpc(anon(),'activation_preview',{p_digest:digest(randomBytes(32).toString('hex'))}),null);
const establish=async()=>{
 const appPreview=await rpc(anon(),'activation_preview',{p_digest:digest(token)});assert.ok(appPreview);
 const context=await rpc(provider,'activation_provider_context',{p_digest:digest(token)});
 const inspected=await provider.auth.admin.getUserById(context.auth_id);assert.equal(inspected.error,null);assert.equal(inspected.data.user.app_metadata.pikas_activation_owner,context.owner_key);
 const type=inspected.data.user.email_confirmed_at?'magiclink':'invite';
 const native=await provider.auth.admin.generateLink({type,email:context.email});assert.equal(native.error,null);assert.equal(native.data.user.id,context.auth_id);
 // Native OTP/hash alone is never a valid application credential/oracle candidate.
 assert.equal(await rpc(anon(),'activation_preview',{p_digest:digest(native.data.properties.hashed_token)}),null);
 const session=anon(),verified=await session.auth.verifyOtp({token_hash:native.data.properties.hashed_token,type});assert.equal(verified.error,null);assert.equal(verified.data.user.id,context.auth_id);
 return {client:session,session:verified.data.session,type};
};
// Stage 2: provider confirmed the identity, but consume was never attempted.
const interrupted=await establish();assert.equal(interrupted.type,'invite');
let recovered=await establish();assert.equal(recovered.type,'magiclink');
// Stage 3: DB consumed the invitation, but the application response/session was lost.
await rpc(recovered.client,'activation_consume',{p_digest:digest(token)});
recovered=await establish();assert.equal((await rpc(recovered.client,'activation_consume',{p_digest:digest(token)})).handle,reservation.handle);
assert.equal(sql(`select count(*) from pikas_private.account_activation_events where invitation_handle='${reservation.handle}' and action='activated';`),'1');
// Stage 4: cookies serialized, response lost; same private link restores own session.
const lostJar=new Map();const lostSSR=createServerClient(config.API_URL,config.ANON_KEY,{cookies:{getAll:()=>[],setAll:values=>values.forEach(c=>lostJar.set(c.name,c))}});assert.equal((await lostSSR.auth.setSession(recovered.session)).error,null);
recovered=await establish();await rpc(recovered.client,'activation_consume',{p_digest:digest(token)});
const cookieJar=new Map();
const ssr=createServerClient(config.API_URL,config.ANON_KEY,{cookies:{getAll:()=>[],setAll:values=>values.forEach(cookie=>cookieJar.set(cookie.name,cookie))}});
assert.equal((await ssr.auth.setSession(recovered.session)).error,null);assert.ok(cookieJar.size);
const restored=createServerClient(config.API_URL,config.ANON_KEY,{cookies:{getAll:()=>Array.from(cookieJar.values()),setAll:()=>{}}});assert.equal((await restored.auth.getUser()).data.user.id,owned.auth_id);
assert.equal(await rpc(restored,'activation_password_status',{p_handle:reservation.handle}),'pending');
assert.equal((await rpc(admin,'platform_team_activation_read')).prepared.find(row=>row.handle===intent.handle).identity_ready,false);
// Stage 7: authorized reissue after interruption owns the exact same confirmed user.
const oldToken=token;
reservation=await rpc(admin,'platform_prepare_activation',{p_team_handle:intent.handle});
const reissueOwned=await rpc(provider,'activation_provider_context',{p_handle:reservation.handle});assert.equal(reissueOwned.auth_id,owned.auth_id);
token=randomBytes(32).toString('hex');await rpc(admin,'platform_bind_activation',{p_handle:reservation.handle,p_digest:digest(token)});
assert.equal(await rpc(anon(),'activation_preview',{p_digest:digest(oldToken)}),null);
recovered=await establish();let recipient=recovered.client;
await rpc(recipient,'activation_consume',{p_digest:digest(token)});await rpc(recipient,'activation_consume',{p_digest:digest(token)});
// Stage 5: password succeeded, SQL finalization/success response was never received.
const fingerprint=createHmac('sha256',owned.owner_key).update(password).digest('hex');
await rpc(recipient,'activation_claim_password',{p_handle:reservation.handle,p_fingerprint:fingerprint});
assert.ok((await recipient.rpc('activation_claim_password',{p_handle:reservation.handle,p_fingerprint:digest('different-password')})).error);
assert.equal((await recipient.auth.updateUser({password})).error,null);
assert.equal(await rpc(recipient,'activation_password_context',{p_handle:reservation.handle}),false);
assert.equal(await rpc(anon(),'activation_preview',{p_digest:digest(token)}),null);
assert.equal(await rpc(recipient,'activation_password_status',{p_handle:reservation.handle}),'ready');
assert.equal(await rpc(recipient,'activation_password_status',{p_handle:reservation.handle}),'ready');
// Stage 6: completed activation cannot mint new sessions/change first password again.
assert.ok((await recipient.rpc('activation_consume',{p_digest:digest(token)})).error);
assert.ok((await admin.rpc('platform_prepare_activation',{p_team_handle:intent.handle})).error);
const login=anon();assert.equal((await login.auth.signInWithPassword({email,password})).error,null);assert.equal((await login.auth.getUser()).data.user.id,owned.auth_id);
read=await rpc(admin,'platform_team_activation_read');assert.equal(read.prepared.find(row=>row.handle===intent.handle).identity_ready,true);
assert.equal(sql(`select count(*) from auth.users where email='${email}';`),'1');
assert.equal(sql(`select count(*) from public.persons where auth_user_id='${owned.auth_id}';`),'0');
// Unrelated unconfirmed, confirmed and linked identities cannot have native tokens replaced.
for(const state of ['unconfirmed','confirmed','linked']){
 const foreignEmail=`foreign-${state}-${suffix}@example.invalid`;
 const foreign=await provider.auth.admin.createUser({email:foreignEmail,email_confirm:state==='confirmed'});assert.equal(foreign.error,null);
 if(state==='linked')sql(`insert into public.persons(auth_user_id,display_name) values('${foreign.data.user.id}','Synthetic foreign person');`);
 const before=sql(`select coalesce(confirmation_token,'') from auth.users where id='${foreign.data.user.id}';`);
 await rpc(admin,'platform_team_command',{p_request_id:randomUUID(),p_operation:'prepare',p_payload:{name:'Synthetic foreign',email:foreignEmail,demo:false}});
 const foreignIntent=(await rpc(admin,'platform_team_read')).prepared.find(row=>row.email===foreignEmail);
 assert.ok((await admin.rpc('platform_prepare_activation',{p_team_handle:foreignIntent.handle})).error);
 assert.equal(sql(`select coalesce(confirmation_token,'') from auth.users where id='${foreign.data.user.id}';`),before);
 assert.equal((await provider.auth.admin.getUserById(foreign.data.user.id)).data.user.email_confirmed_at?true:false,state==='confirmed');
}
console.log('PASS: independent app credential; owned creation/reissue; all seven interruption states; SSR reload; password closure; foreign identities rejected; zero activation authority.');
// Existing manual authorization boundary, exact-key replay and distinct role grants.
const completion=randomUUID(),payload={p_request_id:completion,p_operation:'complete',p_payload:{handle:intent.handle}};
assert.deepEqual(await rpc(admin,'platform_team_command',payload),await rpc(admin,'platform_team_command',payload));
const target=sql(`select id from public.persons where auth_user_id='${generated.data.user.id}';`);
assert.equal(sql(`select count(*) from pikas_private.platform_memberships where person_id='${target}';`),'2');
assert.equal(sql(`select count(*) from pikas_private.platform_audit_events where request_id='${completion}';`),'1');
assert.equal(sql(`select (select count(*) from public.account_memberships where person_id='${target}')+(select count(*) from public.school_memberships where person_id='${target}')+(select count(*) from public.cafeteria_memberships where person_id='${target}');`),'0');
assert.equal(sql("select count(*) from pikas_private.platform_role_capabilities where role_code='platform_admin' and capability='platform:sandbox:pov:enter';"),'0');
// A second independent operator enters the same pre-existing synthetic sandbox/persona.
const account=randomUUID(),school=randomUUID(),location=randomUUID(),cafe=randomUUID(),cashier=randomUUID(),membership=randomUUID();
sql(`insert into public.accounts(id,code,name,tenant_kind) values('${account}','ACT-${suffix}','Synthetic shared sandbox','sandbox');insert into public.schools(id,account_id,code,name) values('${school}','${account}','S','Synthetic school');insert into public.school_locations(id,account_id,school_id,code,name) values('${location}','${account}','${school}','L','Synthetic location');insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name) values('${cafe}','${account}','${school}','${location}','C','Synthetic cafe');insert into public.persons(id,display_name) values('${cashier}','Synthetic shared cashier');insert into public.cafeteria_memberships(id,person_id,account_id,school_id,cafeteria_id,role_code) values('${membership}','${cashier}','${account}','${school}','${cafe}','pos_cashier');insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id) values('${account}','${school}','${cafe}','cashier','${cashier}','${membership}');insert into pikas_private.platform_memberships(person_id,role_code) values('${person}','platform_sandbox_operator');`);
for(const client of [admin,recipient])await rpc(client,'platform_enter_sandbox_pov',{p_request_id:randomUUID(),p_account_id:account,p_cafeteria_id:cafe,p_pov_code:'cashier'});
assert.equal(sql(`select count(*) from pikas_private.sandbox_pov_sessions where account_id='${account}' and status='active';`),'2');
assert.equal(sql(`select count(distinct persona_id) from pikas_private.sandbox_pov_sessions where account_id='${account}';`),'1');
assert.equal(sql(`select count(*) from public.cafeteria_memberships where person_id in ('${target}','${person}');`),'0');
console.log('PASS: real local Auth invitation, confirmation, recipient password/login, zero activation authority, manual completion replay, separate roles, shared sandbox; synthetic fixtures only.');
