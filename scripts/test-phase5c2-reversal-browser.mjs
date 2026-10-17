// LOCAL ONLY production-mode check of Phase 5C.2 replenishment reversals (202610190001).
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {cpSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),stage='/private/tmp/pikas-phase5c2-browser',base='http://localhost:3099';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
assert.equal(execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],{encoding:'utf8'}).trim(),'pikas-4d6');
const config=JSON.parse(execFileSync(resolve(root,'node_modules/.bin/supabase'),['--workdir','/private/tmp/pikas-4d6-local','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(config.API_URL,'http://127.0.0.1:55641');
const sql=q=>execFileSync(docker,['exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
const sqlFails=q=>{try{sql(q);return '';}catch(e){return String(e.stderr);}};
assert.ok(sql('select max(version) from supabase_migrations.schema_migrations')>='202610190001');
const provider=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const tag=randomUUID().slice(0,8),password='Local-5C2-fictional-only-731!',emails=[`reversal-admin-${tag}@example.invalid`,`reversal-cashier-${tag}@example.invalid`],users=[];
const [account,school,location,cafe,adminPerson,cashierPerson,cashierMembership,register,product,student,studentPerson,customer]=Array.from({length:12},()=>randomUUID());
for(const email of emails){const created=await provider.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null);users.push(created.data.user.id);}
sql(`insert into persons(id,auth_user_id,display_name) values('${adminPerson}','${users[0]}','Administradora Ficticia Reversiones'),('${cashierPerson}','${users[1]}','Cajero Ficticio Reversiones');
insert into persons(id,display_name) values('${studentPerson}','Sol Ficticia Reversión');
insert into accounts(id,code,name) values('${account}','R5C2-${tag}','Cuenta Ficticia Reversiones');
insert into schools(id,account_id,code,name) values('${school}','${account}','S','Escuela Ficticia Reversiones');
insert into school_locations(id,account_id,school_id,code,name) values('${location}','${account}','${school}','L','Sede Ficticia');
insert into cafeterias(id,account_id,school_id,school_location_id,code,name) values('${cafe}','${account}','${school}','${location}','C','Cafetería Ficticia Reversiones');
insert into school_memberships(account_id,school_id,person_id,role_code) values('${account}','${school}','${adminPerson}','school_admin');
insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code) values('${account}','${school}','${cafe}','${adminPerson}','cafeteria_admin');
insert into cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values('${cashierMembership}','${account}','${school}','${cafe}','${cashierPerson}','pos_cashier');
insert into students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name) values('${student}','${account}','${school}','${studentPerson}','R5C2','Sol','Ficticia Reversión','Sol Ficticia Reversión');
insert into student_enrollments(account_id,school_id,student_id,starts_on) values('${account}','${school}','${student}','2026-01-01');
insert into school_cafeteria_shares(account_id,school_id,cafeteria_id,status) values('${account}','${school}','${cafe}','active');
insert into school_cafeteria_share_categories(account_id,school_id,cafeteria_id,share_id,category,enabled) select account_id,school_id,cafeteria_id,id,'basic_identification',true from school_cafeteria_shares where cafeteria_id='${cafe}';
insert into cafeteria_customers(id,account_id,school_id,cafeteria_id,student_id) values('${customer}','${account}','${school}','${cafe}','${student}');`);
const claims=u=>`set request.jwt.claim.sub='${u}';set role authenticated;`;
const command=(operation,payload)=>JSON.parse(sql(claims(users[0])+`select cafeteria_admin_command('${cafe}','${randomUUID()}','${operation}','${JSON.stringify(payload)}');`));
command('product_save',{id:product,version:null,name:'Agua ficticia 5C2',description:'Fixture local',category:'Bebidas',price_minor:5000,unit:'botella',active:true,available:true,ingredients:[],allergens:[]});
command('register_save',{id:register,version:null,code:'R5C2',name:'Caja Reversiones',status:'active'});
const assignment=command('assignment_save',{membership_id:cashierMembership,register_id:register,status:'active',version:null}).target_id;
const credit=(amount,reference)=>sql(claims(users[0])+`select school_wallet_replenish('${school}','${student}',${amount},'${randomUUID()}','${reference}','Fondos ficticios verificados');`);
credit(10000,'Recarga grande');credit(2500,'Recarga duplicada');
const sid=sql(claims(users[1])+`select session_id from open_register_session('${register}','${assignment}',0,'${randomUUID()}');`);
const sale=()=>`select checkout_purchase('${JSON.stringify({request_key:randomUUID(),register_session_id:sid,cafeteria_customer_id:customer,expected_total_minor:'5000',
 items:[{product_id:product,quantity:1,expected_product_version:1,expected_unit_price_minor:'5000'}],tender:{type:'student_wallet'}})}');`;
sql(claims(users[1])+sale());
const balance=()=>sql(`select current_balance_minor from student_wallets where student_id='${student}'`);
const expectedCash=()=>sql(`select pikas_private.register_cash_summary('${sid}')->>'expected_minor'`);
assert.equal(balance(),'7500');assert.equal(expectedCash(),'0');
rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
for(const name of ['package.json','tsconfig.base.json','packages','apps/web'])cpSync(resolve(root,name),resolve(stage,name),{recursive:true,filter:p=>!['/.next','/node_modules','/.env','/test-results','/playwright-report'].some(x=>p.includes(x))});
symlinkSync(resolve(root,'node_modules'),resolve(stage,'node_modules'),'dir');
writeFileSync(resolve(stage,'apps/web/lib/supabase/config.ts'),`// LOCAL ONLY isolated test adapter.\nexport type SupabasePublicConfig={url:string;anonKey:string};\nexport function getSupabasePublicConfig():SupabasePublicConfig{if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55641'||process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF!=='pikas-4d6')throw Error('Local endpoint required');return {url:'http://127.0.0.1:55641',anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!};}`);
const env={...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.ANON_KEY,NEXT_PUBLIC_SUPABASE_PROJECT_REF:'pikas-4d6',PIKAS_APP_ORIGIN:base};
console.log('Building isolated production-mode reversal browser application');
try{writeFileSync(resolve(stage,'build.log'),execFileSync(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:resolve(stage,'apps/web'),env,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));}catch(e){writeFileSync(resolve(stage,'build-error.log'),String(e.stdout)+'\n'+String(e.stderr));throw Error(`Build failed: ${stage}/build-error.log`);}
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'start','--hostname','localhost','--port','3099'],{cwd:resolve(stage,'apps/web'),env,stdio:['ignore','pipe','pipe']});
let log='',browser,page;server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local server unavailable');}
 browser=await chromium.launch({headless:true});const errors=[];
 page=await (await browser.newContext({viewport:{width:1440,height:1000}})).newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/login');await page.getByLabel('Correo electrónico',{exact:true}).fill(emails[0]);await page.getByLabel('Contraseña',{exact:true}).fill(password);
 const login=page.waitForResponse(r=>r.url().endsWith('/api/auth/login'));await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
 await page.goto(new URL((await login).headers().location).href,{waitUntil:'domcontentloaded'});
 // 1-2. Authorized administrator opens the wallet; eligible replenishments offer reversal.
 await page.goto(`${base}/admin/escuela/estudiantes?school=${school}`);
 await page.getByRole('link',{name:'PIKAS Cash de Sol Ficticia Reversión',exact:true}).click();
 await page.getByText('Recarga verificada · +RD$ 25.00',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Revertir recarga',exact:true}).count(),2);
 const card=text=>page.locator('article',{has:page.getByText(text,{exact:true})});
 // 3-4. Modal shows original amount and preview; normal reversal succeeds.
 await card('Recarga verificada · +RD$ 25.00').getByRole('button',{name:'Revertir recarga',exact:true}).click();
 let dialog=page.getByRole('dialog');await dialog.waitFor();
 await dialog.getByText('Saldo resultante',{exact:true}).waitFor();assert.match(await dialog.innerText(),/RD\$ 25\.00[\s\S]*Recarga duplicada[\s\S]*RD\$ 75\.00[\s\S]*RD\$ 50\.00/);
 assert.equal(await dialog.getByRole('alert').count(),0,'No negative warning for a covered reversal');
 await dialog.getByLabel('Motivo de la reversión',{exact:true}).selectOption({label:'Recarga duplicada'});
 await dialog.getByRole('button',{name:'Confirmar reversión de RD$ 25.00',exact:true}).click();
 await page.getByText('Reversión de recarga · −RD$ 25.00',{exact:true}).waitFor();
 // 5-6. Original and reversal both shown; reversed original no longer offers reversal.
 await card('Recarga verificada · +RD$ 25.00').getByText('Revertida · Recarga duplicada',{exact:true}).waitFor();
 assert.equal(await card('Recarga verificada · +RD$ 25.00').getByRole('button',{name:'Revertir recarga'}).count(),0);
 assert.equal(balance(),'5000');
 // 7-8. Reversal of RD$100 after spending: warns, does not block, balance becomes negative and visible.
 await page.setViewportSize({width:390,height:900});
 await card('Recarga verificada · +RD$ 100.00').getByRole('button',{name:'Revertir recarga',exact:true}).click();
 dialog=page.getByRole('dialog');await dialog.waitFor();
 await dialog.getByText('El saldo quedará negativo (−RD$ 50.00).',{exact:false}).waitFor();
 await dialog.getByLabel('Motivo de la reversión',{exact:true}).selectOption({label:'Otro'});
 assert.equal(await dialog.getByRole('button',{name:/Confirmar reversión/}).isDisabled(),true,'Otro requires explanation');
 await dialog.getByLabel('Explica el motivo',{exact:true}).fill('Fondos acreditados a estudiante equivocado');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(stage,'reversal-modal-390.png'),fullPage:true});
 await dialog.getByRole('button',{name:'Confirmar reversión de RD$ 100.00',exact:true}).click();
 await page.getByText('Reversión de recarga · −RD$ 100.00',{exact:true}).waitFor();
 await page.getByText('Saldo negativo. No se pueden pagar compras con PIKAS Cash hasta que nuevas recargas cubran el saldo.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Revertir recarga',exact:true}).count(),0);
 await page.reload();await page.getByText('Reversión de recarga · −RD$ 100.00',{exact:true}).waitFor();
 assert.equal(await page.locator('section.card p.text-3xl').first().innerText(),'−RD$ 50.00');
 // 9. Insufficient PIKAS Cash purchase stays blocked; register cash untouched.
 assert.match(sqlFails(claims(users[1])+sale()),/INSUFFICIENT_BALANCE/);
 assert.equal(balance(),'-5000');assert.equal(expectedCash(),'0');
 assert.equal(sql(`select string_agg(reason||':'||actor_role,',' order by reversed_at) from wallet_replenishment_reversals v join student_wallets w on w.id=v.wallet_id where w.student_id='${student}'`),'duplicate_replenishment:school_admin,other:school_admin');
 // 10. Responsive changed surfaces.
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(stage,`wallet-reversal-${width}.png`),fullPage:true});}
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(stage,'verification.json'),JSON.stringify({mode:'production',balance:'7500→5000→-5000',normalReversal:'2500',negativeReversal:'10000',negativeWarning:true,
  otroRequiresText:true,actionRemoved:true,purchaseBlocked:true,registerExpected:'0',widths:[390,768,1440],pageErrors:errors},null,2));
 console.log('PASS reversal browser: wallet → reversal action → preview → normal reversal → original+reversal in history → action removed → negative reversal with warning → negative state persists → PIKAS Cash purchase blocked; register cash unchanged; 390/768/1440px.');
}finally{if(page){writeFileSync(resolve(stage,'last-page.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:resolve(stage,'last-page.png'),fullPage:true}).catch(()=>{});}if(browser)await browser.close();server.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
