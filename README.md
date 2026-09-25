# PIKAS

PIKAS es una aplicación escolar unificada para Familias, Estudiantes, Cafetería/POS y Administración. El milestone local **0.6.5** evoluciona la línea base 0.5.3 sin cambiar marca ni espacios de trabajo. Verificada localmente; la aplicación y su lockfile están en **0.6.5**.

PIKAS es diseñada y desarrollada por **Palmchat Innovations LLC**.

## Funcionalidad 0.6.0 conservada

- POS guiado: Usuario PIKAS / No usuario → identidad → productos → validación/pago → recibo → nueva transacción.
- Búsqueda por nombre/código con alcance mínimo y cambio de cliente sin perder el carrito.
- Top 5 cafetería + Top 5 cliente con productos únicos, elegibles e historial real del demo.
- Saldo PIKAS o efectivo completo, cambio automático, calculadora y recargas independientes; sin pagos divididos.
- Límites diarios individuales ON/OFF; recargar no amplía capacidad y efectivo identificado también cuenta.
- Política de pantalla/refund en `/admin/cafeteria/configuracion`. Reembolsos de caja OFF por defecto.
- Refund completo/parcial por importe, vinculado al original, atribuido y visible para la familia.
- Web Locks, idempotencia, revalidación y bloqueo sin estado financiero confirmado.
- Esquema financiero local preparado; no aplicado a Supabase ni declarado productivo.

La rama predeterminada auditada es `Pikas_demo`, con 0.6.0 en `37e6c07`; `main` permanece en la línea 0.5.3 (`03b2971`). Este refinamiento 0.6.5 es local y no implica un despliegue.

0.6.1 rechaza códigos duplicados, selecciona por ID, revalida la sesión en cada escritor demo y proyecta campos POS por permiso. 0.6.3 añade el flujo compacto de Venta/Transacciones, catálogo por categorías, carrito persistente y recibos POS legibles. Ver [informe 0.6.1](docs/IMPLEMENTATION_061.md) y [Changelog](docs/CHANGELOG_PRODUCT.md).

Consulta la [entrega histórica 0.6.0](docs/IMPLEMENTATION_060.md), [Modelo financiero y límites](docs/POS_FINANCIAL_MODEL.md), [Permisos](docs/ADMINISTRATION_AND_PERMISSIONS.md), [Demo](docs/DEMO_GUIDE.md) y [Changelog](docs/CHANGELOG_PRODUCT.md).

## Aplicación en vivo

