# PIKAS

PIKAS es una aplicación escolar unificada para familias, estudiantes y personal de cafetería. Comparte perfiles, controles, movimientos, preórdenes y presupuestos en un único Next.js App Router. Administración tiene un punto de entrada preparado para una fase posterior.

## Stack y arquitectura

- Next.js 16, React 19, TypeScript estricto y Tailwind CSS.
- Supabase Auth + PostgreSQL con RLS en producción.
- Server Components por defecto; componentes cliente solo para formularios y estado interactivo.
- Ledger inmutable: los saldos se derivan de créditos y débitos completados; los reversos son asientos compensatorios.
- Un proyecto Vercel, una aplicación y un dominio.

Los prototipos originales se conservan en `legacy-prototypes/`. La aplicación activa está en `apps/web`; `packages/data-access` contiene reglas de dominio probadas y `packages/shared-types` mantiene contratos compartidos.

## Inicio local

Requiere Node.js 20+ y Supabase CLI para una base local de producción.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Abre `http://localhost:3000`. En `.env.local`, `NEXT_PUBLIC_PIKAS_DEMO_MODE=true` habilita exclusivamente el adaptador local persistido en el navegador. Producción no debe activar ese valor.

Para probar el producto sin Supabase, confirma que `.env.local` contenga:

```bash
NEXT_PUBLIC_PIKAS_DEMO_MODE=true
```

Credenciales demo mostradas en `/login`:

- Familia: `familia@demo.pikas.do` / `pikas-demo`
- Estudiante: `PK-10982` / `pikas-demo`
- Cafetería: `cafeteria@demo.pikas.do` / `pikas-demo`

No son cuentas reales y no se deben reutilizar como contraseñas. El modo demo no recoge tarjetas ni mueve dinero.

## Guía de evaluación del producto

### Antes de comenzar

- Usa una ventana normal para comprobar persistencia después de recargar.
- Usa una ventana privada o un perfil separado si quieres comparar Familia, Estudiante y Cafetería al mismo tiempo.
- El demo guarda cambios ficticios en `localStorage`. Los datos se comparten entre las vistas Familia y Estudiante dentro del mismo perfil y origen del navegador.
- Las sesiones demo usan una cookie `httpOnly` con una duración máxima de ocho horas.
- No introduzcas nombres reales, información médica real, contraseñas reutilizadas ni datos de pago.

Para reiniciar completamente los datos demo, abre las herramientas del navegador, elimina el almacenamiento del sitio para `localhost:3000` y vuelve a cargar. También puedes ejecutar en la consola:

```js
localStorage.removeItem("pikas:unified-demo:v2");
location.reload();
```

### Recorrido recomendado: Familia

1. Inicia sesión como Familia y confirma el saldo combinado y las tarjetas de Sofi y Mateo.
2. Ejecuta una recarga demo. Debe aumentar el saldo y crear un movimiento; nunca debe pedir datos de tarjeta.
3. Edita el perfil familiar, guarda y recarga la página para comprobar persistencia.
4. Añade un estudiante, edítalo, archívalo y restáuralo. Archivar debe conservar su historial.
5. Cambia el límite diario, el límite por compra, las alergias o los productos bloqueados de Sofi.
6. Revisa búsqueda, filtro por estudiante y estados en Movimientos.
7. Abre Preórdenes después del recorrido estudiantil y confirma que aparece el pedido compartido.

### Recorrido recomendado: Estudiante

1. Inicia sesión como Estudiante y comprueba saldo, disponible de hoy y navegación móvil.
2. Abre Menú. “Pizza escolar” debe mostrar una advertencia por lactosa y no permitir la preorden para Sofi.
3. “Bebidas energéticas” debe quedar bloqueada por el control familiar.
4. Preordena “Pasta con pollo”. El pedido debe aparecer en Mis pedidos y en la vista familiar.
5. Cancela un pedido todavía enviado. El demo debe liberar la reserva mediante un movimiento compensatorio.
6. Edita el nombre preferido y la meta de presupuesto; los datos legales, alergias y límites deben permanecer de solo lectura.
7. Revisa el QR: está marcado como demostración y no contiene el UUID de base de datos.

### Recorrido recomendado: Cafetería

