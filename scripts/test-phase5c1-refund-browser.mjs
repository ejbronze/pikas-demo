// LOCAL ONLY production-mode check of Phase 5C.1 POS refunds (202610180001).
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {cpSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),stage='/private/tmp/pikas-phase5c1-browser',base='http://localhost:3098';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
assert.equal(execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],{encoding:'utf8'}).trim(),'pikas-4d6');
const config=JSON.parse(execFileSync(resolve(root,'node_modules/.bin/supabase'),['--workdir','/private/tmp/pikas-4d6-local','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(config.API_URL,'http://127.0.0.1:55641');
const sql=q=>execFileSync(docker,['exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
assert.ok(sql('select max(version) from supabase_migrations.schema_migrations')>='202610180001');
const provider=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const tag=randomUUID().slice(0,8),password='Local-5C1-fictional-only-582!',emails=[`refund-admin-${tag}@example.invalid`,`refund-cashier-${tag}@example.invalid`],users=[];
const [account,school,location,cafe,adminPerson,cashierPerson,cashierMembership,register,product,student,studentPerson,customer]=Array.from({length:12},()=>randomUUID());
for(const email of emails){const created=await provider.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null);users.push(created.data.user.id);}
sql(`insert into persons(id,auth_user_id,display_name) values('${adminPerson}','${users[0]}','Administradora Ficticia Reembolsos'),('${cashierPerson}','${users[1]}','Cajero Ficticio Reembolsos');
insert into persons(id,display_name) values('${studentPerson}','Sol Ficticia Reembolso');
insert into accounts(id,code,name) values('${account}','R5C1-${tag}','Cuenta Ficticia Reembolsos');
insert into schools(id,account_id,code,name) values('${school}','${account}','S','Escuela Ficticia Reembolsos');
insert into school_locations(id,account_id,school_id,code,name) values('${location}','${account}','${school}','L','Sede Ficticia');
insert into cafeterias(id,account_id,school_id,school_location_id,code,name) values('${cafe}','${account}','${school}','${location}','C','Cafetería Ficticia Reembolsos');
insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code) values('${account}','${school}','${cafe}','${adminPerson}','cafeteria_admin');
insert into cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values('${cashierMembership}','${account}','${school}','${cafe}','${cashierPerson}','pos_cashier');
insert into school_memberships(account_id,school_id,person_id,role_code) values('${account}','${school}','${adminPerson}','school_admin');
insert into students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name) values('${student}','${account}','${school}','${studentPerson}','R5C1','Sol','Ficticia Reembolso','Sol Ficticia Reembolso');
insert into student_enrollments(account_id,school_id,student_id,starts_on) values('${account}','${school}','${student}','2026-01-01');
insert into school_cafeteria_shares(account_id,school_id,cafeteria_id,status) values('${account}','${school}','${cafe}','active');
insert into school_cafeteria_share_categories(account_id,school_id,cafeteria_id,share_id,category,enabled) select account_id,school_id,cafeteria_id,id,'basic_identification',true from school_cafeteria_shares where cafeteria_id='${cafe}';
insert into cafeteria_customers(id,account_id,school_id,cafeteria_id,student_id) values('${customer}','${account}','${school}','${cafe}','${student}');`);
const claims=u=>`set request.jwt.claim.sub='${u}';set role authenticated;`;
const command=(operation,payload)=>JSON.parse(sql(claims(users[0])+`select cafeteria_admin_command('${cafe}','${randomUUID()}','${operation}','${JSON.stringify(payload)}');`));
command('product_save',{id:product,version:null,name:'Agua ficticia 5C1',description:'Fixture local',category:'Bebidas',price_minor:5000,unit:'botella',active:true,available:true,ingredients:[],allergens:[]});
command('register_save',{id:register,version:null,code:'R5C1',name:'Caja Reembolsos',status:'active'});
const assignment=command('assignment_save',{membership_id:cashierMembership,register_id:register,status:'active',version:null}).target_id;
sql(claims(users[0])+`select school_wallet_replenish('${school}','${student}',20000,'${randomUUID()}','Fixture local','Fondos ficticios verificados');`);
sql(claims(users[0])+`select configure_cashier_refund_limits('${cafe}',(get_cashier_refund_limits('${cafe}')->>'version')::integer,2,100000);`);
const sid=sql(claims(users[1])+`select session_id from open_register_session('${register}','${assignment}',10000,'${randomUUID()}');`);
const sale=(qty,tender)=>sql(claims(users[1])+`select checkout_purchase('${JSON.stringify({request_key:randomUUID(),register_session_id:sid,cafeteria_customer_id:customer,expected_total_minor:String(5000*qty),
 items:[{product_id:product,quantity:qty,expected_product_version:1,expected_unit_price_minor:'5000'}],tender:tender==='cash'?{type:'cash',cash_received_minor:String(5000*qty)}:{type:'student_wallet'}})}')->>'purchase_number';`);
const cashReceipt=sale(2,'cash'),walletReceipt=sale(2,'wallet');
const expected=()=>sql(`select pikas_private.register_cash_summary('${sid}')->>'expected_minor'`);
const balance=()=>sql(`select current_balance_minor from student_wallets where student_id='${student}'`);
assert.equal(expected(),'20000');assert.equal(balance(),'10000');
rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
for(const name of ['package.json','tsconfig.base.json','packages','apps/web'])cpSync(resolve(root,name),resolve(stage,name),{recursive:true,filter:p=>!['/.next','/node_modules','/.env','/test-results','/playwright-report'].some(x=>p.includes(x))});
symlinkSync(resolve(root,'node_modules'),resolve(stage,'node_modules'),'dir');
writeFileSync(resolve(stage,'apps/web/lib/supabase/config.ts'),`// LOCAL ONLY isolated test adapter.\nexport type SupabasePublicConfig={url:string;anonKey:string};\nexport function getSupabasePublicConfig():SupabasePublicConfig{if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55641'||process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF!=='pikas-4d6')throw Error('Local endpoint required');return {url:'http://127.0.0.1:55641',anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!};}`);
const env={...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.ANON_KEY,NEXT_PUBLIC_SUPABASE_PROJECT_REF:'pikas-4d6',PIKAS_APP_ORIGIN:base};
console.log('Building isolated production-mode refund browser application');
try{writeFileSync(resolve(stage,'build.log'),execFileSync(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:resolve(stage,'apps/web'),env,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));}catch(e){writeFileSync(resolve(stage,'build-error.log'),String(e.stdout)+'\n'+String(e.stderr));throw Error(`Build failed: ${stage}/build-error.log`);}
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'start','--hostname','localhost','--port','3098'],{cwd:resolve(stage,'apps/web'),env,stdio:['ignore','pipe','pipe']});
let log='',browser,page;server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local server unavailable');}
 browser=await chromium.launch({headless:true});const errors=[];
 page=await (await browser.newContext({viewport:{width:390,height:900}})).newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/login');await page.getByLabel('Correo electrónico',{exact:true}).fill(emails[1]);await page.getByLabel('Contraseña',{exact:true}).fill(password);
 const login=page.waitForResponse(r=>r.url().endsWith('/api/auth/login'));await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
 await page.goto(new URL((await login).headers().location).href,{waitUntil:'domcontentloaded'});
 await page.goto(base+'/pos',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Reembolsos',exact:true}).click();
 const lookup=async receipt=>{await page.getByLabel('Número de recibo',{exact:true}).fill(receipt);await page.getByRole('button',{name:'Buscar recibo',exact:true}).click();await page.getByRole('heading',{name:new RegExp(`Recibo #${receipt}`)}).first().waitFor();};
 const openModal=async(qty,reason,notes)=>{await page.getByRole('button',{name:'Reembolsar',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();
  await dialog.getByLabel(/Cantidad a reembolsar/).fill(String(qty));await dialog.getByLabel('Motivo del reembolso',{exact:true}).selectOption({label:reason});
  if(notes!==undefined){assert.equal(await dialog.getByRole('button',{name:/Confirmar reembolso/}).isDisabled(),true,'Otro requires text');await dialog.getByLabel('Explica el motivo',{exact:true}).fill(notes);}
  return dialog;};
 // 1-2. Cashier partial cash refund inside the window: clear amount, current register pays out.
 await lookup(cashReceipt);
 let dialog=await openModal(1,'Otro','Cliente devolvió botella');
 await dialog.getByText('Entrega RD$ 50.00 en efectivo desde esta caja.',{exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(stage,'refund-modal-390.png'),fullPage:true});
 await dialog.getByRole('button',{name:'Confirmar reembolso de RD$ 50.00',exact:true}).click();
 await page.getByText(/Reembolso #1 confirmado · RD\$ 50\.00 · Efectivo\. Pendiente en el recibo: RD\$ 50\.00\./).waitFor();
 await page.getByText('1 reembolsado(s) · 1 disponible(s)',{exact:true}).waitFor();
 assert.equal(expected(),'15000');
 // 4. Wallet refund returns funds to PIKAS Cash and leaves register cash unchanged.
 await lookup(walletReceipt);
 dialog=await openModal(1,'Problema de calidad');
 await dialog.getByText('Se devolverán RD$ 50.00 al PIKAS Cash de Sol Ficticia Reembolso.',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Confirmar reembolso de RD$ 50.00',exact:true}).click();
 await page.getByText(/Reembolso #1 confirmado · RD\$ 50\.00 · PIKAS Cash/).waitFor();
 assert.equal(balance(),'15000');assert.equal(expected(),'15000');
 // 3. Count limit reached (2 per day): override authorized on the same device by the Cafeteria Admin.
 await lookup(cashReceipt);
 dialog=await openModal(1,'Cobro duplicado');
 await dialog.getByRole('button',{name:'Confirmar reembolso de RD$ 50.00',exact:true}).click();
 await dialog.getByText('Se alcanzó el límite diario de reembolsos del cajero',{exact:true}).waitFor();
 await page.screenshot({path:resolve(stage,'refund-override-390.png'),fullPage:true});
 await dialog.getByLabel('Correo de quien autoriza',{exact:true}).fill(emails[1]);await dialog.getByLabel('Contraseña de quien autoriza',{exact:true}).fill(password);
 await dialog.getByRole('button',{name:'Autorizar y reembolsar',exact:true}).click();
 await dialog.getByText('Esa persona no puede autorizar reembolsos en esta cafetería.',{exact:true}).waitFor();
 await dialog.getByLabel('Correo de quien autoriza',{exact:true}).fill(emails[0]);await dialog.getByLabel('Contraseña de quien autoriza',{exact:true}).fill(password);
 await dialog.getByRole('button',{name:'Autorizar y reembolsar',exact:true}).click();
 await page.getByText(/Reembolso #2 confirmado · RD\$ 50\.00 · Efectivo · autorizado\. Pendiente en el recibo: RD\$ 0\.00\./).waitFor();
 // 7. Cumulative state is clear; the cashier session survived the override.
 await page.getByText('2 reembolsado(s) · 0 disponible(s)',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Reembolsar',exact:true}).isDisabled(),true);
 await page.reload();await page.getByRole('button',{name:'Reembolsos',exact:true}).click();await page.getByLabel('Número de recibo',{exact:true}).waitFor();await lookup(cashReceipt);
 await page.getByText('Reembolsos anteriores: #1 RD$ 50.00 · #2 RD$ 50.00',{exact:true}).waitFor();
 assert.equal(expected(),'10000');
 assert.equal(sql(`select string_agg(authorization_mode||':'||coalesce(approver_role_code,'-')||':'||array_to_string(override_reasons,'|')||':'||(select auth_user_id::text from persons where id=actor_person_id),',' order by occurred_at) from refunds where cafeteria_id='${cafe}'`),
  `independent:-::${users[1]},independent:-::${users[1]},supervisor_approved:cafeteria_admin:count_limit:${users[1]}`);
 for(const width of [768,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(stage,`refund-state-${width}.png`),fullPage:true});}
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(stage,'verification.json'),JSON.stringify({mode:'production',cashPartialIndependent:true,walletRefundToPikasCash:true,expectedCash:'20000→15000→15000→10000',walletBalance:'10000→15000',
  overrideRequired:'count_limit',invalidApproverRejected:true,approver:'cafeteria_admin',initiator:'cashier',cumulativeVisible:true,widths:[390,768,1440],pageErrors:errors},null,2));
 console.log('PASS refund browser: cashier partial cash refund in window → wallet refund to PIKAS Cash → count-limit override by Cafeteria Admin on same device (invalid approver rejected) → cumulative state; register expected 20000→10000; 390/768/1440px.');
}finally{if(page){writeFileSync(resolve(stage,'last-page.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:resolve(stage,'last-page.png'),fullPage:true}).catch(()=>{});}if(browser)await browser.close();server.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
