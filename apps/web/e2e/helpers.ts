import {expect,type Page} from '@playwright/test';

export const demoKey='pikas:unified-demo:v2';
export async function confirmSale(page:Page){
  // Wait for the session-confirmation request, not a fixed five-second window
  // that includes cold dev-server compilation. The visible result must follow it.
  const session=page.waitForResponse(r=>r.url().endsWith('/api/demo/session')&&r.request().method()==='GET');
  await page.getByRole('button',{name:'Confirmar venta',exact:true}).click();
  expect((await session).ok()).toBe(true);
  await expect(page.getByRole('heading',{name:'Compra completada'})).toBeVisible();
}
export async function snapshot(page:Page){return page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'{}'),demoKey)}
// Exercise the real mounted adapter, without adding a production debug route or hook.
export async function invoke(page:Page,name:string,args:unknown[]=[]){
  await page.waitForFunction(()=>{
    for(const main of document.querySelectorAll('main')){
      if(!(main as HTMLElement).checkVisibility())continue;
      const key=Object.keys(main).find(k=>k.startsWith('__reactFiber$'));
      let fiber=key?(main as any)[key]:null;
      while(fiber){if(fiber.memoizedProps?.value?.recoverCheckout)return true;fiber=fiber.return}
    }
    return false;
  });
  return page.evaluate(async({name,args})=>{
    const main=Array.from(document.querySelectorAll('main')).find(main=>(main as HTMLElement).checkVisibility())!;
    const fiberKey=Object.keys(main).find(k=>k.startsWith('__reactFiber$'))!;
    let fiber=(main as any)[fiberKey];
    while(fiber){const value=fiber.memoizedProps?.value;if(value?.recoverCheckout&&value?.state)return await value[name](...args);fiber=fiber.return}
    throw new Error('Mounted demo adapter not found');
  },{name,args});
}
