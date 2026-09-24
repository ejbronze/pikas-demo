import {test,expect,type Page} from '@playwright/test';
import {confirmSale,invoke,snapshot} from './helpers';
async function pos(page:Page){
  await page.context().request.post('/api/auth/login',{form:{role:'pos',identifier:'cafeteria@demo.pikas.do',password:'pikas-demo'}});
  await page.goto('/pos');await expect(page.getByLabel('Estado de caja').filter({visible:true})).toContainText('Online');
}
async function footer(page:Page){
  const bar=page.locator('footer[aria-label="Estado de caja"]:visible');await expect(bar).toBeVisible();
  const box=(await bar.boundingBox())!;expect(box.y).toBeGreaterThan(page.viewportSize()!.height-110);expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize()!.height+1);
  return bar;
}
async function payment(page:Page){await page.getByRole('button',{name:'Usuario PIKAS',exact:true}).click();await page.getByLabel('Código estudiantil / NFC').filter({visible:true}).fill('PK-10982');await page.getByRole('button',{name:'Comprobar estudiante'}).click();await page.getByRole('article').filter({hasText:'Pasta con pollo'}).getByRole('button',{name:'Añadir al carrito'}).click();await page.getByRole('button',{name:'Continuar al pago'}).click();await page.getByRole('button',{name:'Elegir efectivo'}).click();await page.getByLabel('Efectivo recibido (RD$)').filter({visible:true}).fill('200')}

test('compact footer persists across entry, lookup, products, payment, receipt and history',async({page})=>{
  await pos(page);await footer(page);await expect(page.locator('header:visible')).not.toContainText('Online');
  await page.getByRole('button',{name:'Usuario PIKAS',exact:true}).click();await footer(page);await page.getByLabel('Código estudiantil / NFC').filter({visible:true}).fill('PK-10982');await page.getByRole('button',{name:'Comprobar estudiante'}).click();await footer(page);
  await page.getByRole('article').filter({hasText:'Pasta con pollo'}).getByRole('button',{name:'Añadir al carrito'}).click();await page.getByRole('button',{name:'Continuar al pago'}).click();await footer(page);await confirmSale(page);const bar=await footer(page);await expect(bar.getByTestId('shift-count')).toHaveText('· 1 transacción');await expect(bar.getByTestId('shift-sales')).toContainText('RD$180.00');await page.getByRole('button',{name:'Ver recibo'}).click();await footer(page);await page.getByRole('button',{name:'Transacciones',exact:true}).click();await footer(page);
});

test('cashier workspace keeps catalog, cart and utilities distinct',async({page})=>{
  await pos(page);await expect(page.getByRole('button',{name:'Herramientas',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Venta',exact:true})).toHaveAttribute('aria-current','page');await page.getByRole('button',{name:'No usuario',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Productos',exact:true})).toBeVisible();await expect(page.locator('.pos-product-tile')).toHaveCount(5);await page.getByRole('button',{name:'Almuerzo',exact:true}).click();await expect(page.locator('.pos-product-tile')).toHaveCount(3);await page.getByRole('button',{name:'Añadir al carrito'}).first().click();await expect(page.getByRole('heading',{name:'Carrito persistente'}).locator('..')).toContainText('Total');await page.getByRole('button',{name:'Transacciones',exact:true}).click();await expect(page.getByRole('button',{name:'Transacciones',exact:true})).toHaveAttribute('aria-current','page');await expect(page.getByRole('heading',{name:'Historial POS'})).toBeVisible();await page.getByRole('button',{name:'Venta',exact:true}).click();await expect(page.getByRole('heading',{name:'Carrito persistente'})).toHaveCount(1);await page.getByRole('button',{name:'Calculadora',exact:true}).click();await expect(page.getByRole('dialog',{name:'Calculadora',exact:true})).toBeVisible();
});

test('catalog gallery and list views preserve browsing and sale state',async({page})=>{
  await pos(page);await page.getByRole('button',{name:'No usuario',exact:true}).click();await expect(page.getByRole('button',{name:'Vista de galería'})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'Añadir al carrito'}).first().click();await page.getByRole('button',{name:'Vista de lista'}).click();await expect(page.getByRole('button',{name:'Vista de lista'})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('heading',{name:'Carrito persistente'}).locator('..')).toContainText('Total');
  await expect(page.locator('.pos-catalog-header')).toBeVisible();await expect(page.locator('.pos-catalog-results')).toBeVisible();
    await expect(page.locator('.pos-list-hit [role="img"]')).toHaveCount(0);
  const names=await page.locator('.pos-list-row strong.block').allTextContents();expect(names).toEqual([...names].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})));await page.getByRole('button',{name:'Bebidas',exact:true}).click();await expect(page.locator('.pos-list-row')).toHaveCount(1);await page.getByLabel('Buscar producto').fill('Pasta');await expect(page.locator('.pos-list-row')).toHaveCount(0);await page.getByLabel('Buscar producto').fill('');await page.getByRole('button',{name:'Vista de galería'}).click();await expect(page.locator('.pos-product-tile')).toHaveCount(1);await expect(page.getByRole('button',{name:'Vista de galería'})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.pos-gallery-hit img, .pos-gallery-hit [role="img"]')).toHaveCount(1);
});

