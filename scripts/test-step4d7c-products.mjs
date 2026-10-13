// LOCAL ONLY focused browser fixture. Intercepts API; no production or DB credentials.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const stage='/private/tmp/pikas-4d7c-products';rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
for(const name of ['package.json','tsconfig.base.json','packages','apps/web'])cpSync(resolve(root,name),resolve(stage,name),{recursive:true,filter:p=>!['/.env','/.next','/node_modules','/test-results','/playwright-report'].some(part=>p.includes(part))});
symlinkSync(resolve(root,'node_modules'),resolve(stage,'node_modules'),'dir');const web=resolve(stage,'apps/web');
rmSync(resolve(web,'proxy.ts'),{force:true});
writeFileSync(resolve(web,'app/layout.tsx'),`import './globals.css';export default function Layout({children}:{children:React.ReactNode}){return <html lang="es"><body>{children}</body></html>;}`);
writeFileSync(resolve(web,'app/admin/cafeteria/layout.tsx'),`export default function Layout({children}:{children:React.ReactNode}){return children;}`);
writeFileSync(resolve(web,'app/admin/cafeteria/productos/page.tsx'),`
import {ConnectedCafeteriaProvider} from '../../../../components/connected-cafeteria-provider';
import {ConnectedCafeteriaPages} from '../../../../components/connected-cafeteria-pages';
import {ConnectedCafeteriaShell} from '../../../../components/connected-cafeteria-shell';
import {cafeteriaRead,id} from '../../../../lib/cafeteria/test-fixtures';
export default function Page(){const data=cafeteriaRead();data.categories=[{id,name:'Alimentos',status:'active',display_order:0,version:1}];data.products=[{id,name:'Pasta',description:'Descripción local',unit:'Unidad',category_id:id,price_minor:19500,active:true,available:true,ingredients:['Trigo','Agua'],allergens:['Gluten'],version:7},{id:id.slice(0,-1)+'2',name:'Producto legado',description:'',unit:'Unidad',category_id:null,price_minor:0,active:true,available:true,ingredients:[],allergens:[],version:1}];return <ConnectedCafeteriaShell context={{person_id:id,display_name:'Administrador local',cafeterias:[{cafeteria_id:id,cafeteria_name:'Cafetería local',account_name:'Cuenta local',school_name:'Escuela local',location_name:'Sede principal',tenant_kind:'customer'}]}} cafeteriaId={id}><ConnectedCafeteriaProvider data={data}><ConnectedCafeteriaPages section="products" data={data}/></ConnectedCafeteriaProvider></ConnectedCafeteriaShell>;}
`);
const base='http://127.0.0.1:3078';const server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3078'],{cwd:web,env:{...process.env,NEXT_PUBLIC_PIKAS_DEMO_MODE:'false'},stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);let browser;
try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/admin/cafeteria/productos')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===119)throw Error('Fixture server unavailable');}
 browser=await chromium.launch({headless:true});
 for(const [width,height] of [[390,844],[768,1024],[1440,900]]){
  const context=await browser.newContext({viewport:{width,height}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());const requests=[];let mode='success';
  await page.route('**/api/cafeteria',async route=>{const req=route.request();const body=req.postDataJSON();const key=req.headers()['idempotency-key'];requests.push({key,body});if(mode==='lost'){mode='denied';await route.abort();return;}if(mode==='denied'){mode='success';await route.fulfill({status:403,json:{error:'authorization'}});return;}await route.fulfill({json:{result:{request_id:key,operation:body.operation,target_id:body.payload.id}}});});
  await page.goto(base+'/admin/cafeteria/productos');const add=page.getByRole('button',{name:'Agregar producto',exact:true});await add.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Agregar producto'&&!b.disabled&&!b.closest('fieldset')?.disabled));await add.focus();await page.keyboard.press('Enter');let dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Unidad *',{exact:true}).inputValue(),'Unidad');assert.equal(await dialog.locator('input[type=file]').count(),0);await dialog.getByText('Próximamente',{exact:true}).waitFor();
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await add.evaluate(e=>e===document.activeElement),true);
  await page.getByRole('button',{name:'Editar Producto legado',exact:true}).click();dialog=page.getByRole('dialog');assert.equal(await dialog.locator('select[name=category]').inputValue(),'');await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.getByRole('button',{name:'Editar Pasta',exact:true}).click();dialog=page.getByRole('dialog');assert.equal(await dialog.getByLabel('Ingredientes',{exact:true}).inputValue(),'Trigo\nAgua');assert.equal(await dialog.getByLabel('Alérgenos',{exact:true}).inputValue(),'Gluten');
  await dialog.getByLabel('Unidad *',{exact:true}).fill(' ');await dialog.getByRole('button',{name:'Guardar cambios'}).click();await dialog.getByRole('alert').waitFor();assert.equal(requests.length,0);
  await dialog.getByLabel('Unidad *',{exact:true}).fill('Porción');await dialog.locator('input[name=price]').fill('199.50');await dialog.getByRole('switch').uncheck();
  const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=height);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await dialog.getByRole('button',{name:'Guardar cambios'}).scrollIntoViewIfNeeded();await page.screenshot({path:resolve(stage,'edit-'+width+'.png')});
  mode='lost';await dialog.getByRole('button',{name:'Guardar cambios'}).click();await dialog.getByRole('button',{name:'Confirmar solicitud pendiente'}).waitFor();const original=requests.at(-1);assert.deepEqual(original.body.payload,{id:'4d300000-0000-4000-8000-000000000001',version:7,name:'Pasta',description:'Descripción local',category:'Alimentos',price_minor:19950,unit:'Porción',active:true,available:false,ingredients:['Trigo','Agua'],allergens:['Gluten']});assert.equal(await dialog.getByLabel('Unidad *',{exact:true}).isDisabled(),true);
  await dialog.getByRole('button',{name:'Confirmar solicitud pendiente'}).click();await dialog.getByRole('alert').waitFor();assert.deepEqual(requests.at(-1),original);await dialog.getByRole('button',{name:'Confirmar solicitud pendiente'}).click();await dialog.waitFor({state:'detached'});assert.deepEqual(requests.at(-1),original);
  await add.click();dialog=page.getByRole('dialog');await dialog.getByLabel('Nombre del producto *',{exact:true}).fill('Producto nuevo');await dialog.locator('input[name=price]').fill('0.00');
  await dialog.getByRole('button',{name:'Agregar producto',exact:true}).click();assert.equal(await dialog.locator('select[name=category]').evaluate(e=>e.validity.valueMissing),true);
  await dialog.locator('select[name=category]').selectOption('__new');await dialog.getByLabel('Nombre de la nueva categoría *',{exact:true}).fill('Bebidas');await dialog.getByLabel('Ingredientes',{exact:true}).fill('Agua\nLimón');await dialog.getByRole('button',{name:'Agregar producto',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(requests.at(-1).body.payload.unit,'Unidad');assert.equal(requests.at(-1).body.payload.category,'Bebidas');assert.equal(requests.at(-1).body.payload.price_minor,0);assert.deepEqual(requests.at(-1).body.payload.ingredients,['Agua','Limón']);
  await page.getByLabel('Buscar productos').fill('does-not-exist');await page.getByRole('button',{name:'Limpiar filtros'}).click();await page.getByRole('button',{name:'Editar Pasta',exact:true}).waitFor();
  await page.screenshot({path:resolve(stage,'catalog-'+width+'.png')});assert.deepEqual(errors,[]);console.log('PASS '+width+': catalog, category/legacy, required unit, zero price, lists, images deferred, portal/dialog/focus, exact lost-response/403 recovery, viewport bounds.');await context.close();
 }
 writeFileSync(resolve(stage,'verification.txt'),'390/768/1440 product presentation and exact request recovery passed using a local fixture and intercepted API. Database round-trip is tested separately.\n');
}finally{if(browser)await browser.close();server.kill('SIGTERM');writeFileSync(resolve(stage,'server.log'),log);}
