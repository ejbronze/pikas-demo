// LOCAL ONLY production-mode UI -> API -> Auth/PostgREST -> committed database.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {cpSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),stage='/private/tmp/pikas-phase5b-browser',base='http://localhost:3096';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
assert.equal(execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],{encoding:'utf8'}).trim(),'pikas-4d6');
const config=JSON.parse(execFileSync(resolve(root,'node_modules/.bin/supabase'),['--workdir','/private/tmp/pikas-4d6-local','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(config.API_URL,'http://127.0.0.1:55641');
const sql=q=>execFileSync(docker,['exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
assert.equal(sql('select max(version) from supabase_migrations.schema_migrations'),'202610160002');
const provider=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const tag=randomUUID().slice(0,8),password='Local-5A-fictional-only-938!',emails=[`phase5b-admin-${tag}@example.invalid`,`phase5b-cashier-${tag}@example.invalid`],users=[];
const [account,school,location,cafe,adminPerson,cashierPerson,cashierMembership,register,product]=Array.from({length:9},()=>randomUUID());
for(const email of emails){const created=await provider.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null);users.push(created.data.user.id);}
sql(`insert into persons(id,auth_user_id,display_name) values('${adminPerson}','${users[0]}','Administrador Ficticio Phase 5B'),('${cashierPerson}','${users[1]}','Cajero Ficticio Phase 5B');insert into accounts(id,code,name) values('${account}','PHASE5A-${tag}','Cuenta Ficticia Phase 5B');insert into schools(id,account_id,code,name) values('${school}','${account}','S','Escuela Ficticia Phase 5B');insert into school_locations(id,account_id,school_id,code,name) values('${location}','${account}','${school}','L','Sede Ficticia');insert into cafeterias(id,account_id,school_id,school_location_id,code,name) values('${cafe}','${account}','${school}','${location}','C','Cafetería Ficticia Phase 5B');insert into cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values('${randomUUID()}','${account}','${school}','${cafe}','${adminPerson}','cafeteria_admin'),('${cashierMembership}','${account}','${school}','${cafe}','${cashierPerson}','pos_cashier');`);
sql(`insert into school_memberships(account_id,school_id,person_id,role_code) values('${account}','${school}','${adminPerson}','school_admin');`);
const claims=u=>`set request.jwt.claim.sub='${u}';set role authenticated;`;
const command=(operation,payload)=>JSON.parse(sql(claims(users[0])+`select cafeteria_admin_command('${cafe}','${randomUUID()}','${operation}','${JSON.stringify(payload)}');`));
command('product_save',{id:product,version:null,name:'Agua ficticia Phase 5B',description:'Fixture local',category:'Bebidas',price_minor:5000,unit:'botella',active:true,available:true,ingredients:[],allergens:[]});
command('register_save',{id:register,version:null,code:'PHASE5A',name:'Caja Phase 5B',status:'active'});
const assignment=command('assignment_save',{membership_id:cashierMembership,register_id:register,status:'active',version:null}).target_id;
const sid=sql(claims(users[1])+`select session_id from open_register_session('${register}','${assignment}',10000,'${randomUUID()}');`);
const student=randomUUID(),studentPerson=randomUUID(),customer=randomUUID();
sql(`insert into persons(id,display_name) values('${studentPerson}','Estudiante Ficticio Phase 5B');insert into students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name) values('${student}','${account}','${school}','${studentPerson}','WALLET-5B','Estudiante','Ficticio Phase 5B','Estudiante Ficticio Phase 5B');insert into student_enrollments(account_id,school_id,student_id,starts_on) values('${account}','${school}','${student}','2026-01-01');insert into school_cafeteria_shares(account_id,school_id,cafeteria_id,status) values('${account}','${school}','${cafe}','active');insert into school_cafeteria_share_categories(account_id,school_id,cafeteria_id,share_id,category,enabled) select account_id,school_id,cafeteria_id,id,'basic_identification',true from school_cafeteria_shares where cafeteria_id='${cafe}';insert into cafeteria_customers(id,account_id,school_id,cafeteria_id,student_id) values('${customer}','${account}','${school}','${cafe}','${student}');`);
const initial=JSON.parse(sql(claims(users[0])+`select school_wallet_replenish('${school}','${student}',10000,'${randomUUID()}','Fixture inicial','Fondos ficticios verificados');`));
const body={request_key:randomUUID(),register_session_id:sid,cafeteria_customer_id:customer,expected_total_minor:'5000',items:[{product_id:product,quantity:1,expected_product_version:1,expected_unit_price_minor:'5000'}],tender:{type:'student_wallet'}};
sql(claims(users[1])+`select checkout_purchase('${JSON.stringify(body)}');`);
rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
for(const name of ['package.json','tsconfig.base.json','packages','apps/web'])cpSync(resolve(root,name),resolve(stage,name),{recursive:true,filter:p=>!['/.next','/node_modules','/.env','/test-results','/playwright-report'].some(x=>p.includes(x))});
symlinkSync(resolve(root,'node_modules'),resolve(stage,'node_modules'),'dir');
writeFileSync(resolve(stage,'apps/web/lib/supabase/config.ts'),`// LOCAL ONLY isolated test adapter.\nexport function getSupabasePublicConfig(){if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55641'||process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF!=='pikas-4d6')throw Error('Local endpoint required');return {url:'http://127.0.0.1:55641',anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!};}`);
const env={...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.ANON_KEY,NEXT_PUBLIC_SUPABASE_PROJECT_REF:'pikas-4d6',PIKAS_APP_ORIGIN:base};
console.log('Building isolated production-mode Phase 5B browser application');
try{writeFileSync(resolve(stage,'build.log'),execFileSync(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:resolve(stage,'apps/web'),env,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));}catch(e){writeFileSync(resolve(stage,'build-error.log'),String(e.stdout)+'\n'+String(e.stderr));throw Error(`Build failed: ${stage}/build-error.log`);}
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'start','--hostname','localhost','--port','3096'],{cwd:resolve(stage,'apps/web'),env,stdio:['ignore','pipe','pipe']});
let log='',browser,debugPage;server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local server unavailable');}
 browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage(),errors=[];debugPage=page;page.on('pageerror',e=>errors.push(e.message));
 async function login(p,email){await p.goto(base+'/login');await p.getByLabel('Correo electrónico',{exact:true}).fill(email);await p.getByLabel('Contraseña',{exact:true}).fill(password);const response=p.waitForResponse(r=>r.url().endsWith('/api/auth/login'));await p.getByRole('button',{name:'Iniciar sesión',exact:true}).click();const r=await response;assert.equal(r.status(),303);const target=new URL(r.headers().location);assert.equal(target.origin,base);await p.goto(target.href,{waitUntil:'domcontentloaded'});}
 await login(page,emails[0]);await page.goto(`${base}/admin/escuela/estudiantes?school=${school}`);
 await page.getByRole('link',{name:'PIKAS Cash de Estudiante Ficticio Phase 5B',exact:true}).click();
 await page.getByText('Saldo después: RD$ 50.00',{exact:true}).waitFor();
 await page.getByText('Recarga verificada · +RD$ 100.00',{exact:true}).waitFor();
 await page.getByText('Compra · −RD$ 50.00',{exact:true}).waitFor();
 await page.getByText('Recibo #1',{exact:false}).click();await page.getByText('1 × Agua ficticia Phase 5B',{exact:false}).waitFor();
 await page.getByLabel('Monto de recarga (RD$)',{exact:true}).fill('25');await page.getByLabel('Referencia de fondos verificados',{exact:true}).fill('Referencia local 5B');
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(stage,`wallet-before-${width}.png`),fullPage:true});}
 await page.setViewportSize({width:390,height:1000});const confirm=page.getByRole('button',{name:'Confirmar recarga verificada',exact:true});await confirm.scrollIntoViewIfNeeded();const buttonBox=await confirm.boundingBox(),navBox=await page.getByRole('navigation',{name:'Administración escolar móvil',exact:true}).boundingBox(),headerBox=await page.locator('header:visible').first().boundingBox();assert.ok(buttonBox&&navBox&&headerBox&&buttonBox.y>=headerBox.y+headerBox.height&&buttonBox.y+buttonBox.height<=navBox.y,'Mobile funding button must be unobstructed');
 let lost=true,denied=true;const requests=[];await page.route('**/api/school/wallet',async route=>{const body=route.request().postDataJSON();if(body.operation!=='replenish'){await route.continue();return;}requests.push(body);if(lost){lost=false;const response=await route.fetch();assert.equal(response.status(),200,await response.text());await route.abort();}else if(denied){denied=false;await route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'wallet_authority_required'})});}else await route.continue();});
 let confirmationCount=0;page.on('dialog',async dialog=>{confirmationCount++;assert.match(dialog.message(),/RD\$ 25.00/);await dialog.accept();});
 await confirm.click();await page.getByRole('button',{name:'Recuperar misma recarga',exact:true}).waitFor();
 assert.equal(sql(`select current_balance_minor from student_wallets where id='${initial.wallet_id}'`),'7500');
 await page.getByRole('button',{name:'Recuperar misma recarga',exact:true}).click();await page.getByText('Resultado pendiente de confirmar.',{exact:false}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Recuperar misma recarga',exact:true}).waitFor();assert.equal(await page.getByLabel('Monto de recarga (RD$)',{exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Recuperar misma recarga',exact:true}).click();await page.getByText('Recarga confirmada. Saldo al registrar: RD$ 75.00.',{exact:true}).waitFor();
 assert.equal(confirmationCount,1);assert.equal(requests.length,3);assert.deepEqual(requests[0],requests[1]);assert.deepEqual(requests[0],requests[2]);
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pikas:wallet:')).length),0);
 await page.reload();await page.getByText('Saldo después: RD$ 75.00',{exact:true}).waitFor();
 assert.equal(sql(`select count(*) from wallet_replenishments where wallet_id='${initial.wallet_id}'`),'2');
 assert.equal(sql(`select count(*) from purchases where student_id='${student}'`),'1');
 assert.equal(sql(`select pikas_private.register_cash_summary('${sid}')->>'expected_minor'`),'10000');
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(stage,`wallet-after-${width}.png`),fullPage:true});}
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(stage,'verification.json'),JSON.stringify({mode:'production',viewports:[390,768,1440],student,wallet:initial.wallet_id,initialBalance:'5000',credited:'2500',finalBalance:'7500',purchaseDebit:'5000',lostSuccessRecovered:true,recovery403Retained:true,reloadedPending:true,identicalAttempts:3,registerExpected:'10000',pageErrors:errors},null,2));
 console.log('PASS production browser: student → balance/history/purchase → explicit confirmed credit → lost success → denied retry retained → reload → exact recovery → durable balance/history; 390/768/1440px, no overflow/page errors.');
}finally{if(debugPage){writeFileSync(resolve(stage,'last-page.txt'),await debugPage.locator('body').innerText().catch(()=>''));await debugPage.screenshot({path:resolve(stage,'last-page.png'),fullPage:true}).catch(()=>{});}if(browser)await browser.close();server.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