1. Inicia sesión con la cuenta de Cafetería añadida por Oscar.
2. Introduce `PK-10982` en `/pos` y comprueba la elegibilidad.
3. Confirma que el rol solo muestra la información mínima necesaria.
4. Intenta abrir `/familias` o `/estudiante` directamente. Debe regresar a `/pos` con un aviso de falta de permiso.

El resultado de elegibilidad del POS todavía es demostrativo: no completa una venta ni escribe en el ledger de producción.

### Comportamientos de seguridad esperados

- Un rol no puede abrir el dashboard de otro rol.
- Los estudiantes no pueden modificar límites, alergias, asociación familiar ni historial financiero.
- Los movimientos completados no ofrecen edición o eliminación.
- Archivar estudiantes no elimina movimientos ni preórdenes.
- Las preórdenes deben comprobar saldo, límites y restricciones antes de aceptarse.
- La recuperación de contraseña siempre muestra una respuesta genérica para no revelar si existe una cuenta.

Al reportar un problema incluye la ruta, rol, ancho aproximado de pantalla, pasos exactos, resultado esperado, resultado observado y una captura. Indica también si ocurrió después de modificar datos demo o con almacenamiento limpio.

## Supabase

```bash
supabase start
supabase db reset      # aplica migrations + seed.sql
```

Configura `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Reserva `SUPABASE_SERVICE_ROLE_KEY` para procesos estrictamente del servidor; nunca uses ni expongas esa clave en componentes cliente. Crea los usuarios Auth de desarrollo de forma local y enlaza sus UUID con `profiles`; las contraseñas no se guardan en el repositorio.

La migración `supabase/migrations/202608110001_unified_pikas.sql` crea el modelo, RLS, la vista de saldos y un RPC transaccional e idempotente de preórdenes. `202608110002_auth_storage_hardening.sql` restringe las columnas editables del perfil y configura el bucket privado de avatares.

En producción, el código estudiantil se resuelve exclusivamente en servidor y la credencial se valida mediante Supabase Auth, que almacena el hash y aplica sus controles de autenticación. El demo actual usa una cookie `httpOnly` de rol y está claramente aislado.

## Comandos de calidad

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`npm run test:e2e` inicia la aplicación en modo demo y ejecuta seis recorridos en Chromium de escritorio y WebKit móvil. En una máquina nueva puede ser necesario instalar los navegadores una vez:

```bash
npx playwright install chromium webkit
```

## Rutas

Públicas: `/`, `/login`, `/forgot-password`, `/actualizar-contrasena`. Familias: `/familias`, `/familias/perfil`, `/familias/estudiantes`, `/familias/estudiantes/[studentId]`, `/familias/transacciones`, `/familias/preordenes`. Estudiantes: `/estudiante`, `/estudiante/perfil`, `/estudiante/transacciones`, `/estudiante/menu`, `/estudiante/preordenes`, `/estudiante/presupuesto`. Cafetería: `/pos`. Futura: `/admin`.

## Despliegue

Crea un único proyecto Vercel con raíz del repositorio y comando `npm run build`. Configura las variables de Supabase para Preview y Production, deja demo mode desactivado, aplica migraciones antes de promover y valida las políticas con usuarios de cada rol.

## Limitaciones actuales

- Sin credenciales Supabase en este checkout, la evaluación local usa persistencia aislada en `localStorage`; la integración y el esquema de producción están preparados, pero los formularios todavía deben conectarse al adaptador Supabase antes de lanzar.
- El QR es un marcador demo; producción necesita tokens opacos, firmados y de corta vida.
- El código de Storage privado, recuperación de contraseña y sesiones Supabase está implementado, pero necesita un proyecto Supabase configurado para probarse de extremo a extremo.
- Los seis recorridos Playwright locales cubren Familia, Estudiante y Cafetería en escritorio y móvil; no sustituyen las futuras pruebas contra Supabase real ni una auditoría de accesibilidad completa.
- El usuario de Cafetería incorporado por Oscar puede iniciar sesión con el rol `pos` y acceder a una validación limitada de estudiantes. La finalización contable de compras sigue fuera de esta fase. Administración continúa como placeholder. No hay pagos, liquidación, transferencias reales ni integración SIS.

Consulta [Arquitectura](docs/ARCHITECTURE.md) para decisiones de seguridad, privacidad y evolución.
