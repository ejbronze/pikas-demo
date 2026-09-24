import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {confirmSale,demoKey,invoke,snapshot} from './helpers';
async function login(context:BrowserContext,role='parent'){
  const admin=role.endsWith('_admin');
  await context.request.post(admin?'/api/auth/admin-login':'/api/auth/login',{form:admin?{identifier:role==='school_admin'?'admin.escuela@demo.pikas.do':'admin.cafeteria@demo.pikas.do',password:'pikas-demo'}:{role,identifier:role==='student'?'PK-10982':'familia@demo.pikas.do',password:'pikas-demo'}});
}
async function pos(page:Page,context:BrowserContext){await login(context,'pos');await page.goto('/pos');await expect(page.getByLabel('Estado de caja').filter({visible:true})).toContainText('Online')}
async function identify(page:Page){await page.getByRole('button',{name:'Usuario PIKAS',exact:true}).click();await page.getByLabel('Código estudiantil / NFC').fill('PK-10982');await page.getByRole('button',{name:'Comprobar estudiante'}).click();await expect(page.getByRole('heading',{name:'Sofi',exact:true})).toBeVisible()}
async function add(page:Page){await page.getByRole('article').filter({hasText:'Pasta con pollo'}).getByRole('button',{name:'Añadir al carrito'}).click()}
async function seed(page:Page,change:(state:any)=>void){const state=await snapshot(page);change(state);await page.evaluate(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:demoKey,state});await page.reload()}
async function persist(page:Page){expect((await invoke(page,'voidPos',['audit fixture','fixture-void-key'])).ok).toBe(true)}

test('duplicate codes fail at creation and regeneration; ambiguous lookup fails and name selection uses stable ID',async({page,context})=>{
  await login(context);await page.goto('/familias/estudiantes');await page.getByRole('button',{name:'Añadir',exact:true}).click();
  const form=page.locator('form').filter({has:page.getByRole('heading',{name:'Añadir estudiante'})});
  for(const [name,value] of [['first','Audit'],['last','Demo'],['preferred','Audit'],['grade','4A'],['code','PK-10982'],['daily','350'],['purchase','250']])await form.locator(`[name="${name}"]`).fill(value);
  await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByRole('alert')).toContainText('duplicado');
  // Use the mutation boundary directly too; no duplicate may be persisted.
  const record={firstName:'Audit',lastName:'Demo',preferredName:'Audit',grade:'4A',code:'PK-10982',dailyLimit:350,perPurchaseLimit:250,allergies:[],blocked:[]};
  expect((await invoke(page,'addStudent',[record])).ok).toBe(false);
  await login(context,'school_admin');await page.goto('/admin/escuela/estudiantes');
  expect((await invoke(page,'adminAddStudent',[record])).ok).toBe(false);
  // Persist via an allowed nonfinancial edit, then test regeneration collision.
  await page.getByRole('button',{name:'Editar grado'}).first().click();await expect(page.getByRole('status')).toContainText('actualizado');
  let state=await snapshot(page);expect(state.students).toHaveLength(2);
  expect((await invoke(page,'adminUpdateStudent',[{...state.students[1],code:'PK-10982'}])).ok).toBe(false);
  await pos(page,context);await persist(page);
  await seed(page,s=>s.students.push({...s.students[0],id:'audit-student',preferredName:'Audit',firstName:'Audit',lastName:'Demo',balance:777}));
  await page.getByRole('button',{name:'Usuario PIKAS',exact:true}).click();await page.getByLabel('Código estudiantil / NFC').fill('PK-10982');await page.getByRole('button',{name:'Comprobar estudiante'}).click();await expect(page.getByRole('alert').filter({hasText:'Código ambiguo'})).toBeVisible();await expect(page.getByText(/Saldo PIKAS RD\$/)).toHaveCount(0);
  await page.getByLabel('Código estudiantil / NFC').fill('Audit');await page.getByRole('button',{name:/Audit Demo/}).click();await expect(page.getByRole('heading',{name:'Audit',exact:true})).toBeVisible();await expect(page.getByText('Saldo PIKAS RD$777.00',{exact:true})).toBeVisible();state=await snapshot(page);expect(state.students.find((s:any)=>s.id==='sofia').balance).toBe(2450);
});

test('stale admin screen cannot mutate after shared session changes to POS',async({page,context})=>{
  await login(context,'cafeteria_admin');await page.goto('/admin/cafeteria/menu');
  await expect(page.getByRole('heading',{name:'Menú y productos'})).toBeVisible();
  await login(context,'pos');page.once('dialog',dialog=>dialog.accept());await page.getByRole('article').filter({hasText:'Pasta con pollo'}).getByRole('button',{name:'+ RD$5'}).click();
  await expect(page.getByRole('heading',{name:'La sesión ha cambiado'})).toBeVisible();
  await page.goto('/pos');await persist(page);expect((await snapshot(page)).menuItems.find((i:any)=>i.id==='menu-pasta').priceMinor).toBe(18000);
});

