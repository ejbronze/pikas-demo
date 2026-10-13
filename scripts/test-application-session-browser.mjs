// LOCAL ONLY. Verifies repository UI/API/RPC flow against fictional pikas-4d6.
// An isolated source copy adapts only the existing HTTPS-only Supabase config
// to the exact loopback test endpoint. Repository production config stays intact.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { chromium } from '@playwright/test';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const stage='/private/tmp/pikas-session-security-browser';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
const endpoint=process.env.DOCKER_HOST||execFileSync(docker,['context','inspect','--format','{{.Endpoints.docker.Host}}'],{encoding:'utf8'}).trim();
assert.ok(['unix:///var/run/docker.sock',`unix://${process.env.HOME}/.docker/run/docker.sock`].includes(endpoint));
assert.equal(execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],{encoding:'utf8'}).trim(),'pikas-4d6');
const config=JSON.parse(execFileSync(resolve(root,'node_modules/.bin/supabase'),['--workdir','/private/tmp/pikas-4d6-local','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(config.API_URL,'http://127.0.0.1:55641');
const provider=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const password='Local-4D6-fictional-only-938!';
const sql=q=>execFileSync(docker,['exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
const person='4d6b0000-0000-4000-8000-000000000001';
let uid=sql(`select auth_user_id from public.persons where id='${person}';`);
if(!uid){
 const created=await provider.auth.admin.createUser({email:'browser-edwin-4d6@example.invalid',password,email_confirm:true});assert.equal(created.error,null);uid=created.data.user.id;
 assert.match(uid,/^[0-9a-f-]{36}$/);
 sql(`insert into public.persons(id,auth_user_id,display_name) values('${person}','${uid}','Edwin · Local browser');insert into pikas_private.platform_memberships(person_id,role_code) values('${person}','platform_sandbox_operator');`);
}
const jar=[];
const session=createServerClient(config.API_URL,config.ANON_KEY,{cookies:{getAll:()=>jar,setAll:values=>{for(const v of values){const index=jar.findIndex(c=>c.name===v.name);if(index<0)jar.push(v);else jar[index]=v;}}}});
assert.equal((await session.auth.signInWithPassword({email:'browser-edwin-4d6@example.invalid',password})).error,null);

assert.equal((await session.rpc('platform_get_active_sandbox_pov')).error?.message,'application_session_expired');
const started=await session.rpc('pikas_session_start');assert.equal(started.error,null,JSON.stringify(started.error));
const sid=started.data.session_id;assert.equal(started.data.user_id,uid);
const age=(idleMinutes=0,absoluteHours=1)=>sql(`update pikas_private.application_sessions set started_at=clock_timestamp()-interval '${absoluteHours} hours',last_active_at=clock_timestamp()-interval '${idleMinutes} minutes' where session_id='${sid}' and user_id='${uid}';`);
const protectedReads=['platform_get_active_sandbox_pov','get_school_admin_context','get_cafeteria_admin_context','get_pos_access_context'];
for(const name of protectedReads){const r=await session.rpc(name);assert.notEqual(r.error?.message,'application_session_expired',name+JSON.stringify(r.error));}
age(16);assert.equal((await session.rpc('get_pos_access_context')).error?.message,'application_session_expired');assert.equal((await session.rpc('platform_get_active_sandbox_pov')).error,null);
age(31);
for(const name of protectedReads){const r=await session.rpc(name);assert.equal(r.error?.code,'42501',name+JSON.stringify(r.error));assert.equal(r.error?.message,'application_session_expired');}
for(const [name,args] of [
 ['checkout_purchase',{p_request:{}}],
 ['school_admin_command',{p_school_id:'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488',p_request_id:randomUUID(),p_operation:'student_create',p_payload:{}}],
 ['cafeteria_admin_command',{p_cafeteria_id:'b9496342-5079-46ae-83b8-05c39bcbd7fe',p_request_id:randomUUID(),p_operation:'product_create',p_payload:{}}],
 ['platform_team_command',{p_request_id:randomUUID(),p_operation:'prepare',p_payload:{}}],
]){const r=await session.rpc(name,args);assert.equal(r.error?.message,'application_session_expired',name+JSON.stringify(r.error));}
const tableRead=await session.from('persons').select('id').limit(1);assert.equal(tableRead.error?.message,'application_session_expired');
const forged=await session.rpc('pikas_session_activity',{p_expected_session_id:sid,p_last_active_at:'2099-01-01'});assert.ok(forged.error);
const expiredTouch=await session.rpc('pikas_session_activity',{p_expected_session_id:sid});assert.equal(expiredTouch.error?.message,'application_session_expired');
age(0,9);assert.equal((await session.rpc('platform_get_active_sandbox_pov')).error?.message,'application_session_expired');
age(0);
const priorPov=await session.rpc('platform_get_active_sandbox_pov');assert.equal(priorPov.error,null);
if(priorPov.data)assert.equal((await session.rpc('platform_exit_sandbox_pov',{p_request_id:randomUUID()})).error,null);
console.log('PASS real PostgREST: missing/idle/absolute deadlines gate direct protected reads, all command families and table reads; no future timestamp parameter.');
rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
for(const name of ['package.json','tsconfig.base.json','packages','apps/web'])cpSync(resolve(root,name),resolve(stage,name),{recursive:true,filter:p=>!p.includes('/.next')&&!p.includes('/node_modules')&&!p.includes('/.env')&&!p.includes('/test-results')&&!p.includes('/playwright-report')});
symlinkSync(resolve(root,'node_modules'),resolve(stage,'node_modules'),'dir');
const configPath=resolve(stage,'apps/web/lib/supabase/config.ts');
writeFileSync(configPath,`// Isolated LOCAL TEST ADAPTER; repository production config is unchanged.\nexport function getSupabasePublicConfig() {\n if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:55641' || process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF !== 'pikas-4d6') throw new Error('Local endpoint required');\n return {url:'http://127.0.0.1:55641',anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!};\n}\n`);
const child=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','localhost','--port','3082'],{cwd:resolve(stage,'apps/web'),env:{...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.ANON_KEY,NEXT_PUBLIC_SUPABASE_PROJECT_REF:'pikas-4d6'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',d=>{log+=d});child.stderr.on('data',d=>{log+=d});

let browser;const base='http://localhost:3082';
const status=async(page,surface='admin',expected=sid)=>{const r=await page.request.post(base+'/api/auth/session',{headers:{Origin:base},data:{action:'status',surface,session_id:expected}});assert.equal(r.status(),200,await r.text());return(await r.json()).session;};
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/backoffice/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local dev server unavailable');}
 browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 await ctx.addCookies(jar.map(c=>({name:c.name,value:c.value,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax'})));
 const page=await ctx.newPage(),second=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));second.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/platform/demostracion');await page.getByRole('heading',{name:'Demostración',exact:true,level:1}).waitFor();assert.equal((await status(page)).idle_seconds,1800);
 await second.goto(base+'/platform/demostracion');await second.getByRole('heading',{name:'Demostración',exact:true,level:1}).waitFor();
 const journalKey='pikas:connected-pos:pending:v1';const recovery={actor:person,auth_user:uid,pov:null,request:{request_key:randomUUID(),operation:'sent-uncertain-fixture'}};
 await page.evaluate(({journalKey,recovery})=>sessionStorage.setItem(journalKey,JSON.stringify(recovery)),{journalKey,recovery});
 age(28.5);await page.reload();await second.reload();
 await page.getByRole('dialog',{name:'Tu sesión está por vencer'}).waitFor();await second.getByRole('dialog',{name:'Tu sesión está por vencer'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Continuar sesión'}).evaluate(el=>el===document.activeElement),true);
 const absoluteBefore=(await status(page)).absolute_deadline;
 await page.getByRole('button',{name:'Continuar sesión'}).click();await page.getByRole('dialog',{name:'Tu sesión está por vencer'}).waitFor({state:'hidden'});await second.getByRole('dialog',{name:'Tu sesión está por vencer'}).waitFor({state:'hidden'});
 assert.equal((await status(page)).absolute_deadline,absoluteBefore);
 const activeBefore=sql(`select last_active_at from pikas_private.application_sessions where session_id='${sid}'`);
 await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));
 await status(page);await new Promise(r=>setTimeout(r,300));assert.equal(sql(`select last_active_at from pikas_private.application_sessions where session_id='${sid}'`),activeBefore);
 console.log('PASS browser: Platform 30m, keyboard warning, explicit Continue, same-session cross-tab activity, no background/untrusted activity or absolute extension.');
 // Each existing admin experience is validated through the same live local API.
 for(const [code,button,href] of [['school_admin','Entrar como Administrador escolar','/admin/escuela'],['cafeteria_admin','Entrar como Administrador de cafetería','/admin/cafeteria'],['cashier','Entrar como Cajero','/pos']]){
  await page.goto(base+'/platform/demostracion');
  const active=await session.rpc('platform_get_active_sandbox_pov');assert.equal(active.error,null);
  if(active.data)assert.equal((await session.rpc('platform_exit_sandbox_pov',{p_request_id:randomUUID()})).error,null);
  await page.reload();await page.getByRole('button',{name:button,exact:true}).click();
  const link=page.locator(`a[href^="${href}"]`).first();await link.click();await page.waitForURL(u=>u.pathname.startsWith(href));
  const value=await status(page,code==='cashier'?'pos':'admin');assert.equal(value.idle_seconds,code==='cashier'?900:1800);
  const activePov=await session.rpc('platform_get_active_sandbox_pov');assert.equal(activePov.error,null);assert.equal(activePov.data.pov_code,code);
  console.log('PASS '+code+': existing authority/context revalidated; '+value.idle_seconds+' second idle policy.');
 }
 const povBefore=await session.rpc('platform_get_active_sandbox_pov');assert.equal(povBefore.error,null);
 const key=randomUUID();const opened=await page.request.post(base+'/api/pos',{headers:{Origin:base,'Idempotency-Key':key},data:{operation:'open_register',register_id:'4c000000-0000-4000-8000-000000000010',opening_cash_minor:'0',request_key:key}});assert.equal(opened.status(),200,await opened.text());
 const operational=(await opened.json()).result[0];
 // Known server expiry on a resumed tab masks both tabs and retains journals. No financial write is sent.
 age(16);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('heading',{name:'Tu sesión se cerró',exact:true}).waitFor();await second.getByRole('heading',{name:'Tu sesión se cerró',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Venta actual'}).count(),0);
 assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),journalKey),JSON.stringify(recovery));
 assert.ok([401,403].includes((await page.request.post(base+'/api/pos',{headers:{Origin:base},data:{operation:'bootstrap'}})).status()));
 console.log('PASS browser: POS timeout, resumed-tab reconciliation, immediate stale-UI mask, cross-tab expiry/local logout, exact journal retained.');
 assert.equal(sql(`select status from register_sessions where id='${operational.session_id}'`),'open');
 const replacementJar=[];
 const replacement=createServerClient(config.API_URL,config.ANON_KEY,{cookies:{getAll:()=>replacementJar,setAll:values=>{for(const v of values){const i=replacementJar.findIndex(c=>c.name===v.name);if(i<0)replacementJar.push(v);else replacementJar[i]=v;}}}});
 assert.equal((await replacement.auth.signInWithPassword({email:'browser-edwin-4d6@example.invalid',password})).error,null);
 const fresh=await replacement.rpc('pikas_session_start');assert.equal(fresh.error,null);assert.notEqual(fresh.data.session_id,sid);
 const resumedPov=await replacement.rpc('platform_get_active_sandbox_pov');assert.equal(resumedPov.error,null);assert.equal(resumedPov.data.session_id,povBefore.data.session_id);
 await ctx.addCookies(replacementJar.map(c=>({name:c.name,value:c.value,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax'})));
 const staleLogout=await page.request.post(base+'/api/auth/logout',{headers:{Origin:base},data:{session_id:sid}});assert.equal(staleLogout.status(),409);
 const staleAction=await page.request.post(base+'/api/pos',{headers:{Origin:base,'X-Pikas-Session-Id':sid},data:{operation:'bootstrap'}});assert.equal(staleAction.status(),503);
 assert.equal((await replacement.rpc('platform_get_active_sandbox_pov')).error,null);
 await page.reload();await page.getByRole('heading',{name:'Tu sesión se cerró'}).waitFor({state:'hidden'});
 assert.equal((await status(page,'pos',fresh.data.session_id)).session_id,fresh.data.session_id);
 const stillOpen=await replacement.rpc('get_my_open_register_session');assert.equal(stillOpen.error,null);assert.equal(stillOpen.data[0].session_id,operational.session_id);
 const closed=await replacement.rpc('close_my_register_session',{p_session_id:operational.session_id,p_expected_version:stillOpen.data[0].version,p_counted_cash_minor:0,p_close_request_key:randomUUID()});assert.equal(closed.error,null);
 // Explicit logout of this browser must not revoke another device's Supabase session.
 const other=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});assert.equal((await other.auth.signInWithPassword({email:'browser-edwin-4d6@example.invalid',password})).error,null);assert.equal((await other.rpc('pikas_session_start')).error,null);
 const logoutReply=page.waitForResponse(r=>r.url()===base+'/api/auth/logout');await page.locator('form[action="/api/auth/logout"] button').click();assert.equal((await logoutReply).status(),200);
 await page.getByRole('heading',{name:'Tu sesión se cerró',exact:true}).waitFor();assert.equal((await other.rpc('platform_get_active_sandbox_pov')).error,null);
 // An old-session broadcast cannot mask this reauthenticated tab.
 await page.evaluate(old=>{const b=new BroadcastChannel('pikas:application-session:v1');b.postMessage({session_id:old,event:'ended'});b.close();},sid);
 console.log('PASS recovery/security: register stayed open; new Auth session revalidated same POV; stale-tab transport/logout denied; explicit logout preserved another device session.');
 const absJar=[];const absoluteClient=createServerClient(config.API_URL,config.ANON_KEY,{cookies:{getAll:()=>absJar,setAll:values=>{for(const v of values){const i=absJar.findIndex(c=>c.name===v.name);if(i<0)absJar.push(v);else absJar[i]=v;}}}});
 assert.equal((await absoluteClient.auth.signInWithPassword({email:'browser-edwin-4d6@example.invalid',password})).error,null);const absStarted=await absoluteClient.rpc('pikas_session_start');assert.equal(absStarted.error,null);const absSid=absStarted.data.session_id;
 sql(`update pikas_private.application_sessions set started_at=clock_timestamp()-interval '8 hours'+interval '20 seconds',last_active_at=clock_timestamp() where session_id='${absSid}' and user_id='${uid}'`);
 const absCtx=await browser.newContext();await absCtx.addCookies(absJar.map(c=>({name:c.name,value:c.value,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax'})));const absPage=await absCtx.newPage();absPage.on('pageerror',e=>errors.push(e.message));
 await absPage.goto(base+'/platform/demostracion');await absPage.getByRole('dialog',{name:'Tu sesión está por vencer'}).waitFor();
 const fixedAbsolute=(await status(absPage,'admin',absSid)).absolute_deadline;
 await absPage.getByRole('button',{name:'Continuar sesión'}).click();assert.equal((await status(absPage,'admin',absSid)).absolute_deadline,fixedAbsolute);
 await absPage.getByRole('heading',{name:'Tu sesión se cerró',exact:true}).waitFor({timeout:25_000});assert.equal((await other.rpc('platform_get_active_sandbox_pov')).error,null);
 console.log('PASS browser absolute 8h: Continue did not extend deadline; timer masked/logged out; independent Auth session unaffected.');
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(stage,'verification.json'),JSON.stringify({sessionId:sid,realLocalApi:true,policy:{admin:1800,pos:900,absolute:28800},browserErrors:errors},null,2));
}finally{if(browser)await browser.close();child.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
