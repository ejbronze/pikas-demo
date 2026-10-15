// LOCAL ONLY real UI -> API -> Auth/RPC proof. Fictional tagged fixture rows retained.
// Reuses the isolated source-copy adapter; repository HTTPS/security config is unchanged.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {cpSync,mkdirSync,rmSync,symlinkSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),stage='/private/tmp/pikas-cafeteria-delegation',base='http://localhost:3090';
const docker='/Applications/Docker.app/Contents/Resources/bin/docker';
assert.equal(execFileSync(docker,['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_pikas-4d6'],{encoding:'utf8'}).trim(),'pikas-4d6');
const config=JSON.parse(execFileSync(resolve(root,'node_modules/.bin/supabase'),['--workdir','/private/tmp/pikas-4d6-local','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(config.API_URL,'http://127.0.0.1:55641');
const sql=q=>execFileSync(docker,['exec','-i','supabase_db_pikas-4d6','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:q,encoding:'utf8'}).trim();
const provider=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const tag=randomUUID().slice(0,8),password='Local-4D8-fictional-only-938!',email=`local-4d8-recipient-${tag}@example.invalid`,operatorEmail=`local-4d8-operator-${tag}@example.invalid`;
const op=await provider.auth.admin.createUser({email:operatorEmail,password,email_confirm:true});assert.equal(op.error,null);const opid=op.data.user.id,person=randomUUID();
const account=randomUUID(),school=randomUUID(),location=randomUUID(),cafeteria=randomUUID();
sql(`insert into persons(id,auth_user_id,display_name) values('${person}','${opid}','Fictional Delegator');insert into accounts(id,code,name) values('${account}','DEL-BROWSER-${tag}','Fictional Account');insert into schools(id,account_id,code,name) values('${school}','${account}','S','Fictional School');insert into school_locations(id,account_id,school_id,code,name) values('${location}','${account}','${school}','L','Fictional Location');insert into cafeterias(id,account_id,school_id,school_location_id,code,name) values('${cafeteria}','${account}','${school}','${location}','C','Fictional Cafe');insert into account_memberships(account_id,person_id,role_code) values('${account}','${person}','account_admin');`);
rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
for(const name of ['package.json','tsconfig.base.json','packages','apps/web'])cpSync(resolve(root,name),resolve(stage,name),{recursive:true,filter:p=>!['/.next','/node_modules','/.env','/test-results','/playwright-report'].some(x=>p.includes(x))});
symlinkSync(resolve(root,'node_modules'),resolve(stage,'node_modules'),'dir');
writeFileSync(resolve(stage,'apps/web/lib/supabase/config.ts'),`// LOCAL ONLY isolated adapter.\nexport function getSupabasePublicConfig(){if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55641'||process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF!=='pikas-4d6')throw Error('Local endpoint required');return {url:'http://127.0.0.1:55641',anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!};}`);
const activationPath=resolve(stage,'apps/web/lib/auth/activation.ts');writeFileSync(activationPath,readFileSync(activationPath,'utf8').replace("url.protocol !== 'https:' || url.origin !== configured",`url.origin !== '${base}' || url.origin !== configured`));
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','localhost','--port','3090'],{cwd:resolve(stage,'apps/web'),env:{...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.ANON_KEY,NEXT_PUBLIC_SUPABASE_PROJECT_REF:'pikas-4d6',SUPABASE_SERVICE_ROLE_KEY:config.SERVICE_ROLE_KEY,PIKAS_APP_ORIGIN:base},stdio:['ignore','pipe','pipe']});
let log='',browser;server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local server unavailable');}
 browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1360,height:900}}),page=await ctx.newPage();page.on('dialog',d=>d.accept());
 await page.goto(base+'/login');await page.getByLabel('Correo electrónico',{exact:true}).fill(operatorEmail);await page.getByLabel('Contraseña',{exact:true}).fill(password);const response=page.waitForResponse(r=>r.url().endsWith('/api/auth/login'));await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();const login=await response;assert.equal(login.status(),303);
 const destination=new URL(login.headers().location);assert.equal(destination.origin,base);assert.equal(destination.pathname,'/admin/escuela');await page.goto(destination.href,{waitUntil:'domcontentloaded'});await page.getByRole('link',{name:'Cafeterías conectadas',exact:true}).waitFor();await page.getByRole('link',{name:'Cafeterías conectadas',exact:true}).click();
 const self=page.getByRole('button',{name:'Asignarme como administrador de esta cafetería',exact:true});await self.waitFor({timeout:60000});
 for(const width of [390,768,1360]){await page.setViewportSize({width,height:900});await self.scrollIntoViewIfNeeded();assert.ok(await self.isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));}
 let lose=true;const requests=[];await page.route('**/api/school',async route=>{const body=route.request().postDataJSON();if(body.operation==='cafeteria_admin_self'){requests.push({key:route.request().headers()['idempotency-key'],body});if(lose){lose=false;const result=await route.fetch();assert.equal(result.status(),200);await route.abort();return;}}await route.continue();});
 await self.click();await page.getByText('Resultado incierto. No crees otra solicitud: reintenta con la misma clave.',{exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Confirmar solicitud pendiente',exact:true}).click();
 const entry=page.getByRole('link',{name:'Entrar a administración de cafetería',exact:true});await entry.waitFor();assert.deepEqual(requests[1],requests[0]);assert.equal(sql(`select count(*) from cafeteria_memberships where cafeteria_id='${cafeteria}' and person_id='${person}' and role_code='cafeteria_admin'`),'1');
 await page.getByText('Invitar administrador de cafetería',{exact:true}).click();await page.getByLabel('Correo del administrador de cafetería',{exact:true}).fill(email);await page.getByRole('button',{name:'Preparar acceso de cafetería',exact:true}).click();const issue=page.getByRole('button',{name:'Generar enlace de activación',exact:true});await issue.waitFor();await issue.click();const link=page.getByLabel('Enlace privado de activación',{exact:true});await link.waitFor();const privateLink=await link.inputValue();assert.equal(new URL(privateLink).origin,base);
 assert.equal(await page.evaluate(()=>Object.values(sessionStorage).some(v=>v.includes('/activar#token='))),false);
 await page.reload();await page.getByRole('button',{name:'Reemplazar enlace de activación',exact:true}).waitFor();assert.equal(await page.getByLabel('Enlace privado de activación',{exact:true}).count(),0);
 await page.getByRole('link',{name:'Entrar a administración de cafetería',exact:true}).click();await page.waitForURL('**/admin/cafeteria?**');await page.getByText('Fictional Cafe',{exact:true}).first().waitFor();assert.ok(!(await page.locator('body').innerText()).includes('Colegio Horizonte'));
 console.log('PASS real local browser: login, explicit delegation, lost-success exact recovery, invitation/link, ephemeral secret, responsive controls and existing cafeteria entry');writeFileSync(resolve(stage,'verification.txt'),'PASS real local delegation UI/API/DB browser proof; no production access.\n');
}catch(error){throw new Error(String(error?.message??error).replace(/token=[0-9a-f]{64}/g,'token=[redacted]'));}finally{if(browser)await browser.close();server.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
