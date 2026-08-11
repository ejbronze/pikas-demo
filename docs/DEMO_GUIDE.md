# Guía de demostración de PIKAS

| Dato | Valor |
| --- | --- |
| Versión | 1.3 para PIKAS 0.5.0 |
| Última verificación | 11 de agosto de 2026 |
| Rama | `main` |
| Fuente de capturas | Build local con demo mode, `http://localhost:3000` |
| URL pública | Puede conservar una versión anterior; 0.5.0 no se desplegó en esta fase |
| Duración | 12–15 minutos |

PIKAS demuestra experiencias interconectadas para Familia, Estudiante, Cafetería/POS, Administración escolar y Administración de cafetería. **Todo nombre, escuela, cuenta, restricción y transacción mostrado aquí es ficticio.**

## 1. Preparación

1. Define `NEXT_PUBLIC_PIKAS_DEMO_MODE=true`, ejecuta `npm run dev` y abre `http://localhost:3000`.
2. Usa el mismo perfil/origen para demostrar propagación y persistencia entre roles.
3. Cierra sesión antes de cambiar de rol.
4. Si necesitas la línea base, pulsa **Restablecer demo** en un resumen administrativo o ejecuta:

```js
localStorage.removeItem("pikas:unified-demo:v2");
location.reload();
```

Una recarga normal conserva el estado. Otro navegador, perfil, dispositivo u origen no comparte los cambios.

![Página inicial de PIKAS](assets/demo-guide/01-landing-page.png)

![Selector de experiencias Familia, Estudiante y Cafetería](assets/demo-guide/02-role-selection.png)

## 2. Cuentas demo

| Experiencia | Identificador | Contraseña/PIN | Entrada | Resultado |
| --- | --- | --- | --- | --- |
| Familia | `familia@demo.pikas.do` | `pikas-demo` | `/login` | `/familias` |
| Estudiante | `PK-10982` | `pikas-demo` | `/login` | `/estudiante` |
| Cafetería/POS | `cafeteria@demo.pikas.do` | `pikas-demo` | `/login` | `/pos` |
| Admin escolar | `admin.escuela@demo.pikas.do` | `pikas-demo` | `/admin/login` | `/admin/escuela` |
| Admin cafetería | `admin.cafeteria@demo.pikas.do` | `pikas-demo` | `/admin/login` | `/admin/cafeteria` |

No uses credenciales reales. “Caja Patio” aparece suspendida para revisar estados y no es una cuenta de acceso. `PK-11804` identifica a Mateo en POS, pero no es un login estudiantil.

![Acceso administrativo discreto](assets/demo-guide/20-admin-login.png)

## 3. Administración escolar

1. Entra como `admin.escuela@demo.pikas.do`.
2. En **Resumen**, confirma estudiantes activos/archivados, conexiones activas y actividad reciente.
3. En **Estudiantes**, busca “Sofi”. El código debe estar enmascarado; prueba Archivar/Activar, Regenerar código o Restablecer acceso. Ninguna acción revela una contraseña.
4. En **Importar CSV**, previsualiza una fila válida y otra con `PK-10982`: la segunda debe rechazarse como duplicada.
5. En **Administradores**, invita una cuenta demo, cambia estados y confirma que el último administrador escolar activo no puede suspenderse.
6. En **Cafeterías conectadas**, observa conexiones activa, pendiente y suspendida. Solo Escuela puede aprobar, rechazar, suspender o revocar.
7. En **Actividad**, confirma que las mutaciones importantes producen un evento.

![Resumen de Administración escolar](assets/demo-guide/21-school-admin-dashboard.png)

![Padrón escolar y códigos protegidos](assets/demo-guide/22-school-student-roster.png)

![Conexiones revisadas por la Escuela](assets/demo-guide/23-school-partnerships.png)

## 4. Administración de cafetería

1. Cierra sesión y entra como `admin.cafeteria@demo.pikas.do`.
2. En **Resumen**, confirma disponibilidad, personal POS y conexiones.
3. En **Menú y productos**, marca un producto no disponible o aumenta su precio RD$5.
4. En **Personal de caja**, invita una cuenta, revisa Caja Demo activa y Caja Patio suspendida, y cambia un estado.
5. En **Escuelas conectadas**, Cafetería puede solicitar una conexión pendiente, pero no aprobarla.
6. En **Transacciones**, comprueba que solo se expone contexto mínimo de compra.

![Resumen de Administración de cafetería](assets/demo-guide/24-cafeteria-admin-dashboard.png)

