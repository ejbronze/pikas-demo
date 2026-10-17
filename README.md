# PIKAS

## Estado actual — Phase 5C.1

**PHASE 5C.1 — COMPLETE / PRODUCTION ACCEPTED** (reembolsos controlados de compras). Source
`f2433884c3eb92b0ba85aa3ffa064776f74c6a85`, migraciones hasta
`202610180002_refine_refund_limits_cash_shortfall.sql`. Reembolso controlado en efectivo de RD$25.00
sobre el recibo #2 en BETA-01: recibo intacto, evento enlazado, estado acumulado persistente y efectivo
esperado de vuelta a RD$3,000.00. [Reglas y evidencia](docs/PHASE_5C1_REFUNDS.md). Phase 5C no está
completa: 5C.2 (reversión de recargas) y 5C.3 (ajustes, reglas de aprobación y notificaciones) siguen
diferidos.

## Línea base anterior — Phase 5B

**PHASE 5B — COMPLETE / PRODUCTION ACCEPTED** (2026-10-17). PIKAS Cash operativo en producción
con source `e05cf5f27f17733ea26a13bf089ce0ccb654c8b5` y migraciones hasta
`202610170001_beta_wallet_authority.sql`. Resuelto el bloqueo de autoridad del administrador de
cuenta; una recarga controlada `manual_verified` de RD$25.00 pasó y persistió tras recargar la página,
con un único movimiento. Política Beta de autoridad PIKAS Cash aceptada
([permisos](docs/ADMINISTRATION_AND_PERMISSIONS.md), [Phase 5B](docs/PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md)).
En ese checkpoint Phase 5C aún no se había iniciado; el acceso de soporte de Plataforma autorizado por el cliente sigue diferido.

## Línea base anterior — Phase 5A

**PHASE 5A PRODUCTION ACCEPTANCE PASS WITH ONE DOCUMENTED FOLLOW-UP**.
Historial de transacciones/recibos y sesiones operativo en producción; BETA-01 cerrada
con esperado/contado/diferencia RD$25.00/RD$25.00/RD$0.00 y persistencia verificada.
La [línea base canónica](docs/PRODUCT_BASELINE.md) registra el único seguimiento:
re-verificar rechazo POS en una futura sesión controlada con credenciales válidas,
sin reabrir ni mutar BETA-01. Ese comportamiento ya pasó validación local; no se
presenta como re-verificación UI productiva ejecutada. En ese checkpoint Phase 5B aún no se había iniciado.

## Línea base anterior — Phase 4D

**Phase 4D — Production Administration & Provisioning**
**STATUS: COMPLETE** · **Production acceptance: PASSED** · 2026-10-15.

Producción: **https://pikas-pikas.app/**. La aceptación de un cliente nuevo probó onboarding, activación y administración, provisión de cajero/caja y una venta No Usuario en efectivo con recibo, sin intervención de desarrollador/base de datos. La [línea base canónica](docs/PRODUCT_BASELINE.md) registra source, deployment, migración, evidencia, seguimiento estudiantil y congelación de Phase 4D.

La siguiente fase planificada es [Phase 5 — Financial Operations & Visibility](docs/MVP.md); no se inicia en este checkpoint. No Usuario en efectivo ya está soportado.

## Phase 5A — milestone local

Historial de transacciones/recibos y sesiones de caja conectado a registros autoritativos; cierre excepcional administrativo con conteo, esperado, diferencia inmutable y recuperación idempotente. [Semántica, autoridad y validación local](docs/PHASE_5A_TRANSACTION_REGISTER_OPERATIONS.md). La aceptación productiva Phase 5A y su único seguimiento se registran arriba; Phase 5 no está completa.

## Phase 5B — milestone

PIKAS Cash desde el perfil estudiantil de Administración Escolar: saldo autoritativo, historial inmutable de recargas y compras con recibo, y recarga manual verificada (`manual_verified`) con confirmación explícita y recuperación idempotente. No es efectivo de caja. [Modelo, autoridad, validación y aceptación](docs/PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md). Aceptado en producción (ver arriba); Phase 5 no está completa.

## Referencia histórica — demo local 0.6.x

Las secciones siguientes describen el demo histórico y sus limitaciones en aquel milestone. Sus versiones, URLs y pendientes no sustituyen la línea base de producción indicada arriba.

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
- Fase 3A añade wallets DOP, recargas manuales verificadas y ajustes auditables solo en la base local; no incluye compras, reembolsos, POS financiero ni integracion productiva.
- Fase 4A añade configuración, categorías y productos de catálogo con autorización/auditoría solo en la base local; no incluye menús, turnos, caja, compras ni conexión de la aplicación.

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

`NEXT_PUBLIC_PIKAS_DEMO_MODE=true` conserva el demo público ficticio y su persistencia en el navegador. Con `false`, la URL, la clave publicable y `NEXT_PUBLIC_SUPABASE_PROJECT_REF` deben identificar explícitamente `pikas-pilot`. Auth conserva la sesión mediante cookies y el servidor resuelve Auth → Person → membresías; RLS o RPCs autorizadas verifican el alcance. El modo piloto aún no habilita el Admin ni el POS completos.

La cadena activa de diez migraciones comienza en `supabase/migrations/202609300001_foundation.sql`; el despliegue aprobado a `pikas-pilot` está verificado por el propietario. Consulte [la guía de la fundación Supabase](supabase/README.md) y [la guía de bootstrap Auth](docs/PHASE_6A_BOOTSTRAP.md). Las migraciones y semillas anteriores están archivadas en `supabase/legacy/` y no deben combinarse con la nueva base. No hay signup público ni se incluye una credencial service-role en el runtime web.

## Limitaciones actuales

- Demo ficticio del mismo navegador/origen; no autentica identidades reales ni sincroniza fondos entre dispositivos.
- Operaciones financieras del demo 0.6 siguen en localStorage. Fase 3A añade wallets/ledger y RPCs solo a la base local; POS, compras, reembolsos, auditoría productiva y conexión de la aplicación siguen pendientes.
- Las migraciones locales de fundación, Fase 2, Fase 3A y Fase 4A se aplican y verifican en el entorno local. La reconciliación de compras históricas sin organización/ubicación y el backend de compras/reembolsos siguen pendientes.
- Reembolsos parciales son por importe; asignación de artículos devueltos, cola de aprobación, correcciones administrativas y solicitudes familiares quedan pendientes.
- QR visual, CSV escolar demostrativo, pagos reales e invitaciones/correo no completos.
- La conciliación mantiene fondo inicial cero y conteo manual; apertura/cierre durable de turnos es posterior.
- No se declara que la URL pública ejecute esta versión.

Pasos de producción y revisión de migraciones históricas: [POS y modelo financiero](docs/POS_FINANCIAL_MODEL.md).