test('footer respects all cashier visibility settings and real connection states with reduced motion',async({page,context})=>{
  await pos(page);await invoke(page,'voidPos',['fixture','ux-policy-fixture']);
  await context.request.post('/api/auth/admin-login',{form:{identifier:'admin.cafeteria@demo.pikas.do',password:'pikas-demo'}});await page.goto('/admin/cafeteria/configuracion');
  const policy=(await snapshot(page)).posPolicy;expect((await invoke(page,'savePosPolicy',[{...policy,showSales:false,showCount:false,showShiftStart:false,showRegister:false}])).ok).toBe(true);
  await pos(page);let bar=await footer(page);await expect(bar.getByTestId('shift-sales')).toHaveCount(0);await expect(bar.getByTestId('shift-count')).toHaveCount(0);await expect(bar.getByTestId('shift-start')).toHaveCount(0);await expect(page.locator('header:visible')).not.toContainText('Caja 1');
  const dot=bar.locator('.pos-status-dot');await expect(dot).toHaveAttribute('data-state','Online');await expect(dot).toHaveCSS('animation-name','pos-online-pulse');await page.emulateMedia({reducedMotion:'reduce'});await expect(dot).toHaveCSS('animation-name','none');
  await context.setOffline(true);await expect(bar).toContainText('Offline');await expect(dot).toHaveAttribute('data-state','Offline');await expect(dot).toHaveCSS('animation-name','none');await context.setOffline(false);await expect(bar).toContainText('Online');
  await page.route('**/api/demo/session',r=>r.fulfill({status:503,json:{error:'test'}}));await invoke(page,'retryConnection');await expect(bar).toContainText('Sync Issue');await expect(dot).toHaveAttribute('data-state','Sync Issue');
  await page.unroute('**/api/demo/session');let release!:()=>void;const gate=new Promise<void>(r=>release=r);await page.route('**/api/demo/session',async route=>{await gate;await route.continue()});await page.getByRole('button',{name:'Reintentar conexión'}).click();await expect(bar).toContainText('Connecting');await expect(dot).toHaveAttribute('data-state','Connecting');release();await expect(bar).toContainText('Online');bar=await footer(page);
});

test('calculator overlay supports keypad, keyboard, focus, close/reopen and leaves cash transaction untouched',async({page},testInfo)=>{
  await pos(page);await payment(page);const before=await snapshot(page);const cash=page.getByLabel('Efectivo recibido (RD$)').filter({visible:true});const paymentBox=await page.getByRole('heading',{name:'Validación y pago'}).evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}});
  const trigger=page.getByRole('button',{name:'Calculadora',exact:true});await trigger.click();const dialog=page.getByRole('dialog',{name:'Calculadora',exact:true}),display=dialog.getByLabel('Resultado de calculadora');await expect(dialog).toBeVisible();await expect(dialog).toHaveCSS('position','fixed');await expect(display).toBeFocused();await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);await display.focus();expect(await page.getByRole('heading',{name:'Validación y pago'}).evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}})).toEqual(paymentBox);
  for(const key of ['2','5','Sumar','5','0','Igual'])await dialog.getByRole('button',{name:key,exact:true}).click();await expect(display).toHaveText('75');
  await page.keyboard.press('Delete');await page.keyboard.type('12.5*4');await page.keyboard.press('Enter');await expect(display).toHaveText('50');await page.keyboard.type('/2');await page.keyboard.press('=');await expect(display).toHaveText('25');await page.keyboard.type('-5');await page.keyboard.press('Enter');await expect(display).toHaveText('20');await page.keyboard.press('Delete');await page.keyboard.type('123');await page.keyboard.press('Backspace');await expect(display).toHaveText('12');
  await page.screenshot({path:testInfo.outputPath('calculator-payment.png')});await dialog.getByRole('button',{name:'Cerrar calculadora'}).click();await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();await expect(cash).toHaveValue('200');await expect(page.getByText('Cambio: RD$20.00',{exact:true})).toBeVisible();expect(await snapshot(page)).toEqual(before);
  await trigger.click();await expect(display).toHaveText('12');await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();await cash.fill('250');await expect(cash).toHaveValue('250');await expect(page.getByRole('heading',{name:'Sofi',exact:true})).toBeVisible();await confirmSale(page);const after=await snapshot(page);expect(after.purchases[0]).toMatchObject({totalMinor:18000,cashReceivedMinor:25000,changeProvidedMinor:7000});
});

test('calculator drag is confined to title bar and stays reachable after drag and resize',async({page})=>{
  await pos(page);await page.getByRole('button',{name:'Calculadora',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Calculadora',exact:true});const title=dialog.getByRole('button',{name:'Mover calculadora'});const before=(await dialog.boundingBox())!;
  if(page.viewportSize()!.width>=640){
    const box=(await title.boundingBox())!;await page.mouse.move(box.x+80,box.y+22);await page.mouse.down();await page.mouse.move(box.x-160,box.y+100,{steps:8});await page.mouse.up();const moved=(await dialog.boundingBox())!;expect(moved.x).toBeLessThan(before.x);expect(moved.y).toBeGreaterThan(before.y);
    await title.focus();await page.keyboard.press('ArrowLeft');expect((await dialog.boundingBox())!.x).toBeLessThan(moved.x);
    const titleBox=(await title.boundingBox())!;await page.mouse.move(titleBox.x+50,titleBox.y+20);await page.mouse.down();await page.mouse.move(-500,-500,{steps:5});await page.mouse.up();
  }
  await page.setViewportSize({width:320,height:568});const box=(await dialog.boundingBox())!;await expect.poll(async()=>{const b=(await dialog.boundingBox())!;return b.x>=0&&b.y>=0&&b.x+b.width<=320&&b.y+b.height<=568}).toBe(true);expect(box.width).toBeLessThanOrEqual(304);await expect(dialog.getByRole('button',{name:'Cerrar calculadora'})).toBeInViewport();await dialog.getByRole('button',{name:'9',exact:true}).click();await expect(dialog.getByLabel('Resultado de calculadora')).toHaveText('9');await page.keyboard.press('Escape');await footer(page);
});
