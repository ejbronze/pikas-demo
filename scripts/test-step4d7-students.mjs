// LOCAL ONLY presentation/recovery verification. No database, Docker or production access.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stage = '/private/tmp/pikas-4d7-students';
rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true });
for (const name of ['package.json', 'tsconfig.base.json', 'packages', 'apps/web']) cpSync(resolve(root, name), resolve(stage, name), { recursive: true, filter: p => !['/.env','/.next','/node_modules','/test-results','/playwright-report'].some(part => p.includes(part)) });
symlinkSync(resolve(root, 'node_modules'), resolve(stage, 'node_modules'), 'dir');
const web = resolve(stage, 'apps/web');
rmSync(resolve(web, 'proxy.ts'), { force: true });
writeFileSync(resolve(web,'app/layout.tsx'), `import './globals.css'; export default function Layout({children}:{children:React.ReactNode}) { return <html lang="es"><body>{children}</body></html>; }`);
writeFileSync(resolve(web,'app/admin/escuela/layout.tsx'), `export default function Layout({children}:{children:React.ReactNode}) { return children; }`);
writeFileSync(resolve(web,'app/admin/escuela/estudiantes/page.tsx'), `
import {ConnectedSchoolPages} from '../../../../components/connected-school-pages';
import {ConnectedSchoolShell} from '../../../../components/connected-school-shell';
import type {SchoolRead,SchoolStudent} from '../../../../lib/school/contracts';
const id='4d700000-0000-4000-8000-000000000001';
export default async function Page({searchParams}:{searchParams:Promise<{q?:string}>}) {
 const {q=''}=await searchParams;
 const data:SchoolRead={scope:{actor_id:id,membership_id:id,role:'school_admin',account_id:id,school_id:id,account_name:'Cuenta local',school_name:'Escuela local',tenant_kind:'customer'},locations:[{id,name:'Sede principal'}],next_cursor:id};
 const students:SchoolStudent[]=['Luna Castillo','Mateo Ventura','Alma Robles','Bruno Peña'].map((name,index)=>({id:id.slice(0,-1)+(index+2),first_name:name.split(' ')[0],last_name:name.split(' ')[1],display_name:name,student_code:'LOCAL-'+index,status:'active',enrollment:{id,starts_on:'2026-10-12',location_id:id,grade:'4',class:'A',homeroom:'Aula 1'}}));
 if(q.startsWith('BETA-'))students.unshift({...students[0],id:id.slice(0,-1)+'9',first_name:'Nuevo',last_name:'Estudiante',display_name:'Nuevo Estudiante',student_code:q});
 return <ConnectedSchoolShell context={{person_id:id,display_name:'Administrador local',schools:[{school_id:id,account_id:id,account_name:'Cuenta local',school_name:'Escuela local',tenant_kind:'customer'}]}} schoolId={id}><ConnectedSchoolPages section="students" data={data} students={students} query={q}/></ConnectedSchoolShell>;
}`);
const base='http://127.0.0.1:3077';
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3077'],{cwd:web,env:{...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false'},stdio:['ignore','pipe','pipe']});
let log=''; server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
let browser;
try {
 for(let i=0;i<120;i++){try{if((await fetch(base+'/admin/escuela/estudiantes')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local fixture server unavailable');}
 browser=await chromium.launch({headless:true});
 for(const [width,height] of [[390,844],[768,1024],[1440,900]]){
  const context=await browser.newContext({viewport:{width,height}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let mode='success';const requests=[];
  await page.route('**/api/school',async route=>{const request=route.request();const body=request.postDataJSON();requests.push({key:request.headers()['idempotency-key'],body});if(mode==='lost'){mode='denied';await route.abort();return;}if(mode==='denied'){mode='success';await route.fulfill({status:403,json:{error:'authorization'}});return;}await route.fulfill({json:{result:{student_id:'4d700000-0000-4000-8000-000000000009'}}});});
  await page.goto(base+'/admin/escuela/estudiantes');
  assert.equal(await page.locator('[aria-label="Listado de estudiantes"] input').count(),0);
  const open=page.getByRole('button',{name:'Ver perfil de Luna Castillo'});await open.focus();await page.keyboard.press('Enter');
  let dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.getByRole('heading',{name:'Matrícula actual'}).waitFor();
  assert.ok((await dialog.innerText()).includes('Aula 1'));
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await open.evaluate(e=>e===document.activeElement),true);
  await open.click();dialog=page.getByRole('dialog');await dialog.getByText('Editar estudiante',{exact:true}).click();
  await dialog.getByLabel('Nombre',{exact:true}).fill('Luna');
  await dialog.getByRole('button',{name:'Guardar información'}).waitFor();
  mode='lost';await dialog.getByRole('button',{name:'Guardar información'}).click();await dialog.getByText(/Resultado incierto/).waitFor();
  const original=requests.at(-1);
  await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();await open.click();dialog=page.getByRole('dialog');await dialog.getByText('Editar estudiante',{exact:true}).click();
  await dialog.getByRole('button',{name:'Confirmar solicitud pendiente'}).click();await dialog.getByText(/operación anterior sigue sin confirmar/).waitFor();assert.deepEqual(requests.at(-1),original);
  await dialog.getByRole('button',{name:'Confirmar solicitud pendiente'}).click();await dialog.getByText('Cambio confirmado.',{exact:true}).waitFor();assert.deepEqual(requests.at(-1),original);
  await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.getByRole('button',{name:'Crear estudiante',exact:true}).click();dialog=page.getByRole('dialog');
  await dialog.getByLabel('Nombre',{exact:true}).fill('Nuevo');await dialog.getByLabel('Apellido',{exact:true}).fill('Estudiante');await dialog.getByLabel('Código estudiantil').fill('BETA-'+width);
  await dialog.getByRole('button',{name:'Continuar'}).click();await dialog.getByLabel('Fecha efectiva').fill('2026-10-12');await dialog.getByLabel('Campus').selectOption('4d700000-0000-4000-8000-000000000001');await dialog.getByLabel('Grado',{exact:true}).fill('5');
  await dialog.getByRole('button',{name:'Continuar'}).click();await dialog.getByRole('heading',{name:'Revisar y crear',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Atrás'}).click();assert.equal(await dialog.getByLabel('Grado',{exact:true}).inputValue(),'5');await dialog.getByRole('button',{name:'Continuar'}).click();
  const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=height);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const scroll=await dialog.locator('.overflow-y-auto').evaluate(e=>({client:e.clientHeight,scroll:e.scrollHeight}));assert.ok(scroll.client>0);
  await dialog.getByRole('button',{name:'Crear y matricular'}).scrollIntoViewIfNeeded();await page.screenshot({path:resolve(stage,'create-'+width+'.png')});
  mode='lost';await dialog.getByRole('button',{name:'Crear y matricular'}).click();await dialog.getByText(/Resultado incierto/).waitFor();const createRequest=requests.at(-1);assert.equal(createRequest.body.operation,'student_create');
  await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();await page.getByRole('button',{name:'Crear estudiante',exact:true}).click();dialog=page.getByRole('dialog');
  await dialog.getByRole('heading',{name:'Revisar y crear',exact:true}).waitFor();await dialog.getByRole('button',{name:'Confirmar solicitud pendiente'}).click();await dialog.getByText(/operación anterior sigue sin confirmar/).waitFor();assert.deepEqual(requests.at(-1),createRequest);
  await dialog.getByRole('button',{name:'Confirmar solicitud pendiente'}).click();await page.waitForURL('**/*q=BETA-'+width);await page.getByText('Nuevo Estudiante',{exact:true}).first().waitFor();assert.deepEqual(requests.at(-1),createRequest);
  await page.screenshot({path:resolve(stage,'roster-'+width+'.png')});
  assert.deepEqual(errors,[]);console.log('PASS '+width+': roster, keyboard/Escape/focus, profile recovery, create review/back/recovery/refresh, viewport bounds.');await context.close();
 }
 writeFileSync(resolve(stage,'verification.txt'),'390/768/1440 presentation and recovery checks passed; local fixture server and intercepted API only. No DB/production access.\n');
}finally{if(browser)await browser.close();server.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
