// LOCAL ONLY production-mode check of the Beta wallet authority (202610170001).
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {cpSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),stage='/private/tmp/pikas-phase5b-authority-browser',base='http://localhost:3097';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
assert.equal(execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],{encoding:'utf8'}).trim(),'pikas-4d6');
const config=JSON.parse(execFileSync(resolve(root,'node_modules/.bin/supabase'),['--workdir','/private/tmp/pikas-4d6-local','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(config.API_URL,'http://127.0.0.1:55641');
const sql=q=>execFileSync(docker,['exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
assert.ok(sql('select max(version) from supabase_migrations.schema_migrations')>='202610170001');
const provider=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const tag=randomUUID().slice(0,8),password='Local-5B-fictional-only-417!',emails=[`auth5b-account-${tag}@example.invalid`,`auth5b-cafe-${tag}@example.invalid`],users=[];
const [account,school,school2,location,location2,cafe,cafe2,adminPerson,cafePerson,student,studentPerson,student2,student2Person,customer,customer2]=Array.from({length:15},()=>randomUUID());
for(const email of emails){const created=await provider.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null);users.push(created.data.user.id);}
// Account Admin holds only an account_admin membership, as initial-customer provisioning creates.
sql(`insert into persons(id,auth_user_id,display_name) values('${adminPerson}','${users[0]}','Administrador Ficticio Cuenta 5B'),('${cafePerson}','${users[1]}','Administradora Ficticia Cafetería 5B');`);
sql(`insert into persons(id,display_name) values('${studentPerson}','Sol Ficticia Autoridad'),('${student2Person}','Luna Ficticia Otra Escuela');
insert into accounts(id,code,name) values('${account}','AUTH5B-${tag}','Cuenta Ficticia Autoridad 5B');
insert into schools(id,account_id,code,name) values('${school}','${account}','S1','Escuela Ficticia Autoridad 5B'),('${school2}','${account}','S2','Escuela Ficticia Hermana 5B');
insert into school_locations(id,account_id,school_id,code,name) values('${location}','${account}','${school}','L1','Sede Ficticia'),('${location2}','${account}','${school2}','L2','Sede Hermana');
insert into cafeterias(id,account_id,school_id,school_location_id,code,name) values('${cafe}','${account}','${school}','${location}','C1','Cafetería Ficticia Autoridad 5B'),('${cafe2}','${account}','${school2}','${location2}','C2','Cafetería Ficticia Hermana 5B');
insert into account_memberships(account_id,person_id,role_code) values('${account}','${adminPerson}','account_admin');
insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code) values('${account}','${school}','${cafe}','${cafePerson}','cafeteria_admin');
insert into students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name) values('${student}','${account}','${school}','${studentPerson}','AUTH-5B-1','Sol','Ficticia Autoridad','Sol Ficticia Autoridad'),('${student2}','${account}','${school2}','${student2Person}','AUTH-5B-2','Luna','Ficticia Otra Escuela','Luna Ficticia Otra Escuela');
insert into student_enrollments(account_id,school_id,student_id,starts_on) values('${account}','${school}','${student}','2026-01-01'),('${account}','${school2}','${student2}','2026-01-01');
insert into school_cafeteria_shares(account_id,school_id,cafeteria_id,status) values('${account}','${school}','${cafe}','active'),('${account}','${school2}','${cafe2}','active');
insert into school_cafeteria_share_categories(account_id,school_id,cafeteria_id,share_id,category,enabled) select account_id,school_id,cafeteria_id,id,'basic_identification',true from school_cafeteria_shares where account_id='${account}';
insert into cafeteria_customers(id,account_id,school_id,cafeteria_id,student_id) values('${customer}','${account}','${school}','${cafe}','${student}'),('${customer2}','${account}','${school2}','${cafe2}','${student2}');`);
assert.equal(sql(`select count(*) from student_wallets where student_id='${student}'`),'0');
rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
for(const name of ['package.json','tsconfig.base.json','packages','apps/web'])cpSync(resolve(root,name),resolve(stage,name),{recursive:true,filter:p=>!['/.next','/node_modules','/.env','/test-results','/playwright-report'].some(x=>p.includes(x))});
symlinkSync(resolve(root,'node_modules'),resolve(stage,'node_modules'),'dir');
writeFileSync(resolve(stage,'apps/web/lib/supabase/config.ts'),`// LOCAL ONLY isolated test adapter.\nexport function getSupabasePublicConfig(){if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55641'||process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF!=='pikas-4d6')throw Error('Local endpoint required');return {url:'http://127.0.0.1:55641',anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!};}`);
const env={...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.ANON_KEY,NEXT_PUBLIC_SUPABASE_PROJECT_REF:'pikas-4d6',PIKAS_APP_ORIGIN:base};
console.log('Building isolated production-mode authority browser application');
try{writeFileSync(resolve(stage,'build.log'),execFileSync(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:resolve(stage,'apps/web'),env,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));}catch(e){writeFileSync(resolve(stage,'build-error.log'),String(e.stdout)+'\n'+String(e.stderr));throw Error(`Build failed: ${stage}/build-error.log`);}
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'start','--hostname','localhost','--port','3097'],{cwd:resolve(stage,'apps/web'),env,stdio:['ignore','pipe','pipe']});
let log='',browser,debugPage;server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local server unavailable');}
 browser=await chromium.launch({headless:true});const errors=[];
 async function session(email){const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),p=await ctx.newPage();debugPage=p;p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/login');await p.getByLabel('Correo electrónico',{exact:true}).fill(email);await p.getByLabel('Contraseña',{exact:true}).fill(password);const response=p.waitForResponse(r=>r.url().endsWith('/api/auth/login'));await p.getByRole('button',{name:'Iniciar sesión',exact:true}).click();const r=await response;assert.equal(r.status(),303);await p.goto(new URL(r.headers().location).href,{waitUntil:'domcontentloaded'});return p;}
 const overflow=p=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
 // Account Admin: roster -> wallet -> first verified credit opens the wallet -> persisted.
 const page=await session(emails[0]);
 await page.goto(`${base}/admin/escuela/estudiantes?school=${school}`);
 await page.getByRole('link',{name:'PIKAS Cash de Sol Ficticia Autoridad',exact:true}).click();
 await page.getByText('No hay movimientos registrados.',{exact:true}).waitFor();
 assert.equal(await page.locator('section.card p.text-3xl').innerText(),'RD$ 0.00');
 await page.getByLabel('Monto de recarga (RD$)',{exact:true}).fill('25');await page.getByLabel('Referencia de fondos verificados',{exact:true}).fill('Referencia local autoridad 5B');
 let confirmations=0;page.on('dialog',async d=>{confirmations++;assert.match(d.message(),/RD\$ 25.00/);await d.accept();});
 await page.setViewportSize({width:390,height:1000});assert.ok(await overflow(page));
 await page.getByRole('button',{name:'Confirmar recarga verificada',exact:true}).click();
 await page.getByText('Recarga confirmada. Saldo al registrar: RD$ 25.00.',{exact:true}).waitFor();
 await page.reload();await page.getByText('Recarga verificada · +RD$ 25.00',{exact:true}).waitFor();
 assert.equal(await page.getByText('Recarga verificada · +RD$ 25.00',{exact:true}).count(),1);
 assert.equal(await page.getByText('Administrador Ficticio Cuenta 5B',{exact:false}).count()>0,true);
 await page.screenshot({path:resolve(stage,'account-admin-390.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:resolve(stage,'account-admin-1440.png'),fullPage:true});
 assert.equal(confirmations,1);
 assert.equal(sql(`select count(*) from wallet_replenishments r join student_wallets w on w.id=r.wallet_id where w.student_id='${student}'`),'1');
 assert.equal(sql(`select current_balance_minor::text||'/'||(select sum(amount_minor) from wallet_ledger_entries l where l.wallet_id=w.id) from student_wallets w where student_id='${student}'`),'2500/2500');
 assert.equal(sql(`select string_agg(distinct actor_role,',') from audit_events where account_id='${account}' and action in ('wallet_created','wallet_replenishment_posted')`),'account_admin');
 assert.equal(sql(`select count(*) from register_sessions where cafeteria_id in ('${cafe}','${cafe2}')`),'0');
 // Cafeteria Admin: scoped read-only balance, no mutation controls, unrelated school denied.
 const cafePage=await session(emails[1]);
 await cafePage.goto(`${base}/admin/cafeteria/escuelas?cafeteria=${cafe}`);
 await cafePage.getByRole('heading',{name:'Saldo PIKAS Cash de clientes',exact:true}).waitFor();
 await cafePage.getByRole('button',{name:'Consultar saldo',exact:true}).click();
 const list=cafePage.getByRole('list',{name:'Saldos PIKAS Cash',exact:true});await list.waitFor();
 assert.match(await list.innerText(),/Sol Ficticia Autoridad\s+RD\$ 25\.00/);
 assert.doesNotMatch(await cafePage.locator('main').innerText(),/Luna Ficticia Otra Escuela|Monto de recarga|Confirmar recarga/);
 await cafePage.getByLabel('Buscar cliente por nombre',{exact:true}).fill('Luna');await cafePage.getByRole('button',{name:'Consultar saldo',exact:true}).click();
 await cafePage.getByText('No hay clientes compartidos que coincidan.',{exact:true}).waitFor();
 const denied=await cafePage.evaluate(async c=>{const r=await fetch('/api/cafeteria/wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cafeteria_id:c,query:''})});return r.status;},cafe2);
 assert.equal(denied,403);
 const school403=await cafePage.evaluate(async([s,st])=>{const r=await fetch('/api/school/wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'read',school_id:s,student_id:st,before:null})});return r.status;},[school,student]);
 assert.ok([401,403].includes(school403));
 for(const width of [390,1440]){await cafePage.setViewportSize({width,height:1000});assert.ok(await overflow(cafePage));await cafePage.screenshot({path:resolve(stage,`cafeteria-admin-${width}.png`),fullPage:true});}
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(stage,'verification.json'),JSON.stringify({mode:'production',accountAdminOnlyMembership:true,walletOpenedByFirstCredit:true,credited:'2500',finalBalance:'2500',replenishments:1,confirmations,auditRole:'account_admin',cafeteriaReadOnly:true,unrelatedSchoolHidden:true,otherCafeteriaApi:denied,cafeteriaSchoolWalletApi:school403,registerSessions:0,pageErrors:errors},null,2));
 console.log('PASS authority browser: account-admin-only roster → PIKAS Cash → first verified credit opened wallet → RD$25.00 persisted once; cafeteria admin read-only scoped balance, unrelated school hidden/denied; 390/1440px, no overflow/page errors.');
}finally{if(debugPage){writeFileSync(resolve(stage,'last-page.txt'),await debugPage.locator('body').innerText().catch(()=>''));await debugPage.screenshot({path:resolve(stage,'last-page.png'),fullPage:true}).catch(()=>{});}if(browser)await browser.close();server.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
