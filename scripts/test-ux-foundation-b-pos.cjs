// Local-only POS guard verification; checkout is intercepted, never submitted to the server.
const {chromium}=require('@playwright/test');
const fs=require('fs'),assert=require('assert/strict');
const fixtures=JSON.parse(fs.readFileSync('/tmp/pikas-ux-audit/accounts.json')),operator=JSON.parse(fs.readFileSync('/tmp/pikas-ux-audit/holistic-operator.json'));
(async()=>{
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();context.setDefaultTimeout(15000);context.setDefaultNavigationTimeout(15000);
let switches=0,checkouts=0,confirmMode='dismiss',dialogs=0;const sessions=new Set(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('dialog',async d=>{dialogs++;await d[confirmMode]();});
page.on('request',r=>{if(r.url().endsWith('/sandbox-pov/switch'))switches++;});
await context.route('**/api/pos',async route=>{
 const body=route.request().postDataJSON();
 if(body.operation==='checkout'){checkouts++;return route.fulfill({status:502,json:{error:'simulated_unconfirmed_local_test'}});}
 assert.ok(['bootstrap','search','customer'].includes(body.operation),'No register or financial writes in guard test');
 if(body.operation==='bootstrap'){
  const response=await route.fetch(),data=await response.json();assert.ok(data.result.session,'Existing open sandbox register required');sessions.add(data.result.session.session_id);
  data.result.catalog={cafeteria_id:data.result.session.cafeteria_id,status:'manual',currency_code:'DOP',service_shift:null,menu:null,products:[{product_id:'11111111-1111-4111-8111-111111111199',name:'Producto ficticio de prueba UX B',description:null,category_id:null,category_name:null,price_minor:'1000',currency_code:'DOP',version:1}]};data.result.blocked=null;
  return route.fulfill({status:200,json:data});
 }
 return route.continue();
});
async function choose(label,path){await page.getByRole('complementary',{name:'Entorno Demo'}).locator('summary').click();await page.getByRole('button',{name:label,exact:true}).click();if(path)await page.waitForURL(path);}
async function ready(){await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='No Usuario'&&!b.disabled),null,{timeout:15000});}
try{
await page.goto('http://localhost:3070/backoffice/login');await page.locator('[name=identifier]').fill(operator.email);await page.locator('[name=password]').fill(fixtures.password);await page.getByRole('button',{name:'Entrar al backoffice'}).click();await page.waitForURL('**/platform');await page.goto('http://localhost:3070/platform/demostracion');await page.getByRole('button',{name:'Explorar Caja / POS',exact:true}).click();await page.waitForURL('**/pos');await ready();
await page.getByRole('button',{name:'No Usuario',exact:true}).click();await page.getByRole('button',{name:'Añadir Producto ficticio de prueba UX B'}).click();await page.getByRole('button',{name:'Continuar al pago',exact:true}).click();await page.getByText('Sin seleccionar',{exact:true}).waitFor();await page.getByRole('button',{name:'Efectivo',exact:true}).click();await page.getByLabel('Efectivo recibido (DOP)').fill('200');
const count=switches;await choose('Cafetería');assert.equal(switches,count);assert.ok(page.url().endsWith('/pos'));assert.equal(await page.getByLabel('Efectivo recibido (DOP)').inputValue(),'200');
confirmMode='accept';await choose('Cafetería','**/admin/cafeteria?cafeteria=*');await choose('Caja / POS','**/pos');await ready();assert.equal(await page.getByLabel('Efectivo recibido (DOP)').count(),0);
await page.getByRole('button',{name:'Caja',exact:true}).click();assert.equal(await page.getByText('Efectivo esperado',{exact:false}).count(),0);await page.getByLabel('Efectivo contado al cierre').fill('99');
confirmMode='dismiss';const beforeCount=switches;await choose('Escuela');assert.equal(switches,beforeCount);assert.equal(await page.getByLabel('Efectivo contado al cierre').inputValue(),'99');
confirmMode='accept';await choose('Escuela','**/admin/escuela?school=*');await choose('Caja / POS','**/pos');await ready();await page.getByRole('button',{name:'Caja',exact:true}).click();assert.equal(await page.getByLabel('Efectivo contado al cierre').inputValue(),'');await page.getByRole('button',{name:'Venta',exact:true}).click();
await page.getByRole('button',{name:'No Usuario',exact:true}).click();await page.getByRole('button',{name:'Añadir Producto ficticio de prueba UX B'}).click();await page.getByRole('button',{name:'Continuar al pago',exact:true}).click();await page.getByRole('button',{name:'Efectivo',exact:true}).click();await page.getByLabel('Efectivo recibido (DOP)').fill('20');await page.getByRole('button',{name:'Cobrar RD$ 10.00',exact:true}).click();await page.getByText('El resultado del cobro no está confirmado.',{exact:false}).waitFor();
const saved=await page.evaluate(()=>sessionStorage.getItem('pikas:connected-pos:pending:v1')),beforePending=switches;await choose('Escuela');await page.getByText('Hay una operación pendiente de confirmar.',{exact:false}).waitFor();await page.getByRole('button',{name:'Salir del demo',exact:true}).click();assert.equal(switches,beforePending);assert.equal(await page.evaluate(()=>sessionStorage.getItem('pikas:connected-pos:pending:v1')),saved);assert.equal(checkouts,1);assert.equal(sessions.size,1);assert.equal(await page.getByRole('button',{name:'Reintentar misma venta',exact:true}).count(),1);assert.deepEqual(errors,[]);
await page.screenshot({path:'/tmp/pikas-foundation-b/browser/pos-unconfirmed-390.png',fullPage:true});const result={draftDiscardConfirmations:dialogs,uncertainCheckoutBlocksSwitchAndExit:true,exactJournalRetained:true,noAutomaticReplay:checkouts===1,unchangedOpenRegisterSession:[...sessions][0],financialRequestsReachedServer:0,syntheticCatalogOnlyInBrowser:true};fs.writeFileSync('/tmp/pikas-foundation-b/browser/pos-guards.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch(e){console.error(page.url(),(await page.locator('body').innerText()).slice(0,1600));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
