// LOCAL ONLY production-mode check of Phase 5C.3 administrative wallet adjustments (202610200001).
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {cpSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),stage='/private/tmp/pikas-phase5c3-browser',base='http://localhost:3100';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
assert.equal(execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],{encoding:'utf8'}).trim(),'pikas-4d6');
const config=JSON.parse(execFileSync(resolve(root,'node_modules/.bin/supabase'),['--workdir','/private/tmp/pikas-4d6-local','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(config.API_URL,'http://127.0.0.1:55641');
const sql=q=>execFileSync(docker,['exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
assert.ok(sql('select max(version) from supabase_migrations.schema_migrations')>='202610200001');
const provider=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const tag=randomUUID().slice(0,8),password='Local-5C3-fictional-only-264!',emails=[`adjust-school-${tag}@example.invalid`,`adjust-cafe-${tag}@example.invalid`],users=[];
const [account,school,location,cafe,schoolPerson,cafePerson,student,studentPerson,student2,student2Person,customer]=Array.from({length:11},()=>randomUUID());
for(const email of emails){const created=await provider.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null);users.push(created.data.user.id);}
sql(`insert into persons(id,auth_user_id,display_name) values('${schoolPerson}','${users[0]}','Directora Ficticia Ajustes'),('${cafePerson}','${users[1]}','Administrador Ficticio Cafetería Ajustes');
insert into persons(id,display_name) values('${studentPerson}','Sol Ficticia Ajuste'),('${student2Person}','Luna Ficticia Sin Cafetería');
insert into accounts(id,code,name) values('${account}','A5C3-${tag}','Cuenta Ficticia Ajustes');
insert into schools(id,account_id,code,name) values('${school}','${account}','S','Escuela Ficticia Ajustes');
insert into school_locations(id,account_id,school_id,code,name) values('${location}','${account}','${school}','L','Sede Ficticia');
insert into cafeterias(id,account_id,school_id,school_location_id,code,name) values('${cafe}','${account}','${school}','${location}','C','Cafetería Ficticia Ajustes');
insert into school_memberships(account_id,school_id,person_id,role_code) values('${account}','${school}','${schoolPerson}','school_admin');
insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code) values('${account}','${school}','${cafe}','${cafePerson}','cafeteria_admin');
insert into students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name) values
 ('${student}','${account}','${school}','${studentPerson}','A5C3','Sol','Ficticia Ajuste','Sol Ficticia Ajuste'),
 ('${student2}','${account}','${school}','${student2Person}','A5C3B','Luna','Ficticia Sin Cafetería','Luna Ficticia Sin Cafetería');
insert into student_enrollments(account_id,school_id,student_id,starts_on) values('${account}','${school}','${student}','2026-01-01'),('${account}','${school}','${student2}','2026-01-01');
insert into school_cafeteria_shares(account_id,school_id,cafeteria_id,status) values('${account}','${school}','${cafe}','active');
insert into school_cafeteria_share_categories(account_id,school_id,cafeteria_id,share_id,category,enabled) select account_id,school_id,cafeteria_id,id,'basic_identification',true from school_cafeteria_shares where cafeteria_id='${cafe}';
insert into cafeteria_customers(id,account_id,school_id,cafeteria_id,student_id) values('${customer}','${account}','${school}','${cafe}','${student}');`);
const claims=u=>`set request.jwt.claim.sub='${u}';set role authenticated;`;
sql(claims(users[0])+`select school_wallet_replenish('${school}','${student}',5000,'${randomUUID()}','Fixture local','Fondos ficticios verificados');`);
const balance=()=>sql(`select current_balance_minor from student_wallets where student_id='${student}'`);
rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
for(const name of ['package.json','tsconfig.base.json','packages','apps/web'])cpSync(resolve(root,name),resolve(stage,name),{recursive:true,filter:p=>!['/.next','/node_modules','/.env','/test-results','/playwright-report'].some(x=>p.includes(x))});
symlinkSync(resolve(root,'node_modules'),resolve(stage,'node_modules'),'dir');
writeFileSync(resolve(stage,'apps/web/lib/supabase/config.ts'),`// LOCAL ONLY isolated test adapter.\nexport type SupabasePublicConfig={url:string;anonKey:string};\nexport function getSupabasePublicConfig():SupabasePublicConfig{if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55641'||process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF!=='pikas-4d6')throw Error('Local endpoint required');return {url:'http://127.0.0.1:55641',anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!};}`);
const env={...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.ANON_KEY,NEXT_PUBLIC_SUPABASE_PROJECT_REF:'pikas-4d6',PIKAS_APP_ORIGIN:base};
console.log('Building isolated production-mode adjustment browser application');
try{writeFileSync(resolve(stage,'build.log'),execFileSync(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:resolve(stage,'apps/web'),env,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));}catch(e){writeFileSync(resolve(stage,'build-error.log'),String(e.stdout)+'\n'+String(e.stderr));throw Error(`Build failed: ${stage}/build-error.log`);}
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'start','--hostname','localhost','--port','3100'],{cwd:resolve(stage,'apps/web'),env,stdio:['ignore','pipe','pipe']});
let log='',browser,page;server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local server unavailable');}
 browser=await chromium.launch({headless:true});const errors=[];
 async function session(email){const p=await (await browser.newContext({viewport:{width:1440,height:1000}})).newPage();page=p;p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/login');await p.getByLabel('Correo electrónico',{exact:true}).fill(email);await p.getByLabel('Contraseña',{exact:true}).fill(password);const login=p.waitForResponse(r=>r.url().endsWith('/api/auth/login'));await p.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await p.goto(new URL((await login).headers().location).href,{waitUntil:'domcontentloaded'});return p;}
 const overflow=p=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
 // 1-3. School Admin: wallet → easy "Corregir saldo" → purpose guidance.
 const admin=await session(emails[0]);
 await admin.goto(`${base}/admin/escuela/estudiantes?school=${school}`);
 await admin.getByRole('link',{name:'PIKAS Cash de Sol Ficticia Ajuste',exact:true}).click();
 await admin.getByRole('button',{name:'Corregir saldo',exact:true}).click();
 let dialog=admin.getByRole('dialog');await dialog.getByText('¿Qué necesitas corregir?',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Una compra',exact:true}).click();await dialog.getByText('Usa Reembolso',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Volver',exact:true}).click();await dialog.getByRole('button',{name:'Una recarga incorrecta',exact:true}).click();await dialog.getByText('Usa Revertir recarga',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Volver',exact:true}).click();await dialog.getByRole('button',{name:'Otra corrección excepcional de saldo',exact:true}).click();
 // 4-5. Positive adjustment preview and additive result.
 await dialog.getByLabel('Monto del ajuste',{exact:true}).fill('25');await dialog.getByLabel('Motivo del ajuste',{exact:true}).selectOption({label:'Corrección de saldo inicial'});
 assert.equal(await dialog.getByRole('button',{name:/Registrar ajuste permanente/}).isDisabled(),true,'Explanation required');
 await dialog.getByLabel('Explicación del ajuste',{exact:true}).fill('Saldo inicial omitido en la carga');
 assert.match(await dialog.innerText(),/Saldo actual\s+RD\$ 50\.00\s+Ajuste\s+\+RD\$ 25\.00\s+Saldo resultante\s+RD\$ 75\.00/);
 await dialog.getByText('Esto crea un registro financiero permanente',{exact:false}).waitFor();
 await dialog.getByRole('button',{name:'Registrar ajuste permanente de +RD$ 25.00',exact:true}).click();
 const positive=admin.locator('article',{has:admin.getByText('Ajuste administrativo · +RD$ 25.00',{exact:true})});await positive.waitFor();
 assert.equal(await positive.locator('h3 span.text-emerald-700').innerText(),'+RD$ 25.00');assert.equal(balance(),'7500');
 // 6-8. Negative adjustment: preview, warning without blocking, deductive result, red negative balance.
 await admin.setViewportSize({width:390,height:900});
 await admin.getByRole('button',{name:'Corregir saldo',exact:true}).click();dialog=admin.getByRole('dialog');
 await dialog.getByRole('button',{name:'Otra corrección excepcional de saldo',exact:true}).click();
 await dialog.getByText('− Disminuir saldo',{exact:true}).click();await dialog.getByLabel('Monto del ajuste',{exact:true}).fill('100');
 await dialog.getByLabel('Motivo del ajuste',{exact:true}).selectOption({label:'Débito autorizado'});await dialog.getByLabel('Explicación del ajuste',{exact:true}).fill('Consumo registrado fuera del sistema');
 await dialog.getByText('El saldo quedará negativo (−RD$ 25.00).',{exact:false}).waitFor();
 assert.ok(await overflow(admin));await admin.screenshot({path:resolve(stage,'adjustment-modal-390.png'),fullPage:true});
 await dialog.getByRole('button',{name:'Registrar ajuste permanente de −RD$ 100.00',exact:true}).click();
 const negative=admin.locator('article',{has:admin.getByText('Ajuste administrativo · −RD$ 100.00',{exact:true})});await negative.waitFor();
 assert.equal(await negative.locator('h3 span.text-red-700').innerText(),'−RD$ 100.00');
 // 11. Actor role, reason, explanation and balance before are inspectable.
 await negative.getByText('Motivo: Débito autorizado · Administración escolar · Saldo antes: RD$ 75.00',{exact:true}).waitFor();
 await negative.getByText('Consumo registrado fuera del sistema',{exact:true}).waitFor();
 await negative.getByText('Directora Ficticia Ajustes',{exact:false}).waitFor();
 assert.equal(await admin.locator('section.card p.text-3xl').first().getAttribute('class').then(c=>c.includes('text-red-700')),true);
 assert.equal(balance(),'-2500');
 for(const width of [390,768,1440]){await admin.setViewportSize({width,height:900});assert.ok(await overflow(admin));await admin.screenshot({path:resolve(stage,`wallet-adjustments-${width}.png`),fullPage:true});}
 // 9-10. Cafeteria Admin: adjustment only for the connected student; no school-wide authority.
 const cafeAdmin=await session(emails[1]);
 await cafeAdmin.goto(`${base}/admin/cafeteria/escuelas?cafeteria=${cafe}`);
 await cafeAdmin.getByRole('button',{name:'Consultar saldo',exact:true}).click();
 const list=cafeAdmin.getByRole('list',{name:'Saldos PIKAS Cash',exact:true});await list.waitFor();
 assert.doesNotMatch(await list.innerText(),/Luna Ficticia Sin Cafetería/);
 await cafeAdmin.getByRole('button',{name:'Corregir saldo de Sol Ficticia Ajuste',exact:true}).click();dialog=cafeAdmin.getByRole('dialog');
 await dialog.getByRole('button',{name:'Una recarga incorrecta',exact:true}).click();await dialog.getByText('La administración escolar puede revertir la recarga',{exact:false}).waitFor();
 await dialog.getByRole('button',{name:'Volver',exact:true}).click();await dialog.getByRole('button',{name:'Otra corrección excepcional de saldo',exact:true}).click();
 await dialog.getByLabel('Monto del ajuste',{exact:true}).fill('10');await dialog.getByLabel('Motivo del ajuste',{exact:true}).selectOption({label:'Corrección administrativa'});
 await dialog.getByLabel('Explicación del ajuste',{exact:true}).fill('Producto cobrado dos veces fuera de caja');
 await dialog.getByRole('button',{name:'Registrar ajuste permanente de +RD$ 10.00',exact:true}).click();
 await cafeAdmin.getByText('Ajuste registrado: +RD$ 10.00. Saldo resultante: −RD$ 15.00.',{exact:true}).waitFor();
 await list.getByText('−RD$ 15.00',{exact:true}).waitFor();assert.match(await list.innerText(),/Sol Ficticia Ajuste\s+−RD\$ 15\.00/);
 const denied=await cafeAdmin.evaluate(async([s,st])=>{const k=crypto.randomUUID();const r=await fetch('/api/school/wallet',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':k},body:JSON.stringify({operation:'adjust',school_id:s,student_id:st,amount_minor:'100',reason:'administrative_correction',explanation:'Intento escolar',request_key:k})});return r.status;},[school,student2]);
 assert.ok([401,403].includes(denied),'Cafeteria Admin receives no school-wide adjustment');
 const cafeDirect=await cafeAdmin.evaluate(async([c,st])=>{const k=crypto.randomUUID();const r=await fetch('/api/cafeteria/wallet',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':k},body:JSON.stringify({operation:'adjust',cafeteria_id:c,student_id:st,amount_minor:'100',reason:'administrative_correction',explanation:'Intento sin relación',request_key:k})});return r.status;},[cafe,student2]);
 assert.equal(cafeDirect,403,'Unconnected student denied');
 for(const width of [390,1440]){await cafeAdmin.setViewportSize({width,height:900});assert.ok(await overflow(cafeAdmin));await cafeAdmin.screenshot({path:resolve(stage,`cafeteria-adjustment-${width}.png`),fullPage:true});}
 assert.equal(sql(`select string_agg(actor_role||':'||actor_scope_kind||':'||reason_code||':'||amount_minor,',' order by posted_at) from wallet_adjustments where account_id='${account}'`),
  'school_admin:school:initial_balance_correction:2500,school_admin:school:authorized_debit:-10000,cafeteria_admin:cafeteria:administrative_correction:1000');
 assert.equal(sql(`select count(*) from register_sessions where cafeteria_id='${cafe}'`),'0');
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(stage,'verification.json'),JSON.stringify({mode:'production',balance:'5000→7500→-2500→-1500',positive:'+2500 green',negative:'-10000 red',negativeWarning:true,
  guidance:['Reembolso','Revertir recarga','Ajuste'],cafeteriaScoped:true,unconnectedDenied:true,schoolWideDeniedForCafeteria:denied,registerSessions:0,widths:[390,768,1440],pageErrors:errors},null,2));
 console.log('PASS adjustment browser: guidance → positive (+) and negative (−, warning) adjustments with role/reason/explanation → cafeteria scoped adjustment; unconnected/school-wide denied; 390/768/1440px.');
}finally{if(page){writeFileSync(resolve(stage,'last-page.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:resolve(stage,'last-page.png'),fullPage:true}).catch(()=>{});}if(browser)await browser.close();server.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
