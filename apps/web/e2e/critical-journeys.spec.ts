import {test,expect} from "@playwright/test";

async function signInAsStudent(page: import("@playwright/test").Page){
  await page.goto("/login");
  await page.getByRole("tab",{name:"Estudiante"}).click();
  await page.getByRole("button",{name:/Entrar como estudiante/}).click();
  await expect(page).toHaveURL(/\/estudiante$/);
}

test.describe("responsive application shell",()=>{
  test("student routes expose one intentional current destination",async({page},testInfo)=>{
    test.setTimeout(60_000);
    await signInAsStudent(page);
    const routes=[
      ["/estudiante","Inicio"],
      ["/estudiante/menu","Menú"],
      ["/estudiante/preordenes","Pedidos"],
      ["/estudiante/presupuesto","Mi plan"],
      ["/estudiante/transacciones","Mis compras"],
      ["/estudiante/perfil","Perfil"],
    ] as const;

    for(const [route,label] of routes){
      await page.goto(route);
      const desktop=page.getByTestId("desktop-sidebar");
      await expect(desktop.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(desktop.locator('[aria-current="page"]')).toHaveText(label);
      if(testInfo.project.name==="mobile"){
        const mobile=page.getByTestId("mobile-navigation");
        const expectedMobile=label==="Mi plan"?0:1;
        await expect(mobile.locator('[aria-current="page"]')).toHaveCount(expectedMobile);
        if(expectedMobile)await expect(mobile.locator('[aria-current="page"]')).toHaveText(label);
      }
    }

    await page.goto("/estudiante/transacciones");
    await expect(page.getByTestId("desktop-sidebar").locator('a[href="/estudiante/perfil"]')).not.toHaveAttribute("aria-current","page");
  });

  test("student shell is side-by-side on desktop and unobstructed on mobile",async({page},testInfo)=>{
    await signInAsStudent(page);
    await page.goto("/estudiante/transacciones");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    const metrics=await page.evaluate(()=>{
      const sidebar=document.querySelector<HTMLElement>('[data-testid="desktop-sidebar"]');
      const content=document.querySelector<HTMLElement>('[data-testid="shell-content"]');
      return {sidebar:sidebar?.getBoundingClientRect().toJSON(),content:content?.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
    });
    expect(metrics.overflow).toBe(false);

    if(testInfo.project.name==="desktop"){
      expect(metrics.sidebar?.width).toBeLessThan(300);
      expect(metrics.content?.left).toBeGreaterThanOrEqual(230);
      expect(metrics.content?.top).toBe(0);
    }else{
      const nav=page.getByTestId("mobile-navigation");
      await expect(nav.getByRole("link")).toHaveCount(5);
      await expect(page.getByRole("button",{name:"Cerrar sesión"})).toBeVisible();
      const lastRow=page.getByTestId("shell-main").locator(".card > div").last();
      await lastRow.scrollIntoViewIfNeeded();
      const [rowBox,navBox]=await Promise.all([lastRow.boundingBox(),nav.boundingBox()]);
      expect(rowBox).not.toBeNull();
      expect(navBox).not.toBeNull();
      expect(rowBox!.y+rowBox!.height).toBeLessThanOrEqual(navBox!.y+1);
    }
  });

  test("family navigation keeps its five destinations",async({page})=>{
    await page.goto("/login");
    await page.getByRole("button",{name:/Entrar como familia/}).click();
    await expect(page).toHaveURL(/\/familias$/);
    const sidebar=page.getByTestId("desktop-sidebar");
    await expect(sidebar.locator('a[data-nav-label="Inicio"]')).toHaveAttribute("aria-current","page");
    await expect(sidebar.locator("nav a")).toHaveCount(5);
  });
});

test("visitor signs in as a parent and manages a student",async({page})=>{await page.goto("/");await expect(page.getByRole("heading",{name:/Más autonomía/})).toBeVisible();await page.getByRole("link",{name:"Iniciar sesión"}).first().click();await page.getByRole("button",{name:/Entrar como familia/}).click();await expect(page).toHaveURL(/\/familias$/);await page.goto("/pos");await expect(page).toHaveURL(/\/familias\?aviso=sin-permiso$/);await expect(page.getByText("Saldo familiar combinado")).toBeVisible();await page.goto("/familias/estudiantes");await page.getByRole("button",{name:"Añadir"}).click();await expect(page.getByRole("heading",{name:"Añadir estudiante"})).toBeVisible()});
test("student sees restrictions and can create an allowed preorder",async({page})=>{await page.goto("/login");const tab=page.getByRole("tab",{name:"Estudiante"});await tab.click();await expect(tab).toHaveAttribute("aria-selected","true");await page.getByRole("button",{name:/Entrar como estudiante/}).click();await expect(page).toHaveURL(/\/estudiante$/);await page.goto("/pos");await expect(page).toHaveURL(/\/estudiante\?aviso=sin-permiso$/);await page.goto("/estudiante/menu");await expect(page.getByText(/contiene Lactosa/)).toBeVisible();await page.getByRole("button",{name:"Preordenar"}).first().click();await expect(page.getByRole("status")).toContainText("Preorden enviada")});
test("cafeteria completes a shared, restricted purchase",async({page})=>{await page.goto("/login");const tab=page.getByRole("tab",{name:"Cafetería"});await tab.click();await expect(tab).toHaveAttribute("aria-selected","true");await page.getByRole("button",{name:/Entrar como cafetería/}).click();await expect(page).toHaveURL(/\/pos$/);await page.getByLabel("Código estudiantil").fill("PK-00000");await page.getByRole("button",{name:"Comprobar estudiante"}).click();await expect(page.locator("#lookup-error")).toContainText("No encontramos");await page.getByLabel("Código estudiantil").fill("PK-10982");await page.getByRole("button",{name:"Comprobar estudiante"}).click();await expect(page.getByRole("heading",{name:"Sofi"})).toBeVisible();const pizza=page.getByRole("article").filter({hasText:"Pizza escolar"});await expect(pizza.getByRole("button")).toBeDisabled();await expect(pizza).toContainText("alergia registrada");const energy=page.getByRole("article").filter({hasText:"Bebidas energéticas"});await expect(energy.getByRole("button")).toBeDisabled();const pasta=page.getByRole("article").filter({hasText:"Pasta con pollo"});await pasta.getByRole("button",{name:"Añadir al carrito"}).click();await page.getByRole("button",{name:"Revisar y confirmar"}).click();await page.getByRole("button",{name:"Completar compra"}).click();await expect(page.getByRole("heading",{name:"Compra completada"})).toBeVisible();await expect(page.getByRole("heading",{name:"Historial POS"})).toBeVisible();await page.reload();await expect(page.getByText("1× Pasta con pollo")).toBeVisible();await page.getByRole("button",{name:"Salir"}).click();await page.goto("/login");await page.getByRole("tab",{name:"Estudiante"}).click();await page.getByRole("button",{name:/Entrar como estudiante/}).click();await page.goto("/estudiante/transacciones");await expect(page.getByText("1× Pasta con pollo")).toBeVisible();await page.goto("/api/auth/logout");await page.goto("/login");await page.getByRole("button",{name:/Entrar como familia/}).click();await page.goto("/familias/transacciones");await expect(page.getByText("1× Pasta con pollo")).toBeVisible()});