test('legacy mutation boundary rejects wrong roles, inactive account, and membership scope',async({page,context})=>{
  await pos(page,context);await persist(page);const before=await snapshot(page),student=before.students[0],menu=before.menuItems[0];
  for(const [name,args] of [['adminUpdateMenu',[{...menu,priceMinor:18500}]],['adminAddMenu',[{...menu,id:'forbidden'}]],['adminUpdateStudent',[{...student,dailyLimit:9999}]],['adminAddStudent',[{...student,code:'PK-99999'}]],['adminAddUser',[before.administration.users[0]]],['adminSetUserStatus',['pos-1','suspended']],['adminSetPartnership',['partner-active','revoked']],['archive',['sofia']],['saveParent',[{name:'bad'}]],['saveBudget',['bad',10]],['resetDemo',[]],['savePosPolicy',[{...before.posPolicy,allowCashierRefunds:true}]]] as Array<[string,unknown[]]>)expect((await invoke(page,name,args)).ok,name).toBe(false);
  expect(await snapshot(page)).toEqual(before);
  await login(context,'cafeteria_admin');await page.goto('/admin/cafeteria/menu');
  await seed(page,s=>s.administration.memberships.find((m:any)=>m.userId==='ca-1').location='outside');expect((await invoke(page,'adminUpdateMenu',[{...menu,priceMinor:18500}])).ok).toBe(false);
  await seed(page,s=>{s.administration.memberships.find((m:any)=>m.userId==='ca-1').location='Caja principal';s.administration.users.find((u:any)=>u.id==='ca-1').status='suspended'});expect((await invoke(page,'adminUpdateMenu',[{...menu,priceMinor:18500}])).ok).toBe(false);
});

for(const scopes of [['eligibility'],['eligibility','transactions'],['eligibility','balance'],['eligibility','limits'],['eligibility','restrictions'],['eligibility','balance','limits','restrictions','transactions']])test(`scope projection and checkout boundary: ${scopes.join('+')}`,async({page,context})=>{
  await pos(page,context);await persist(page);await seed(page,s=>s.administration.partnerships.find((p:any)=>p.id==='partner-active').scope=scopes);await identify(page);
  const projected=await invoke(page,'selectPosCustomer',['sofia']);
  expect('balanceMinor' in projected).toBe(scopes.includes('balance'));expect('spentTodayMinor' in projected).toBe(scopes.includes('limits'));expect('allergies' in projected).toBe(scopes.includes('restrictions'));
  await expect(page.getByText(/Saldo PIKAS RD\$/)).toHaveCount(scopes.includes('balance')?1:0);await expect(page.getByText(/Permitido hoy:/)).toHaveCount(scopes.includes('limits')?1:0);await expect(page.getByRole('article').filter({hasText:'Pizza escolar'})).toContainText(scopes.includes('restrictions')?'Lactosa':'Sin permiso');
  const result=await invoke(page,'checkoutPos',['sofia',[{itemId:'menu-pasta',quantity:1}],'scope-checkout','student_wallet']);expect(result.ok).toBe(scopes.length===5);expect((await snapshot(page)).purchases).toHaveLength(scopes.length===5?1:0);
});

test('parent removes and adds a canonical restriction visible to POS',async({page,context})=>{
  await login(context);await page.goto('/familias/estudiantes/sofia');await page.getByLabel('Productos bloqueados',{exact:true}).fill('');await page.getByRole('button',{name:'Guardar controles'}).click();await expect(page.getByRole('status')).toContainText('Controles de alimentación guardados');
  expect((await snapshot(page)).students[0].blockedProductIds).toEqual([]);await pos(page,context);await identify(page);await expect(page.getByRole('article').filter({hasText:'Bebidas energéticas'}).getByRole('button',{name:'Añadir al carrito'})).toBeEnabled();
  await login(context);await page.goto('/familias/estudiantes/sofia');await page.getByLabel('Productos bloqueados',{exact:true}).fill('Bebidas energéticas');await page.getByRole('button',{name:'Guardar controles'}).click();await expect(page.getByRole('status')).toContainText('Controles de alimentación guardados');await pos(page,context);await identify(page);await expect(page.getByRole('article').filter({hasText:'Bebidas energéticas'}).getByRole('button',{name:'Añadir al carrito'})).toBeDisabled();
});

test('session HTTP failure blocks checkout, shows Sync Issue and explicitly recovers',async({page,context})=>{
  await pos(page,context);await page.getByRole('button',{name:'No usuario',exact:true}).click();await add(page);await page.getByRole('button',{name:'Continuar al pago'}).click();await page.getByRole('button',{name:'Monto exacto'}).click();
  await page.route('**/api/demo/session',r=>r.fulfill({status:503,json:{error:'unavailable'}}));await page.getByRole('button',{name:'Confirmar venta'}).click();await expect(page.getByLabel('Estado de caja').filter({visible:true})).toContainText('Sync Issue');await expect(page.getByRole('button',{name:'Confirmar venta'})).toBeDisabled();expect((await snapshot(page)).purchases??[]).toHaveLength(0);
  await page.unroute('**/api/demo/session');await page.getByRole('button',{name:'Reintentar conexión'}).click();await expect(page.getByLabel('Estado de caja').filter({visible:true})).toContainText('Online');await confirmSale(page);expect((await snapshot(page)).purchases).toHaveLength(1);
});

