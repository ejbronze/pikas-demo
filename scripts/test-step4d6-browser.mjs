// LOCAL ONLY. Verifies repository UI/API/RPC flow against fictional pikas-4d6.
// An isolated source copy adapts only the existing HTTPS-only Supabase config
// to the exact loopback test endpoint. Repository production config stays intact.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { chromium } from '@playwright/test';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const stage='/private/tmp/pikas-4d6-browser';
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
const child=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','localhost','--port','3066'],{cwd:resolve(stage,'apps/web'),env:{...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.ANON_KEY,NEXT_PUBLIC_SUPABASE_PROJECT_REF:'pikas-4d6'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',d=>{log+=d});child.stderr.on('data',d=>{log+=d});
let browser;
try{
 for(let i=0;i<120;i++){try{const res=await fetch('http://localhost:3066/login');if(res.ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local dev server failed: '+log);}
 browser=await chromium.launch({headless:true});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 await ctx.addCookies(jar.map(c=>({name:c.name,value:c.value,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax'})));
 const page=await ctx.newPage();page.on('response',async r=>{if(r.url().includes('/api/platform/sandbox-pov/')&&r.status()>=400)console.log('Local API error:',r.status(),await r.text());});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base='http://localhost:3066';
 await page.goto(base+'/platform/demostracion');
 await page.getByRole('button',{name:'Entrar como Administrador escolar',exact:true}).waitFor();
 for(const name of ['Entrar como Administrador escolar','Entrar como Administrador de cafetería','Entrar como Cajero'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),1);
 await page.getByRole('button',{name:'Entrar como Administrador escolar',exact:true}).click();
 await page.getByRole('link',{name:'Abrir administración',exact:true}).click();
 await page.waitForURL('**/admin/escuela?school=df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488');
 await page.getByRole('link',{name:'Estudiantes',exact:true}).first().click();
 for(const name of ['Luna Castillo','Mateo Ventura','Alma Robles','Bruno Peña'])await page.getByText(name,{exact:true}).first().waitFor();
 assert.ok((await page.locator('body').innerText()).includes('Operador: Edwin'));
 await page.screenshot({path:resolve(stage,'school-roster.png'),fullPage:true});
 console.log('PASS browser: Platform → school POV → authoritative four-student roster; real Edwin shown.');
 await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Salir de demostración' && Object.keys(b).some(k => k.startsWith('__reactProps$') && typeof b[k]?.onClick === 'function')));
 await page.getByRole('button',{name:'Salir de demostración',exact:true}).click();
 await page.waitForURL('**/platform/demostracion');
 await page.getByRole('button',{name:'Entrar como Administrador de cafetería',exact:true}).click();
 await page.getByRole('link',{name:'Abrir administración',exact:true}).click();
 await page.waitForURL('**/admin/cafeteria?cafeteria=b9496342-5079-46ae-83b8-05c39bcbd7fe');
 await page.getByRole('link',{name:'Productos',exact:true}).first().click();
 for(const name of ['Agua natural','Jugo de naranja','Fruta de temporada','Sándwich de pollo','Empanada de vegetales','Yogur natural'])await page.getByText(name,{exact:true}).first().waitFor();
 await page.screenshot({path:resolve(stage,'cafeteria-products.png'),fullPage:true});
 await page.getByRole('link',{name:'Personal POS',exact:true}).first().click();await page.getByText('José Ramírez',{exact:true}).first().waitFor();
 await page.getByRole('link',{name:'Cajas',exact:true}).first().click();await page.getByText('Caja demo Horizonte',{exact:true}).first().waitFor();assert.ok((await page.locator('body').innerText()).includes('HZ-01'));
 await page.screenshot({path:resolve(stage,'cafeteria-register.png'),fullPage:true});
 console.log('PASS browser: cafeteria POV → six products → José → HZ-01.');
 await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Salir de demostración' && Object.keys(b).some(k => k.startsWith('__reactProps$') && typeof b[k]?.onClick === 'function')));
 await page.getByRole('button',{name:'Salir de demostración',exact:true}).click();await page.waitForURL('**/platform/demostracion');
 await page.getByRole('button',{name:'Entrar como Cajero',exact:true}).click();await page.getByRole('link',{name:'Abrir POS',exact:true}).click();
 await page.waitForURL('**/pos');await page.getByText('José Ramírez',{exact:false}).first().waitFor();
 await page.screenshot({path:resolve(stage,'cashier-pos.png'),fullPage:true});
 console.log('PASS browser: cashier José → connected POS; three local experiences verified.');
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(stage,'verification.txt'),'School roster, six products, Jose, HZ-01, cashier POS verified. Zero page errors.\n');
}finally{if(browser)await browser.close();child.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
