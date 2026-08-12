# PIKAS

PIKAS es una aplicación escolar unificada para Familias, Estudiantes, Cafetería/POS y Administración. La versión actual es **0.5.0** y añade la primera base administrativa funcional sin retirar los recorridos compartidos de 0.4.0.

## Novedades de 0.5.0

- Dos espacios administrativos separados: Escuela y Cafetería.
- Control centralizado de permisos para `school_admin`, `cafeteria_admin` y `pos_operator`.
- Padrón escolar con búsqueda, estados, códigos enmascarados, regeneración e importación CSV con vista previa.
- Invitación, activación, suspensión y restablecimiento demo de administradores y personal POS; nunca se muestran contraseñas existentes.
- Conexiones Escuela–Cafetería con estados, alcance mínimo y efecto real sobre verificación y checkout POS.
- Menú compartido: disponibilidad y precios administrados por Cafetería se reflejan en Estudiante y POS.
- Actividad administrativa ficticia, navegación responsiva y protección de rutas por espacio de trabajo.

Consulta [Administración y permisos](docs/ADMINISTRATION_AND_PERMISSIONS.md), la [Guía de demostración](docs/DEMO_GUIDE.md) y el [Registro de cambios](docs/CHANGELOG_PRODUCT.md).

## Aplicación en vivo

**URL publicada anteriormente:** [https://pikas-demo.vercel.app](https://pikas-demo.vercel.app)

El código 0.5.0 de este repositorio se verifica localmente y se publica a `main` en este milestone, pero **esta tarea no despliega ni modifica Vercel o Supabase**. Por ello, no se afirma que la URL pública ejecute 0.5.0 hasta una verificación de despliegue independiente. El modo demo usa únicamente datos ficticios y no procesa dinero real.

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
4. En POS, `PK-10982` devuelve Sofi, `PK-00000` falla y Pasta con pollo permite completar una compra.
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
- Administración de cafetería: `/admin/cafeteria`, `/menu`, `/personal`, `/escuelas`, `/transacciones` bajo ese prefijo.

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

## Modos de ejecución (0.5.2)

`NEXT_PUBLIC_PIKAS_DEMO_MODE=true` conserva el demo público ficticio y su persistencia en el navegador. Con `false`, URL y anon key de Supabase son obligatorias: Auth conserva la sesión mediante cookies, valida el usuario en servidor y dirige `school_admin`, `cafeteria_admin` y `pos_operator` a sus espacios. El catálogo compartido se lee de Supabase y solo una membresía activa de cafetería puede editarlo.

Para desarrollo: aplique las migraciones y `supabase/seed.sql` a un proyecto no productivo, configure `PIKAS_DEMO_PASSWORD` localmente y ejecute `npm run seed:supabase-auth`. La service-role key es exclusivamente de servidor. No se cambió producción ni se afirma preparación productiva.

## Limitaciones actuales

- El modo demo es una simulación de un solo navegador, no autenticación ni persistencia multiusuario.
- En modo Supabase 0.5.2 Auth, membresías/alcance, catálogo, restricciones por producto, compras tipadas y auditoría tienen modelo remoto. Algunas acciones de familia, estudiante y wallet continúan en el adaptador demo.
- La importación CSV es una vista previa demostrativa y aplica una fila ficticia conocida; no carga archivos reales al servidor.
- QR sigue siendo visual; no hay lectura QR, búsqueda POS por nombre, refunds, reversos de compras completadas, pagos reales ni conciliación.
- El sitio público puede corresponder a una versión anterior hasta que exista un despliegue 0.5.2 autorizado y verificado.
