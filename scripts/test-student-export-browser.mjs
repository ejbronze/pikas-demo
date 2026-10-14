// LOCAL ONLY presentation/recovery verification. No database, Docker or production access.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stage = '/private/tmp/pikas-b2c-export';
rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true });
for (const name of ['package.json', 'tsconfig.base.json', 'packages', 'apps/web']) cpSync(resolve(root, name), resolve(stage, name), { recursive: true, filter: p => !['/.env','/.next','/node_modules','/test-results','/playwright-report'].some(part => p.includes(part)) });
symlinkSync(resolve(root, 'node_modules'), resolve(stage, 'node_modules'), 'dir');
const web = resolve(stage, 'apps/web');
rmSync(resolve(web, 'proxy.ts'), { force: true });
writeFileSync(resolve(web,'components/export-fixture-ready.tsx'), `\"use client\"; import {useEffect} from 'react'; export function ExportFixtureReady(){useEffect(()=>{document.documentElement.dataset.exportFixtureReady='yes';},[]);return null;}`);
writeFileSync(resolve(web,'app/layout.tsx'), `import './globals.css'; import {ExportFixtureReady} from '../components/export-fixture-ready'; export default function Layout({children}:{children:React.ReactNode}) { return <html lang="es"><body>{children}<ExportFixtureReady /></body></html>; }`);
writeFileSync(resolve(web,'app/admin/escuela/layout.tsx'), `export default function Layout({children}:{children:React.ReactNode}) { return children; }`);
writeFileSync(resolve(web,'app/admin/escuela/estudiantes/page.tsx'), `
import {ConnectedSchoolPages} from '../../../../components/connected-school-pages';
import {ConnectedSchoolShell} from '../../../../components/connected-school-shell';
import type {SchoolRead,SchoolStudent} from '../../../../lib/school/contracts';
const id='4d700000-0000-4000-8000-000000000001';
export default async function Page({searchParams}:{searchParams:Promise<{q?:string;status?:string;location?:string;grade?:string}>}) {
 const {q='',status='',location='',grade=''}=await searchParams;
 const data:SchoolRead={scope:{actor_id:id,membership_id:id,role:'school_admin',account_id:id,school_id:id,account_name:'Cuenta local',school_name:'Escuela local',tenant_kind:'customer'},grades:['4','40'],locations:[{id,name:'Sede principal'}],next_cursor:id};
 const students:SchoolStudent[]=['Luna Castillo','Mateo Ventura','Alma Robles','Bruno Peña'].map((name,index)=>({id:id.slice(0,-1)+(index+2),first_name:name.split(' ')[0],last_name:name.split(' ')[1],display_name:name,student_code:'LOCAL-'+index,status:'active',enrollment:{id,starts_on:'2026-10-12',location_id:id,grade:'4',class:'A',homeroom:'Aula 1'}}));
 if(q.startsWith('BETA-'))students.unshift({...students[0],id:id.slice(0,-1)+'9',first_name:'Nuevo',last_name:'Estudiante',display_name:'Nuevo Estudiante',student_code:q});
 return <ConnectedSchoolShell context={{person_id:id,display_name:'Administrador local',schools:[{school_id:id,account_id:id,account_name:'Cuenta local',school_name:'Escuela local',tenant_kind:'customer'}]}} schoolId={id}><ConnectedSchoolPages section="students" data={data} students={q==='EMPTY'?[]:students} query={q} status={status} location={location} grade={grade}/></ConnectedSchoolShell>;
}`);
const base='http://127.0.0.1:3079';
const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3079'],{cwd:web,env:{...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false'},stdio:['ignore','pipe','pipe']});
let log='';server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
let browser;
const csv='\uFEFF"Código estudiantil","Nombre","Apellido","Nombre completo","Estado","Campus / sede","Grado","Sección","Aula / grupo"\r\n"FULL-ONLY","José","Peña","José Peña","Activo","Sede principal","4","A","Aula Ñ"\r\n';
try {
 for(let i=0;i<120;i++){try{if((await fetch(base+'/admin/escuela/estudiantes')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Local fixture server unavailable');}
 browser=await chromium.launch({headless:true});const id='4d700000-0000-4000-8000-000000000001';
 for(const [width,height] of [[390,844],[768,1024],[1440,900]]) {
 const context=await browser.newContext({viewport:{width,height},acceptDownloads:true}),page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));let mode='success',downloads=0;page.on('download',()=>downloads++);
 await page.route('**/api/school/students/export',async route=>{requests.push(route.request().postDataJSON());if(mode==='success'||mode==='empty'){await route.fulfill({status:200,contentType:'text/csv; charset=utf-8',headers:{'X-Pikas-Export-Rows':mode==='empty'?'0':'1'},body:mode==='empty'?csv.split('\r\n')[0]+'\r\n':csv});return;}await route.fulfill({status:Number(mode),json:{error:'test export failure'}});});
 await page.goto(base+'/admin/escuela/estudiantes?q=Applied&status=active&location='+id+'&grade=4');
 await page.waitForFunction(()=>document.documentElement.dataset.exportFixtureReady==='yes');
 const visible=page.getByRole('button',{name:'Exportar página visible',exact:true}),full=page.getByRole('button',{name:'Exportar todos los resultados filtrados',exact:true});
 const vd=page.waitForEvent('download');await visible.click();const download=await vd,bytes=readFileSync(await download.path()),text=bytes.toString('utf8');assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);assert.ok(download.suggestedFilename().startsWith('estudiantes-pagina-visible-'));for(const name of ['Luna','Mateo','Alma','Bruno'])assert.ok(text.includes(name));assert.equal(text.split('\r\n').length,6);assert.ok(!text.includes('FULL-ONLY')&&!text.includes(id));assert.equal(requests.length,0);
 // Unsubmitted edits do not change the applied-filter export scope.
 await page.getByLabel('Buscar estudiantes por nombre o código').fill('Unsubmitted');const fd=page.waitForEvent('download');await full.click();const complete=await fd;assert.ok(complete.suggestedFilename().startsWith('estudiantes-resultados-filtrados-'));assert.ok(readFileSync(await complete.path()).toString('utf8').includes('José Peña'));assert.deepEqual(requests,[{schoolId:id,query:'Applied',status:'active',location:id,grade:'4'}]);await page.getByText('Descarga preparada: 1 estudiantes de todos los resultados filtrados.',{exact:true}).waitFor();
 for(const [status,message] of [['413','La exportación supera el límite'],['401','Tu sesión o permisos'],['403','Tu sesión o permisos'],['502','No se pudo exportar con el servicio actual']]){mode=status;await full.click();await page.getByRole('status').filter({hasText:message}).waitFor();assert.equal(downloads,2);}
 mode='empty';await full.click();await page.getByText('No hay estudiantes que coincidan con los filtros aplicados.',{exact:true}).waitFor();assert.equal(downloads,2);
 await full.scrollIntoViewIfNeeded();for(const button of [visible,full]){const box=await button.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);}assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(stage,'export-'+width+'.png')});
 await page.goto(base+'/admin/escuela/estudiantes?q=EMPTY');await page.waitForFunction(()=>document.documentElement.dataset.exportFixtureReady==='yes');await page.getByText('Página visible: solo los 0 estudiantes cargados.',{exact:false}).waitFor();await visible.click();await page.getByText('No hay estudiantes en la página visible para exportar.',{exact:true}).waitFor();assert.equal(downloads,2);assert.deepEqual(errors,[]);console.log(`PASS ${width}: exact visible CSV/no fetch, full applied filters/one request, BOM/UTF8, empty/413/401/403/502 messaging, responsive controls.`);await context.close();
 }
 writeFileSync(resolve(stage,'verification.txt'),'390/768/1440 export checks passed; isolated source copy and intercepted API only. No DB or production access.\n');
}finally{if(browser)await browser.close();server.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
