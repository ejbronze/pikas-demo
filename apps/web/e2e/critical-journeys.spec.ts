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

async function adminLogin(page:import("@playwright/test").Page,email:string){await page.goto("/admin/login");await page.getByLabel("Correo demo").fill(email);await page.getByRole("button",{name:"Entrar a administración"}).click()}
test("admin routes enforce organization workspaces",async({page})=>{await page.goto("/admin/escuela");await expect(page).toHaveURL(/\/admin\/login/);await adminLogin(page,"admin.escuela@demo.pikas.do");await expect(page).toHaveURL(/\/admin\/escuela$/);await expect(page.getByRole("heading",{name:"Instituto Nueva Generación"})).toBeVisible();await page.goto("/admin/cafeteria");await expect(page).toHaveURL(/\/admin\/escuela\?aviso=sin-permiso/);await page.getByRole("button",{name:"Cerrar sesión"}).click();await adminLogin(page,"admin.cafeteria@demo.pikas.do");await expect(page).toHaveURL(/\/admin\/cafeteria$/);await page.goto("/admin/escuela/estudiantes");await expect(page).toHaveURL(/\/admin\/cafeteria\?aviso=sin-permiso/)});
test("school roster and CSV preview remain privacy-safe",async({page})=>{await adminLogin(page,"admin.escuela@demo.pikas.do");await page.goto("/admin/escuela/estudiantes");await expect(page.getByText("Código •••982")).toBeVisible();await expect(page.getByText(/contraseña anterior/i)).toHaveCount(0);await page.getByRole("button",{name:"Previsualizar importación"}).click();await expect(page.getByText(/Fila 2: válida/)).toBeVisible();await page.getByLabel("Contenido CSV").fill("student_code,first_name,last_name,grade\nPK-10982,Ana,Pérez,4A");await page.getByRole("button",{name:"Previsualizar importación"}).click();await expect(page.getByText(/código duplicado/)).toBeVisible()});
test("cafeteria menu changes flow to student",async({page})=>{await adminLogin(page,"admin.cafeteria@demo.pikas.do");await page.goto("/admin/cafeteria/menu");const pasta=page.getByRole("article").filter({hasText:"Pasta con pollo"});page.once("dialog",dialog=>dialog.accept());await pasta.getByRole("button",{name:"Marcar no disponible"}).click();await page.getByRole("button",{name:"Cerrar sesión"}).click();await page.goto("/login");await page.getByRole("tab",{name:"Estudiante"}).click();await page.getByRole("button",{name:/Entrar como estudiante/}).click();await page.goto("/estudiante/menu");await expect(page.getByRole("article").filter({hasText:"Pasta con pollo"})).toContainText("agotado")});

test("every documented demo account reaches its intended workspace",async({page})=>{
  for(const account of [
    {tab:"Familia",identifier:"familia@demo.pikas.do",password:"pikas-demo",destination:/\/familias$/},
    {tab:"Estudiante",identifier:"PK-10982",password:"pikas-demo",destination:/\/estudiante$/},
    {tab:"Cafetería",identifier:"cafeteria@demo.pikas.do",password:"pikas-demo",destination:/\/pos$/},
  ]){
    await page.context().clearCookies();await page.goto("/login");await page.getByRole("tab",{name:account.tab}).click();
    await page.locator('input[name="identifier"]').fill(account.identifier);await page.locator('input[name="password"]').fill(account.password);await page.getByRole("button",{name:new RegExp(`Entrar como ${account.tab.toLowerCase()}`)}).click();await expect(page).toHaveURL(account.destination);
  }
  for(const account of [{email:"admin.escuela@demo.pikas.do",destination:/\/admin\/escuela$/},{email:"admin.cafeteria@demo.pikas.do",destination:/\/admin\/cafeteria$/}]){
    await page.context().clearCookies();await page.goto("/admin/login");await page.getByLabel("Correo demo").fill(account.email);await page.getByLabel("Contraseña").fill("pikas-demo");await page.getByRole("button",{name:"Entrar a administración"}).click();await expect(page).toHaveURL(account.destination);
  }
});

test("student and partnership status block POS and reset restores the graph",async({page})=>{
  await adminLogin(page,"admin.escuela@demo.pikas.do");await page.goto("/admin/escuela/estudiantes");const sofi=page.getByRole("article").filter({hasText:"Sofía Rosa"});page.once("dialog",dialog=>dialog.accept());await sofi.getByRole("button",{name:"Desactivar"}).click();await expect(sofi).toContainText("Inactivo");
  await page.goto("/admin/escuela/cafeterias");const active=page.getByRole("article").filter({hasText:"Instituto Nueva Generación ↔ Cafetería PIKAS Central"});page.once("dialog",dialog=>dialog.accept());await active.getByRole("button",{name:"Suspendido"}).click();await page.goto("/admin/escuela/actividad");await expect(page.getByText("Conexión actualizada").first()).toBeVisible();
  await page.goto("/admin/escuela");page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Restablecer demo"}).click();await page.goto("/admin/escuela/estudiantes");await expect(page.getByRole("article").filter({hasText:"Sofía Rosa"})).toContainText("Activo");
});

test("last school admin and suspended POS operator are protected",async({page})=>{
  await adminLogin(page,"admin.escuela@demo.pikas.do");await page.goto("/admin/escuela/administradores");const suspend=page.getByRole("button",{name:"Suspender"});page.once("dialog",dialog=>dialog.accept());await suspend.first().click();page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Suspender"}).click();await expect(page.getByRole("status")).toContainText("último administrador escolar activo");
  await page.getByRole("button",{name:"Cerrar sesión"}).click();await adminLogin(page,"admin.cafeteria@demo.pikas.do");await page.goto("/admin/cafeteria/personal");const caja=page.getByRole("article").filter({hasText:"Caja Demo"});page.once("dialog",dialog=>dialog.accept());await caja.getByRole("button",{name:"Suspender"}).click();await page.context().clearCookies();await page.goto("/login");await page.getByRole("tab",{name:"Cafetería"}).click();await page.getByRole("button",{name:/Entrar como cafetería/}).click();await expect(page.getByRole("heading",{name:"Acceso de caja suspendido"})).toBeVisible();
});