![Administración del catálogo compartido](assets/demo-guide/25-cafeteria-menu.png)

![Personal POS activo y suspendido](assets/demo-guide/26-pos-personnel.png)

![Administración móvil sin contenido cubierto](assets/demo-guide/27-admin-mobile-navigation.png)

## 5. Propagación entre experiencias

Los cambios administrativos usan el mismo estado ficticio que las experiencias existentes:

- disponibilidad/precio del menú cambia en Estudiante y POS;
- archivar o regenerar un estudiante afecta su lookup POS;
- suspender/revocar la conexión activa bloquea lookup/checkout;
- suspender Caja Demo bloquea operación POS;
- una compra POS actualiza saldo e historial de Estudiante y Familia.

Restaura el demo antes del checkout si modificaste la conexión, Caja Demo, Sofi o Pasta con pollo.

## 6. Familia y Estudiante

En Familia, revisa estudiantes, saldo, límites, restricciones, movimientos y preórdenes. En Estudiante, comprueba dashboard, navegación, menú, **Mis compras**, presupuesto y perfil. Pizza escolar debe advertir Lactosa para Sofi; Bebidas energéticas debe permanecer bloqueada.

![Dashboard de Familia](assets/demo-guide/03-family-dashboard.png)

![Dashboard de Estudiante en escritorio](assets/demo-guide/18-student-desktop-dashboard.png)

![Mis compras de Estudiante en móvil](assets/demo-guide/19-student-mobile-purchases.png)

## 7. Cafetería/POS y checkout

1. Entra como `cafeteria@demo.pikas.do`.
2. `PK-00000` debe fallar sin mostrar datos.
3. `PK-10982` debe devolver Sofi con saldo, límites, alergias y bloqueos mínimos.
4. Pizza escolar y Bebidas energéticas no deben añadirse. Pasta con pollo sí.
5. Confirma y completa una sola compra.
6. Recarga `/pos`; el historial debe conservarla.
7. Cambia a Estudiante y Familia en el mismo perfil; la compra y el saldo actualizado deben aparecer.

![POS con conexión Escuela–Cafetería activa y alcance mínimo](assets/demo-guide/28-pos-active-partnership.png)

![Código inválido rechazado en POS](assets/demo-guide/09-pos-invalid-code.png)

![Restricciones aplicadas antes del checkout](assets/demo-guide/11-pos-restrictions.png)

![Carrito POS funcional](assets/demo-guide/12-pos-menu-and-cart.png)

![Recibo e historial POS](assets/demo-guide/14-pos-receipt-and-history.png)

![Compra visible para Estudiante](assets/demo-guide/16-student-transaction.png)

![Compra visible para Familia](assets/demo-guide/17-family-transaction.png)

## 8. Fronteras de acceso esperadas

- Familia y Estudiante no pueden abrir `/pos` ni `/admin/*`.
- POS no puede abrir Familia, Estudiante ni Administración.
- Admin escolar no puede abrir el espacio de Admin cafetería; se redirige al propio.
- Admin cafetería no puede abrir el espacio escolar; se redirige al propio.
- Cafetería no puede editar padrón, identidades o contactos familiares.
- Escuela no puede administrar el catálogo o personal POS.

## 9. Solución de problemas

| Problema | Resolución |
| --- | --- |
| Rol equivocado | Cierra sesión, vuelve a la entrada correcta y autentica de nuevo. |
| Estado alterado | Usa **Restablecer demo** o elimina `pikas:unified-demo:v2`. |
| Lookup POS falla para Sofi | Reactiva Sofi, Caja Demo y la conexión `Instituto Nueva Generación ↔ Cafetería PIKAS Central`. |
| Producto no coincide | Restaura el demo; Administración de cafetería puede haber cambiado precio/disponibilidad. |
| Compra no aparece en otro rol | Usa el mismo perfil/origen y confirma que el checkout terminó. |
| Imagen rota en GitHub | Verifica ruta relativa y capitalización exacta bajo `docs/assets/demo-guide/`. |

## 10. Limitaciones

Administración 0.5.0, sesiones y datos compartidos son demo local. No hay binding administrativo Supabase, RLS organizacional, invitaciones por correo, importación CSV productiva, sincronización entre dispositivos, SIS, QR verificable, búsqueda POS por nombre, pagos reales, refunds o conciliación. La URL pública puede corresponder a una versión anterior porque esta fase no despliega.

Mantén esta guía sincronizada cuando cambien versión, rutas, etiquetas, credenciales, códigos, permisos, persistencia o capturas.
