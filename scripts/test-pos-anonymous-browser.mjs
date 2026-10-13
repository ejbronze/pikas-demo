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
const stage='/private/tmp/pikas-pos-anonymous-browser';
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
const active=await session.rpc('platform_get_active_sandbox_pov');assert.equal(active.error,null);
if(active.data)assert.equal((await session.rpc('platform_exit_sandbox_pov',{p_request_id:randomUUID()})).error,null);
rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
for(const name of ['package.json','tsconfig.base.json','packages','apps/web'])cpSync(resolve(root,name),resolve(stage,name),{recursive:true,filter:p=>!p.includes('/.next')&&!p.includes('/node_modules')&&!p.includes('/.env')&&!p.includes('/test-results')&&!p.includes('/playwright-report')});
symlinkSync(resolve(root,'node_modules'),resolve(stage,'node_modules'),'dir');
const configPath=resolve(stage,'apps/web/lib/supabase/config.ts');
writeFileSync(configPath,`// Isolated LOCAL TEST ADAPTER; repository production config is unchanged.\nexport function getSupabasePublicConfig() {\n if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:55641' || process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF !== 'pikas-4d6') throw new Error('Local endpoint required');\n return {url:'http://127.0.0.1:55641',anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!};\n}\n`);
const child=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','localhost','--port','3081'],{cwd:resolve(stage,'apps/web'),env:{...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.ANON_KEY,NEXT_PUBLIC_SUPABASE_PROJECT_REF:'pikas-4d6'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',d=>{log+=d});child.stderr.on('data',d=>{log+=d});
let browser,openedSession;
const base='http://localhost:3081',receipts=[];
async function responseFor(page,action){const [response]=await Promise.all([page.waitForResponse(r=>r.url()===base+'/api/pos'&&r.request().postDataJSON()?.operation==='checkout'),action()]);assert.equal(response.status(),200,await response.text());const result=(await response.json()).result;receipts.push(result);return result;}
async function chooseStudent(page,name='Mateo'){await page.getByRole('button',{name:'Usuario PIKAS',exact:true}).click();await page.getByRole('textbox',{name:'Nombre o código del estudiante'}).fill(name);await page.getByRole('button',{name:'Buscar',exact:true}).click();await page.getByRole('button',{name:new RegExp(name)}).click();}
async function review(page){await page.getByRole('button',{name:'Añadir Sándwich de pollo',exact:true}).click();await page.getByRole('button',{name:'Continuar al pago',exact:true}).click();await page.getByRole('heading',{name:'Validación y pago'}).waitFor();assert.equal(await page.getByRole('button',{name:/^Cobrar /}).isDisabled(),true);for(const tender of await page.locator('fieldset button[aria-pressed]').all())assert.equal(await tender.getAttribute('aria-pressed'),'false');}
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/backoffice/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local dev server unavailable');}
 browser=await chromium.launch({headless:true});
 for(const [width,height] of [[1440,1000],[390,844]]){
  const ctx=await browser.newContext({viewport:{width,height}});await ctx.addCookies(jar.map(c=>({name:c.name,value:c.value,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax'})));const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(!openedSession){await page.goto(base+'/platform/demostracion');await page.getByRole('button',{name:'Entrar como Cajero',exact:true}).click();await page.getByRole('link',{name:'Abrir POS',exact:true}).click();await page.waitForURL('**/pos');const requestKey=randomUUID();const opened=await page.request.post(base+'/api/pos',{headers:{Origin:base,'Idempotency-Key':requestKey},data:{operation:'open_register',register_id:'4c000000-0000-4000-8000-000000000010',opening_cash_minor:'0',request_key:requestKey}});assert.equal(opened.status(),200,await opened.text());openedSession=(await opened.json()).result[0].session_id;await page.reload();}else await page.goto(base+'/pos');
  const noUser=page.getByRole('button',{name:'No Usuario',exact:true});await noUser.click();await page.getByRole('heading',{name:'No Usuario',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Recargar saldo',exact:true}).count(),0);await review(page);assert.equal(await page.getByRole('button',{name:'Saldo PIKAS',exact:true}).count(),0);await page.screenshot({path:resolve(stage,'unselected-anonymous-'+width+'.png')});await page.getByRole('button',{name:'Efectivo',exact:true}).click();await page.getByLabel('Efectivo recibido (DOP)',{exact:true}).fill('100');const anonymous=await responseFor(page,()=>page.getByRole('button',{name:/^Cobrar /}).click());assert.equal(anonymous.cafeteria_customer_id,null);assert.equal(anonymous.customer_type,null);assert.equal(anonymous.customer_name,null);assert.equal(anonymous.total_minor,'9500');assert.equal(anonymous.change_due_minor,'500');assert.equal(anonymous.tender_type,'cash');await page.getByRole('heading',{name:'Compra completada'}).waitFor();await page.getByRole('button',{name:'Ver recibo',exact:true}).click();await page.getByRole('article',{name:'Recibo de compra'}).getByText('Cliente: No Usuario',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(stage,'anonymous-receipt-'+width+'.png')});await page.getByRole('button',{name:'Nueva transacción',exact:true}).click();await noUser.waitFor();
  await chooseStudent(page,'Luna');await review(page);await page.screenshot({path:resolve(stage,'unselected-student-'+width+'.png')});await page.getByRole('button',{name:'Saldo PIKAS',exact:true}).click();const wallet=await responseFor(page,()=>page.getByRole('button',{name:/^Cobrar /}).click());assert.equal(wallet.tender_type,'student_wallet');assert.ok(wallet.cafeteria_customer_id);await page.getByRole('button',{name:'Nueva transacción',exact:true}).click();await noUser.waitFor();
  await chooseStudent(page);await review(page);await page.getByRole('button',{name:'Efectivo',exact:true}).click();await page.getByLabel('Efectivo recibido (DOP)',{exact:true}).fill('100');const cash=await responseFor(page,()=>page.getByRole('button',{name:/^Cobrar /}).click());assert.equal(cash.tender_type,'cash');assert.ok(cash.cafeteria_customer_id);assert.equal(cash.change_due_minor,'500');await page.getByRole('button',{name:'Nueva transacción',exact:true}).click();await noUser.waitFor();assert.deepEqual(errors,[]);console.log('PASS '+width+': real local API/RPC José → anonymous cash → receipt/change/reset; student explicitly selected wallet and cash; no preselected tender.');await ctx.close();
 }
 for(const receipt of receipts){const data=JSON.parse(sql(`select to_jsonb(p) from public.purchases p where p.id='${receipt.purchase_id}';`));assert.equal(data.cafeteria_customer_id,receipt.cafeteria_customer_id);assert.equal(data.total_minor,9500);if(receipt.cafeteria_customer_id===null){assert.equal(data.student_id,null);assert.equal(sql(`select count(*) from public.wallet_purchase_debits where purchase_id='${receipt.purchase_id}';`),'0');assert.equal(sql(`select count(*) from public.student_daily_spend_events where purchase_id='${receipt.purchase_id}';`),'0');}assert.equal(sql(`select count(*) from public.audit_events where target_id='${receipt.purchase_id}' and action='purchase_committed' and authenticated_user_id='${uid}' and sandbox_pov_session_id is not null;`),'1');}
 assert.equal(sql(`select count(*) from public.cafeteria_memberships where person_id='${person}';`),'0');
 writeFileSync(resolve(stage,'verification.json'),JSON.stringify({viewports:[1440,390],realLocalApi:true,receipts,operatorTenantMemberships:0},null,2));
}finally{if(browser)await browser.close();if(openedSession){const current=await session.rpc('get_my_open_register_session');if(current.data?.[0]?.session_id===openedSession){const cashTotal=sql(`select coalesce(sum(p.total_minor),0) from public.purchases p join public.purchase_tenders t on t.purchase_id=p.id where p.register_session_id='${openedSession}' and t.tender_type='cash';`);const closed=await session.rpc('close_my_register_session',{p_session_id:openedSession,p_expected_version:current.data[0].version,p_counted_cash_minor:Number(cashTotal),p_close_request_key:randomUUID()});assert.equal(closed.error,null);}}child.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
