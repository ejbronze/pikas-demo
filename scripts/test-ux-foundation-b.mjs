// Local-only browser verification. Uses existing fictional audit fixtures, never provisions data.
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = process.env.PIKAS_UX_B_URL ?? 'http://localhost:3070';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local app only');
const fixtures = JSON.parse(readFileSync(process.env.PIKAS_UX_B_FIXTURES ?? '/tmp/pikas-ux-audit/accounts.json'));
const operator = JSON.parse(readFileSync(process.env.PIKAS_UX_B_OPERATOR ?? '/tmp/pikas-ux-audit/holistic-operator.json'));
const output = process.env.PIKAS_UX_B_OUTPUT ?? '/tmp/pikas-foundation-b/browser';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const evidence = [];
let activePage;
async function login(page, user = operator, platform = true) {
  await page.goto(base + (platform ? '/backoffice/login' : '/login'));
  await page.locator('input[name=identifier]').fill(user.email);
  await page.locator('input[name=password]').fill(fixtures.password);
  await page.locator('form button[type=submit], form button:not([type])').last().click();
  await page.waitForURL(platform ? '**/platform' : /\/(admin|pilot|pos)/);
  await page.getByRole('heading', { name: /Verificando tu sesión/ }).waitFor({ state: 'hidden' });
}
async function check(page, name, width) {
  await page.getByRole('complementary', { name: 'Entorno Demo' }).waitFor();
  assert.equal(await page.getByRole('complementary', { name: 'Entorno Demo' }).count(), 1);
  assert.equal(await page.locator('form[action="/api/auth/logout"]').count(), 0, 'Demo shells do not sign out the operator');
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.width, `No overflow: ${name} ${width}`);
  const bar = await page.getByRole('complementary', { name: 'Entorno Demo' }).boundingBox();
  const header = await page.locator('header:visible').first().boundingBox();
  assert.ok(bar.height <= 45); assert.ok(header.height <= 56);
  await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
  return { bar: bar.height, header: header.height, contentStart: bar.y + bar.height };
}
async function switchTo(page, label, route) {
  await page.getByRole('complementary', { name: 'Entorno Demo' }).locator('summary').click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForURL(route);
  await page.getByRole('complementary', { name: 'Entorno Demo' }).waitFor();
}
try {
  const setupContext = await browser.newContext({viewport:{width:390,height:900}});
  setupContext.setDefaultTimeout(15000); setupContext.setDefaultNavigationTimeout(15000);
  const setupPage = await setupContext.newPage(); activePage = setupPage;
  await login(setupPage);
  await setupPage.goto(base + '/platform/demostracion');
  await setupPage.getByRole('button',{name:'Explorar Caja / POS',exact:true}).click(); await setupPage.waitForURL('**/pos');
  await setupPage.getByRole('button',{name:'Caja',exact:true}).click();
  await setupPage.waitForFunction(() => document.body.textContent.includes('Caja abierta ·') || document.body.textContent.includes('Abre una caja asignada para comenzar a vender.'),null,{timeout:20000});
  let localDataAdded = null;
  if (await setupPage.getByRole('button',{name:'Abrir caja',exact:true}).count()) {
    await setupPage.getByLabel('Fondo inicial de efectivo').fill('0');
    const [opened] = await Promise.all([setupPage.waitForResponse(r => r.url().endsWith('/api/pos') && r.request().postDataJSON()?.operation === 'open_register'), setupPage.getByRole('button',{name:'Abrir caja',exact:true}).click()]);
    assert.equal(opened.status(),200); const result = await opened.json();
    localDataAdded = {kind:'sandbox_register_session',opening_cash_minor:'0',session_id:result.result[0].session_id};
    console.log('Minimal local state added:', JSON.stringify(localDataAdded));
    await setupPage.getByText('La sesión existente se recuperó automáticamente.',{exact:true}).waitFor();
  }
  await setupPage.getByRole('button',{name:'Salir del demo',exact:true}).click(); await setupPage.waitForURL('**/platform/demostracion');
  await setupContext.close();
  writeFileSync(`${output}/local-data-added.json`,JSON.stringify(localDataAdded,null,2));
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    context.setDefaultNavigationTimeout(15000); context.setDefaultTimeout(15000);
    // This test must never reach a production service, including through browser SDK calls.
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'data:' ? route.continue() : route.abort();
    });
    const page = await context.newPage(), errors = [], financialWrites = [];
    activePage = page;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', request => { if (request.url().endsWith('/api/pos') && request.method() === 'POST') {
      const body = request.postDataJSON(); if (!['bootstrap', 'customer', 'search'].includes(body.operation)) financialWrites.push(body.operation);
    }});
    await login(page);
    let navigations = 0, previousUrl = page.url(), documentLoads = 0;
    const navigationEvents = [];
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentLoads++; });
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) {
      navigationEvents.push(frame.url());
      // Next hydration replaces history at the same URL: this is not another page load.
      if (frame.url() !== previousUrl) { navigations++; previousUrl = frame.url(); }
    }});
    await page.getByRole('navigation', { name: 'Plataforma', exact: true }).getByRole('link', { name: 'Demo', exact: true }).click();
    await page.getByRole('heading', { name: 'Explorar PIKAS', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Padre', exact: true }).count(), 1);
    assert.equal(await page.getByText('Próximamente', { exact: true }).count(), 2);
    assert.equal(await page.getByRole('button', { name: /Padre|Estudiante/ }).count(), 0);
    await page.screenshot({ path: `${output}/workspace-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Explorar Escuela', exact: true }).click();
    await page.waitForURL('**/admin/escuela?school=*');
    const school = await check(page, 'school', width);
    assert.ok(!(await page.locator('body').innerText()).includes('monederos no están disponibles'));
    const beforeSwitch = navigations;
    await switchTo(page, 'Cafetería', '**/admin/cafeteria?cafeteria=*');
    const cafeteria = await check(page, 'cafeteria', width);
    await switchTo(page, 'Caja / POS', '**/pos');
    const pos = await check(page, 'pos', width);
    await page.getByRole('button', { name: 'No Usuario', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.body.textContent.includes('Verificando caja y catálogo…'), null, {timeout:20000});
    console.log('POS readiness:', (await page.locator('body').innerText()).slice(0,650));
    const hasOpenRegister = await page.getByText('Al cambiar de experiencia, la caja permanecerá abierta.').count() > 0;
    await switchTo(page, 'Escuela', '**/admin/escuela?school=*');
    await page.getByRole('complementary', { name: 'Entorno Demo' }).waitFor();
    const throughReturn = navigations;
    const documentsThroughReturn = documentLoads;
    const measuredNavigationEvents = [...navigationEvents];
    const switches = throughReturn - beforeSwitch;
    assert.equal(switches,3); assert.equal(throughReturn,5); assert.equal(documentsThroughReturn,4);
    await page.getByRole('button', { name: 'Salir del demo', exact: true }).click();
    await page.waitForURL('**/platform/demostracion');
    await page.getByRole('heading', { name: 'Explorar PIKAS', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).count(), 1);
    const completeNavigations = navigations;
    assert.equal(completeNavigations,6);
    assert.deepEqual(financialWrites, [], 'Persona switches never mutate a register or sale');
    // Keyboard switcher and cross-tab invalidation (no stale financial state restored).
    await page.getByRole('button', { name: 'Explorar Escuela', exact: true }).click();
    await page.waitForURL('**/admin/escuela?school=*');
    const second = await context.newPage(); await second.goto(page.url());
    await second.getByRole('complementary', { name: 'Entorno Demo' }).waitFor();
    const summary = page.getByRole('complementary', { name: 'Entorno Demo' }).locator('summary');
    await summary.focus(); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Cafetería', exact: true }).focus(); await page.keyboard.press('Escape');
    assert.equal(await summary.evaluate(el => el === document.activeElement), true);
    await switchTo(page, 'Cafetería', '**/admin/cafeteria?cafeteria=*');
    await second.getByText('La experiencia de demostración cambió en otra pestaña.', { exact: true }).waitFor();
    await second.screenshot({ path: `${output}/stale-${width}.png` });
    console.log('Stale continuation from', second.url());
    await second.getByRole('link', { name: 'Continuar', exact: true }).click();
    await second.waitForURL('**/admin/cafeteria?cafeteria=*');
    await second.goto(base + '/admin/escuela');
    await second.waitForURL('**/platform/demostracion/cambio');
    console.log('Stale continuation from', second.url());
    await second.getByRole('link', { name: 'Continuar', exact: true }).click();
    await second.waitForURL('**/admin/cafeteria?cafeteria=*');
    console.log('Stale continuation passed');
    await second.close();
    await page.getByRole('button', { name: 'Salir del demo', exact: true }).click(); await page.waitForURL('**/platform/demostracion');
    // Actual full logout stays separate and ends the underlying application session.
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/auth/logout') && r.status() === 200), page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()]);
    console.log('Full logout response received');
    await page.getByRole('heading', { name: 'Tu sesión se cerró', exact: true }).waitFor();
    await page.goto(base + '/platform');
    if (new URL(page.url()).pathname === '/platform') await page.getByRole('heading', {name:'Tu sesión se cerró',exact:true}).waitFor();
    else assert.equal(new URL(page.url()).pathname, '/backoffice/login');
    await page.goto(base + '/login'); assert.equal(await page.getByRole('link', { name: 'Entrada de PIKAS Admin', exact: true }).getAttribute('href'), '/backoffice/login');
    assert.deepEqual(errors, []);
    evidence.push({ width, school, cafeteria, pos, hasOpenRegister, switchClicks: 2, switchesNavigations: switches, journeyClicks: 8, journeyNavigations: throughReturn, completeClicks: 9, completeNavigations, documentsThroughReturn, navigationEvents: measuredNavigationEvents, financialWrites, consoleErrors: errors });
    console.log(JSON.stringify(evidence.at(-1)));
    await context.close();
  }
  writeFileSync(`${output}/results.json`, JSON.stringify(evidence, null, 2));
} catch (error) {
  console.error('Verification stopped at', activePage?.url());
  if (activePage && !activePage.isClosed()) { console.error((await activePage.locator('body').innerText()).slice(0,1400)); await activePage.screenshot({path:`${output}/failure.png`}); }
  throw error;
} finally { await browser.close(); }