test('mixed cash events reconcile and cash refund summaries show amount and destination',async({page,context})=>{
  await pos(page,context);await identify(page);await add(page);await page.getByRole('button',{name:'Continuar al pago'}).click();await page.getByRole('button',{name:'Elegir efectivo'}).click();await page.getByRole('button',{name:'Monto exacto'}).click();await confirmSale(page);
  const purchase=(await snapshot(page)).purchases[0];expect((await invoke(page,'replenishPos',['sofia',50000,'replenish-once'])).ok).toBe(true);expect((await invoke(page,'replenishPos',['sofia',50000,'replenish-once'])).ok).toBe(true);
  await login(context,'cafeteria_admin');await page.goto('/admin/cafeteria/transacciones');let state=await snapshot(page);expect((await invoke(page,'savePosPolicy',[{...state.posPolicy,partialRefunds:true}])).ok).toBe(true);
  expect((await invoke(page,'refundPos',[purchase.id,10000,'Entrega parcial','refund-once'])).ok).toBe(true);expect((await invoke(page,'refundPos',[purchase.id,10000,'Entrega parcial','refund-once'])).ok).toBe(true);
  state=await snapshot(page);expect(state.events.filter((e:any)=>e.type==='replenishment')).toHaveLength(1);expect(state.events.filter((e:any)=>e.type==='refund')).toHaveLength(1);expect(state.students[0]).toMatchObject({balance:2950,spentToday:240});expect(state.purchases[0]).toEqual(purchase);
  for(const [label,value]of [['Ventas brutas en efectivo','RD$180.00'],['Recargas recibidas en efectivo','RD$500.00'],['Reembolsos en efectivo','RD$100.00'],['Cierre esperado','RD$580.00']])await expect(page.getByText(label,{exact:true}).locator('..')).toContainText(value);
  await login(context);await page.goto('/familias/transacciones');await expect(page.getByText('Devuelto en efectivo',{exact:true})).toBeVisible();await expect(page.getByText('Devuelto en efectivo',{exact:true}).locator('..')).toContainText('RD$100.00');
});

test('refund integration rejects cumulative excess, invalid status, unauthorized callers and changed policy',async({page,context})=>{
  await pos(page,context);await identify(page);await add(page);await page.getByRole('button',{name:'Continuar al pago'}).click();await confirmSale(page);const purchase=(await snapshot(page)).purchases[0];
  expect((await invoke(page,'refundPos',[purchase.id,18000,'Blocked','off'])).ok).toBe(false);
  await login(context,'cafeteria_admin');await page.goto('/admin/cafeteria/transacciones');let policy=(await snapshot(page)).posPolicy;await invoke(page,'savePosPolicy',[{...policy,partialRefunds:true,allowCashierRefunds:true,requireApproval:false}]);
  await invoke(page,'refundPos',[purchase.id,10000,'Partial','partial-1']);expect((await invoke(page,'refundPos',[purchase.id,8001,'Excess','partial-excess'])).ok).toBe(false);
  await seed(page,s=>s.purchases[0].status='voided');expect((await invoke(page,'refundPos',[purchase.id,8000,'Invalid','invalid'])).ok).toBe(false);await seed(page,s=>s.purchases[0].status='completed');
  await login(context);await page.goto('/familias');expect((await invoke(page,'refundPos',[purchase.id,8000,'Unauthorized','parent-refund'])).ok).toBe(false);
  await login(context,'cafeteria_admin');await page.goto('/admin/cafeteria/transacciones');policy=(await snapshot(page)).posPolicy;await invoke(page,'savePosPolicy',[{...policy,allowCashierRefunds:false}]);await pos(page,context);expect((await invoke(page,'refundPos',[purchase.id,8000,'Policy changed','changed'])).ok).toBe(false);expect((await snapshot(page)).events.filter((e:any)=>e.type==='refund')).toHaveLength(1);
});

test('administrative Today uses Santo Domingo calendar boundaries',async({page,context})=>{
  await page.clock.install({time:new Date('2026-09-23T04:00:00Z')});await pos(page,context);await page.getByRole('button',{name:'No usuario',exact:true}).click();await add(page);await page.getByRole('button',{name:'Continuar al pago'}).click();await page.getByRole('button',{name:'Monto exacto'}).click();await confirmSale(page);
  await seed(page,s=>{s.purchases[0].createdAt='2026-09-23T04:00:00Z';s.purchases.push({...s.purchases[0],id:'yesterday',idempotencyKey:'yesterday',createdAt:'2026-09-23T03:59:59Z'})});await login(context,'cafeteria_admin');await page.goto('/admin/cafeteria');await expect(page.getByText('Ventas de hoy',{exact:true}).locator('..')).toContainText('RD$180.00');await page.goto('/admin/cafeteria/transacciones');await page.getByLabel('Filtrar fecha').selectOption('today');await expect(page.getByText('Ventas filtradas',{exact:true}).locator('..')).toContainText('RD$180.00');
});