**URL publicada anteriormente:** [https://pikas-demo.vercel.app](https://pikas-demo.vercel.app)

Este milestone se implementa y verifica exclusivamente en local. No se hizo push, PR, merge o despliegue, ni se modificaron Supabase o variables de entorno. La URL pública puede ejecutar otra versión.

## Cuentas de demostración

Activa `NEXT_PUBLIC_PIKAS_DEMO_MODE=true`. Estas son las únicas credenciales de acceso documentadas:

| Experiencia | Rol | Usuario, correo o código | Contraseña | Ruta inicial | Propósito |
| --- | --- | --- | --- | --- | --- |
| Familia | `parent` | `familia@demo.pikas.do` | `pikas-demo` | `/familias` | Controles, saldo y movimientos familiares. |
| Estudiante | `student` | Código estudiantil `PK-10982` | PIN `pikas-demo` | `/estudiante` | Menú, pedidos, presupuesto y compras de Sofi. |
| Cafetería/POS | `pos_operator` | `cafeteria@demo.pikas.do` | `pikas-demo` | `/pos` | Verificación limitada y checkout ficticio. |
| Administración escolar | `school_admin` | `admin.escuela@demo.pikas.do` | `pikas-demo` | `/admin/escuela` | Padrón, administradores, conexiones y actividad escolar. |
| Administración de cafetería | `cafeteria_admin` | `admin.cafeteria@demo.pikas.do` | `pikas-demo` | `/admin/cafeteria` | Menú, personal POS, conexiones y transacciones. |

Familia, Estudiante y POS se seleccionan desde `/login`. Los administradores entran discretamente desde `/admin/login`. `PK-11804` identifica a Mateo en POS, pero no es una cuenta de login estudiantil. `PK-00000` debe rechazarse. “Caja Patio” es una cuenta ficticia suspendida visible para demostrar estados; intencionalmente no es una credencial de acceso.

Estas son credenciales públicas de demostración y **nunca deben reutilizarse en producción**. En modo demo, el login general comprueba formato mínimo y selecciona el rol, no autentica una identidad real. El login administrativo sí compara exactamente las cuentas publicadas de esta tabla. Ninguno de los dos mecanismos es apto para producción.

## Recorrido rápido

1. Entra como Administración escolar y revisa Estudiantes, Administradores, Cafeterías conectadas y Actividad.
2. Entra como Administración de cafetería, cambia la disponibilidad o el precio de un producto y revisa Personal de caja.
3. Comprueba el cambio en `/estudiante/menu` y `/pos` en el mismo navegador.
4. En POS, elige Usuario PIKAS. `PK-10982` devuelve Sofi, `PK-00000` falla y Pasta con pollo permite completar una compra tras Continuar al pago.
5. Revisa la compra en POS, Estudiante y Familia. La transacción sobrevive una recarga en el mismo navegador.

La conexión activa entre Instituto Nueva Generación y Cafetería PIKAS Central autoriza solo elegibilidad, saldo, restricciones, límites y transacciones. Suspenderla o revocarla bloquea la verificación/compra; no concede a Cafetería acceso al padrón o a contactos familiares.

## Inicio local

Requiere Node.js 20+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Para revisar sin Supabase, define localmente:

```bash
NEXT_PUBLIC_PIKAS_DEMO_MODE=true
```

No confirmes `.env.local`. Abre `http://localhost:3000` y usa las [cuentas de demostración](#cuentas-de-demostración).

El estado ficticio se comparte entre roles y se guarda en `localStorage` bajo `pikas:unified-demo:v2`. Para restaurarlo:

```js
localStorage.removeItem("pikas:unified-demo:v2");
location.reload();
```

También existen botones **Restablecer demo** en los resúmenes administrativos. Refrescar normalmente conserva las transacciones; otro navegador, perfil, dispositivo u origen tiene un estado separado.

## Rutas

- Públicas: `/`, `/login`, `/admin/login`, `/forgot-password`, `/actualizar-contrasena`.
- Familia: `/familias` y sus rutas de perfil, estudiantes, transacciones y preórdenes.
- Estudiante: `/estudiante`, `/estudiante/menu`, `/estudiante/transacciones`, `/estudiante/preordenes`, `/estudiante/presupuesto`, `/estudiante/perfil`.
- Cafetería/POS: `/pos`.
- Administración escolar: `/admin/escuela`, `/estudiantes`, `/administradores`, `/cafeterias`, `/actividad` bajo ese prefijo.
- Administración de cafetería: `/admin/cafeteria`, `/menu`, `/personal`, `/escuelas`, `/transacciones` y `/configuracion` bajo ese prefijo.

Los guards redirigen sesiones entre espacios de trabajo y las mutaciones administrativas vuelven a comprobar permisos mediante una política común. Una redirección de interfaz no reemplaza la autorización de datos de producción.

## Stack y arquitectura

- Next.js 16, React 19, TypeScript estricto y Tailwind CSS.
- Una aplicación App Router en `apps/web` y contratos/reglas compartidos en `packages/`.
- Supabase Auth + PostgreSQL/RLS preparados como arquitectura productiva.
- Estado demo persistente en el navegador, aislado de Supabase.
- Importes financieros representados en unidades menores dentro del flujo POS.

Los prototipos originales están en `legacy-prototypes/`. La política administrativa está en `apps/web/lib/admin-policy.ts`; las decisiones de alcance están documentadas en [Arquitectura](docs/ARCHITECTURE.md).

## Supabase y producción

El repositorio contiene migraciones, seed ficticio, clientes server-only y RPCs para la base productiva. Esta fase administrativa es deliberadamente demo-first: sus datos y mutaciones todavía viven en el adaptador del navegador.

Antes de producción todavía se requiere:

- enlazar las interfaces de Familia, Estudiante, POS y Administración con Server Actions/RPCs validados;
- provisionar Auth y perfiles de desarrollo, y verificar RLS por rol y organización;
- implementar PIN estudiantil hasheado y con rate limiting;
- probar recuperación por email y Storage privado;
- persistir auditoría, membresías organizacionales y conexiones Escuela–Cafetería en PostgreSQL;
- ejecutar recorridos contra Supabase y revisar seguridad, accesibilidad y concurrencia.

Nunca expongas `SUPABASE_SERVICE_ROLE_KEY` al cliente ni la confirmes al repositorio. Consulta `.env.example` para nombres de variables, no para secretos.

## Calidad

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Playwright cubre escritorio y móvil para Familia, Estudiante, POS y Administración, incluidas las fronteras de rol, privacidad del padrón, importación CSV y propagación del menú.

## Documentación

- [Guía de demostración](docs/DEMO_GUIDE.md)
- [Administración y permisos](docs/ADMINISTRATION_AND_PERMISSIONS.md)
- [Línea base del producto](docs/PRODUCT_BASELINE.md)
- [Catálogo de funcionalidades](docs/FEATURE_CATALOG.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [Guía de marca](docs/BRAND_GUIDE.md)
- [MVP](docs/MVP.md)
- [Registro de cambios](docs/CHANGELOG_PRODUCT.md)

## Modos de ejecución

`NEXT_PUBLIC_PIKAS_DEMO_MODE=true` conserva el demo público ficticio y su persistencia en el navegador. Con `false`, URL y anon key de Supabase son obligatorias: Auth conserva la sesión mediante cookies, valida el usuario en servidor y dirige `school_admin`, `cafeteria_admin` y `pos_operator` a sus espacios. El catálogo compartido se lee de Supabase y solo una membresía activa de cafetería puede editarlo.

Para desarrollo: aplique las migraciones y `supabase/seed.sql` a un proyecto no productivo, configure `PIKAS_DEMO_PASSWORD` localmente y ejecute `npm run seed:supabase-auth`. La service-role key es exclusivamente de servidor. No se cambió producción ni se afirma preparación productiva.

## Limitaciones actuales

- Demo ficticio del mismo navegador/origen; no autentica identidades reales ni sincroniza fondos entre dispositivos.
- Operaciones financieras 0.6 funcionan localmente. RPCs/ledger/refunds remotos, auditoría durable y concurrencia PostgreSQL requieren implementación/pruebas antes de habilitarse.
- La migración local no fue aplicada ni ejecutada en una base de datos. Incluye un cambio de alcance que exige reconciliar compras históricas sin organización/ubicación.
- Reembolsos parciales son por importe; asignación de artículos devueltos, cola de aprobación, correcciones administrativas y solicitudes familiares quedan pendientes.
- QR visual, CSV escolar demostrativo, pagos reales e invitaciones/correo no completos.
- La conciliación mantiene fondo inicial cero y conteo manual; apertura/cierre durable de turnos es posterior.
- No se declara que la URL pública ejecute esta versión.

Pasos de producción y revisión de migraciones históricas: [POS y modelo financiero](docs/POS_FINANCIAL_MODEL.md).
