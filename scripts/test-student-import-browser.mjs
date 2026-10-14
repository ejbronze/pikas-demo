// LOCAL ONLY presentation/recovery verification. No database, Docker or production access.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stage = '/private/tmp/pikas-b2b-import';
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
 const data:SchoolRead={scope:{actor_id:id,membership_id:id,role:'school_admin',account_id:id,school_id:id,account_name:'Cuenta local',school_name:'Escuela local',tenant_kind:'customer'},grades:['4','40'],locations:[{id,name:'Sede principal'}],next_cursor:id};
 const students:SchoolStudent[]=['Luna Castillo','Mateo Ventura','Alma Robles','Bruno Peña'].map((name,index)=>({id:id.slice(0,-1)+(index+2),first_name:name.split(' ')[0],last_name:name.split(' ')[1],display_name:name,student_code:'LOCAL-'+index,status:'active',enrollment:{id,starts_on:'2026-10-12',location_id:id,grade:'4',class:'A',homeroom:'Aula 1'}}));
 if(q.startsWith('BETA-'))students.unshift({...students[0],id:id.slice(0,-1)+'9',first_name:'Nuevo',last_name:'Estudiante',display_name:'Nuevo Estudiante',student_code:q});
 return <ConnectedSchoolShell context={{person_id:id,display_name:'Administrador local',schools:[{school_id:id,account_id:id,account_name:'Cuenta local',school_name:'Escuela local',tenant_kind:'customer'}]}} schoolId={id}><ConnectedSchoolPages section="students" data={data} students={students} query={q}/></ConnectedSchoolShell>;
}`);
const base='http://127.0.0.1:3078';
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3078'],{cwd:web,env:{...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false'},stdio:['ignore','pipe','pipe']});
let log='';server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
let browser;
try {
 for(let i=0;i<120;i++){try{if((await fetch(base+'/admin/escuela/estudiantes')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local fixture server unavailable');}
 browser=await chromium.launch({headless:true});
 const id='4d700000-0000-4000-8000-000000000001';
 for(const [width,height] of [[390,844],[768,1024],[1440,900]]) {
 const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());let mode='lost';
 await page.route('**/api/school/students/import',async route=>{
  const body=route.request().postDataJSON();
  if(body.action==='validate') {await route.fulfill({json:{result:{school_id:id,valid:body.rows.every(r=>r.first_name&&r.student_code!=='EXISTS'&&body.rows.filter(x=>x.student_code===r.student_code).length===1),rows:body.rows.map(row=>({source_row:row.source_row,row,errors:!row.first_name?['first_name_invalid']:row.student_code==='EXISTS'?['existing_code']:body.rows.filter(x=>x.student_code===row.student_code).length>1?['duplicate_code']:[]}))}}});return;}
  requests.push({key:route.request().headers()['idempotency-key'],body});
  if(mode==='lost'){mode='denied';await route.abort();return;}
  if(mode==='denied'){mode='success';await route.fulfill({status:403,json:{error:'school_authority_required'}});return;}
  await route.fulfill({json:{result:{status:'committed',school_id:id,request_id:requests.at(-1).key,created:body.included_rows.map(source_row=>({source_row,student_id:id,enrollment_id:id})),excluded_rows:body.rows.filter(r=>!body.included_rows.includes(r.source_row)).map(r=>r.source_row)}}});
 });
 await page.goto(base+'/admin/escuela/estudiantes');
 await page.getByLabel('Campus / sede',{exact:true}).selectOption(id);await page.getByLabel('Grado exacto').selectOption('40');await page.getByRole('button',{name:'Buscar',exact:true}).click();await page.waitForURL('**/*grade=40');assert.ok(page.url().includes('location='+id));
 const open=page.getByRole('button',{name:'Importar CSV',exact:true});await open.focus();await page.keyboard.press('Enter');let dialog=page.getByRole('dialog');await dialog.waitFor();
 const upload=()=>dialog.locator('input[type=file]');
 await upload().setInputFiles({name:'students.csv',mimeType:'text/csv',buffer:Buffer.from('\uFEFFfirst_name,last_name,student_code,starts_on\r\n"Ana, María",Test,GOOD,2026-10-01\r\n,Test,BAD,2026-10-01\r\nOld,Test,EXISTS,2026-10-01\r\nDuplicate,Test,GOOD,2026-10-01')});
 await dialog.getByText('Nombre obligatorio, máximo 80 caracteres',{exact:true}).waitFor();assert.ok(await dialog.getByRole('button',{name:'Confirmar importación'}).isDisabled());
 await dialog.getByText('Código duplicado en el archivo',{exact:true}).first().waitFor();await dialog.getByLabel('Incluir fila 5').uncheck();await dialog.getByLabel('Incluir fila 4').uncheck();await dialog.getByLabel('Nombre · fila 3',{exact:true}).fill('Luis');assert.ok(await dialog.getByRole('button',{name:'Confirmar importación'}).isDisabled());await dialog.getByRole('button',{name:'Revalidar todas las filas'}).click();await dialog.getByText('Válida',{exact:true}).first().waitFor();assert.equal(await dialog.getByRole('button',{name:'Confirmar importación'}).isEnabled(),true);
 const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=height);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:resolve(stage,'import-'+width+'.png')});
 await dialog.getByRole('button',{name:'Confirmar importación'}).click();await dialog.getByText(/Resultado pendiente de confirmar/).waitFor();const original=requests.at(-1);assert.deepEqual(original.body.included_rows,[2,3]);assert.ok(await dialog.getByLabel('Nombre · fila 3',{exact:true}).isDisabled());
 await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();await open.click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Confirmar solicitud pendiente'}).waitFor();assert.ok(await upload().isDisabled());assert.equal(requests.length,1);
 await dialog.getByRole('button',{name:'Confirmar solicitud pendiente'}).click();await dialog.getByText(/Resultado pendiente de confirmar/).waitFor();assert.deepEqual(requests.at(-1),original);assert.ok(await upload().isDisabled());
 await dialog.getByRole('button',{name:'Confirmar solicitud pendiente'}).click();await dialog.getByText('2 estudiantes creados y matriculados.',{exact:true}).waitFor();assert.deepEqual(requests.at(-1),original);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.includes('student-bulk-v1')).length),0);
 const csv='first_name,last_name,student_code,starts_on\n'+Array.from({length:200},(_,i)=>`A,B,X${i},2026-10-01`).join('\n');await upload().setInputFiles({name:'200.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await dialog.getByText('200 filas · 200 incluidas.',{exact:false}).waitFor();assert.equal(await dialog.getByLabel('Incluir fila 201').count(),1);const preview=dialog.getByLabel('Vista previa de todas las filas');assert.ok(await preview.evaluate(e=>e.scrollHeight>e.clientHeight));
 await upload().setInputFiles({name:'201.csv',mimeType:'text/csv',buffer:Buffer.from(csv+'\nA,B,OVER,2026-10-01')});await dialog.getByText('El archivo debe contener entre 1 y 200 filas de estudiantes.',{exact:true}).waitFor();assert.ok(await dialog.getByRole('button',{name:'Confirmar importación'}).isDisabled());
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await open.evaluate(e=>document.activeElement===e),true);assert.deepEqual(errors,[]);console.log(`PASS ${width}: validation/exclusion/edit/revalidate, exact recovery after lost response/403, success, 200-row bounded preview, 201 rejection, filters and focus.`);await context.close();
 }
 writeFileSync(resolve(stage,'verification.txt'),'390/768/1440 import and recovery checks passed using isolated source copy and intercepted API. No DB or production access.\n');
}finally{if(browser)await browser.close();server.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
