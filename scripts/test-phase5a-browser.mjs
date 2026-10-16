// LOCAL ONLY production-mode UI -> API -> Auth/PostgREST -> committed database.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {cpSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),stage='/private/tmp/pikas-phase5a-browser',base='http://localhost:3095';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
assert.equal(execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],{encoding:'utf8'}).trim(),'pikas-4d6');
const config=JSON.parse(execFileSync(resolve(root,'node_modules/.bin/supabase'),['--workdir','/private/tmp/pikas-4d6-local','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(config.API_URL,'http://127.0.0.1:55641');
const sql=q=>execFileSync(docker,['exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
assert.equal(sql('select max(version) from supabase_migrations.schema_migrations'),'202610160001');
const provider=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const tag=randomUUID().slice(0,8),password='Local-5A-fictional-only-938!',emails=[`phase5a-admin-${tag}@example.invalid`,`phase5a-cashier-${tag}@example.invalid`],users=[];
const [account,school,location,cafe,adminPerson,cashierPerson,cashierMembership,register,product]=Array.from({length:9},()=>randomUUID());
for(const email of emails){const created=await provider.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null);users.push(created.data.user.id);}
sql(`insert into persons(id,auth_user_id,display_name) values('${adminPerson}','${users[0]}','Administrador Ficticio Phase 5A'),('${cashierPerson}','${users[1]}','Cajero Ficticio Phase 5A');insert into accounts(id,code,name) values('${account}','PHASE5A-${tag}','Cuenta Ficticia Phase 5A');insert into schools(id,account_id,code,name) values('${school}','${account}','S','Escuela Ficticia Phase 5A');insert into school_locations(id,account_id,school_id,code,name) values('${location}','${account}','${school}','L','Sede Ficticia');insert into cafeterias(id,account_id,school_id,school_location_id,code,name) values('${cafe}','${account}','${school}','${location}','C','Cafetería Ficticia Phase 5A');insert into cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values('${randomUUID()}','${account}','${school}','${cafe}','${adminPerson}','cafeteria_admin'),('${cashierMembership}','${account}','${school}','${cafe}','${cashierPerson}','pos_cashier');`);
const claims=u=>`set request.jwt.claim.sub='${u}';set role authenticated;`;
const command=(operation,payload)=>JSON.parse(sql(claims(users[0])+`select cafeteria_admin_command('${cafe}','${randomUUID()}','${operation}','${JSON.stringify(payload)}');`));
command('product_save',{id:product,version:null,name:'Agua ficticia Phase 5A',description:'Fixture local',category:'Bebidas',price_minor:5000,unit:'botella',active:true,available:true,ingredients:[],allergens:[]});
command('register_save',{id:register,version:null,code:'PHASE5A',name:'Caja Phase 5A',status:'active'});
const assignment=command('assignment_save',{membership_id:cashierMembership,register_id:register,status:'active',version:null}).target_id;
const sid=sql(claims(users[1])+`select session_id from open_register_session('${register}','${assignment}',10000,'${randomUUID()}');`);
const body={request_key:randomUUID(),register_session_id:sid,cafeteria_customer_id:null,expected_total_minor:'5000',items:[{product_id:product,quantity:1,expected_product_version:1,expected_unit_price_minor:'5000'}],tender:{type:'cash',cash_received_minor:'10000'}};
sql(claims(users[1])+`select checkout_purchase('${JSON.stringify(body)}');`);
rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
for(const name of ['package.json','tsconfig.base.json','packages','apps/web'])cpSync(resolve(root,name),resolve(stage,name),{recursive:true,filter:p=>!['/.next','/node_modules','/.env','/test-results','/playwright-report'].some(x=>p.includes(x))});
symlinkSync(resolve(root,'node_modules'),resolve(stage,'node_modules'),'dir');
writeFileSync(resolve(stage,'apps/web/lib/supabase/config.ts'),`// LOCAL ONLY isolated test adapter.\nexport function getSupabasePublicConfig(){if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55641'||process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF!=='pikas-4d6')throw Error('Local endpoint required');return {url:'http://127.0.0.1:55641',anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!};}`);
const env={...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.ANON_KEY,NEXT_PUBLIC_SUPABASE_PROJECT_REF:'pikas-4d6',PIKAS_APP_ORIGIN:base};
console.log('Building isolated production-mode Phase 5A browser application');
try{writeFileSync(resolve(stage,'build.log'),execFileSync(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:resolve(stage,'apps/web'),env,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));}catch(e){writeFileSync(resolve(stage,'build-error.log'),String(e.stdout)+'\n'+String(e.stderr));throw Error(`Build failed: ${stage}/build-error.log`);}
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'start','--hostname','localhost','--port','3095'],{cwd:resolve(stage,'apps/web'),env,stdio:['ignore','pipe','pipe']});
let log='',browser,debugPage;server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local server unavailable');}
 browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage(),errors=[];debugPage=page;page.on('pageerror',e=>errors.push(e.message));
 async function login(p,email){await p.goto(base+'/login');await p.getByLabel('Correo electrónico',{exact:true}).fill(email);await p.getByLabel('Contraseña',{exact:true}).fill(password);const response=p.waitForResponse(r=>r.url().endsWith('/api/auth/login'));await p.getByRole('button',{name:'Iniciar sesión',exact:true}).click();const r=await response;assert.equal(r.status(),303);const target=new URL(r.headers().location);assert.equal(target.origin,base);await p.goto(target.href,{waitUntil:'domcontentloaded'});}
 await login(page,emails[0]);await page.goto(`${base}/admin/cafeteria/transacciones?cafeteria=${cafe}`);
 const latest=sql(`select purchase_number from purchases where register_session_id='${sid}' order by purchased_at desc limit 1;`);
 await page.getByRole('button',{name:`Recibo #${latest}`,exact:true}).click();await page.getByRole('heading',{name:`Recibo #${latest}`,exact:true}).waitFor();
 await page.getByText('1 × Agua ficticia Phase 5A',{exact:false}).waitFor();
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(stage,`transactions-${width}.png`),fullPage:true});}
 await page.goto(`${base}/admin/cafeteria/cajas?cafeteria=${cafe}`);await page.getByRole('button',{name:'Caja Phase 5A · Abierta',exact:true}).click();await page.getByRole('heading',{name:'Detalle de sesión',exact:true}).waitFor();
 await page.getByLabel('Efectivo contado',{exact:true}).fill('145');await page.getByLabel('Nota',{exact:true}).fill('Conteo ficticio Phase 5A');await page.getByRole('button',{name:'Revisar cierre',exact:true}).click();await page.getByRole('button',{name:'Confirmar cierre permanente',exact:true}).waitFor();
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(stage,`close-confirmation-${width}.png`),fullPage:true});}
 await page.setViewportSize({width:390,height:1000});const confirm=page.getByRole('button',{name:'Confirmar cierre permanente',exact:true});await confirm.scrollIntoViewIfNeeded();const buttonBox=await confirm.boundingBox(),navBox=await page.getByRole('navigation',{name:'Administración móvil',exact:true}).boundingBox(),headerBox=await page.locator('header:visible').first().boundingBox();assert.ok(buttonBox&&navBox&&headerBox&&buttonBox.y>=headerBox.y+headerBox.height&&buttonBox.y+buttonBox.height<=navBox.y,'Mobile close control must be visible between header and navigation');
 let lost=true;await page.route('**/api/cafeteria/operations',async route=>{if(route.request().postDataJSON().operation==='close'&&lost){lost=false;const response=await route.fetch();assert.equal(response.status(),200,await response.text());await route.abort();}else await route.continue();});
 await page.getByRole('button',{name:'Confirmar cierre permanente',exact:true}).click();await page.getByRole('button',{name:'Recuperar mismo cierre',exact:true}).waitFor();
 assert.equal(sql(`select status from register_sessions where id='${sid}'`),'closed');
 await page.getByRole('button',{name:'Recuperar mismo cierre',exact:true}).click();await page.getByText('Cierre permanente confirmado.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Caja Phase 5A · Cerrada',exact:true}).first().waitFor();
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pikas:register-close:')).length),0);
 const summary=JSON.parse(sql(`select jsonb_build_object('expected',summary->>'expected_minor','difference',difference_minor::text) from pikas_private.register_close_reconciliations where session_id='${sid}'`));assert.deepEqual(summary,{expected:'15000',difference:'-500'});
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(stage,`closed-session-${width}.png`),fullPage:true});}
 const cashierCtx=await browser.newContext(),cashier=await cashierCtx.newPage();await login(cashier,emails[1]);await cashier.goto(base+'/pos');await cashier.getByText('No hay una caja abierta y autorizada.',{exact:false}).waitFor();
 assert.equal(sql(`select count(*) from register_sessions where operator_person_id='${cashierPerson}' and status='open'`),'0');assert.deepEqual(errors,[]);
 writeFileSync(resolve(stage,'verification.json'),JSON.stringify({mode:'production',viewports:[390,768,1440],session:sid,lostSuccessRecovered:true,expected:'15000',counted:'14500',difference:'-500',posBlocked:true,consoleErrors:errors},null,2));
 console.log('PASS production browser: history/detail → counted/explicit confirmation → lost-success exact recovery → permanent close → POS blocked; 390/768/1440px, no horizontal overflow or console errors.');
}finally{if(debugPage){writeFileSync(resolve(stage,'last-page.txt'),await debugPage.locator('body').innerText().catch(()=>''));await debugPage.screenshot({path:resolve(stage,'last-page.png'),fullPage:true}).catch(()=>{});}if(browser)await browser.close();server.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
