# Entrega local — PIKAS 0.6.0

> Registro histórico de 0.6.0. La auditoría posterior encontró excepciones a las afirmaciones de autorización, alcance, recuperación y concurrencia de esta entrega. 0.6.1 corrige los escritores legacy, la proyección POS y la recuperación con límite activo; reemplaza la prueba de competencia por dos carritos válidos y claves distintas. La auditoría completa obtuvo 84/87 inicialmente; los tres reruns aislados no equivalían a una suite limpia. Consulte [IMPLEMENTATION_061](IMPLEMENTATION_061.md) para resultados actuales. La base 0.6.0 está en la rama predeterminada `Pikas_demo`, no en `main`.

Fecha: 22 de septiembre de 2026. No se hizo push, PR, merge, despliegue, migración remota ni modificación de variables/secretos/datos Supabase.

## 1. Cambios

Se conserva la aplicación 0.5.3, marca, cuentas demo, catálogo, roles, preórdenes, reportes y conciliación. POS ahora guía cliente → identidad cuando corresponde → productos → validación/pago → recibo → nueva transacción. Cambiar cliente conserva artículos y revalida; nombre/código permiten búsqueda mínima. El shell mantiene estado, identidad y contexto al desplazarse. Calculadora/historial/recarga quedan como herramientas secundarias.

Se añadieron recomendaciones únicas, límites diarios individuales ON/OFF, recargas independientes, efectivo recibido/cambio obligatorio, reembolsos compensatorios y política de cafetería. No hay pagos divididos. Las escrituras demo releen estado bajo Web Locks, persisten antes de confirmar y usan claves idempotentes; la clave de checkout persiste con el carrito para recuperación.

## 2. Archivos

El inventario completo se encuentra al final de este documento. Núcleo: `financial.ts`, `pos.ts`, `demo-provider.tsx`, `pos-dashboard.tsx`, `pos-tools.tsx`, `pos-settings.tsx`. Familia/Estudiante/Admin se adaptaron conservando sus rutas existentes. App y lockfile: 0.6.0.

## 3. Base de datos

`supabase/migrations/202609210001_pos_financial_foundation.sql` prepara:

- Organización/ubicación en compras y control diario ON/OFF.
- Campos de política de pantalla/reembolso.
- `financial_events` append-only con original, importe, impactos, balances, actor/aprobador, ubicación/registro, timestamp e idempotencia.
- Lectura financiera por familia/estudiante o membresía operativa autorizada de organización/ubicación.
- `parent_refund_requests` con estados conceptuales, sin permisos de escritura ni capacidad financiera.

No fue aplicada ni probada en PostgreSQL. No habilita escritores/RPCs 0.6 ni garantiza preparación productiva.

## 4. Configuración

Ventas/conteo/inicio de turno/registro visibles por defecto. Refund de caja OFF, parcial OFF, motivo ON, aprobación ON. Solicitudes familiares OFF y deshabilitadas. Tema personal claro/oscuro no cambia políticas. Denominaciones se definen en una constante; recomendaciones usan 30 días de cafetería y 90 de cliente, y zona de negocio Santo Domingo.

## 5. Rutas y componentes

- Nueva ruta `/admin/cafeteria/configuracion`: políticas y escenario ficticio opcional.
- Nuevo endpoint demo `/api/demo/session`: lee rol de cookies HttpOnly; no acepta rol enviado por el cliente y está deshabilitado fuera de demo.
- `PosSettings`, `PosHistory`, `PurchaseDetail`, `Calculator`; `/pos` conserva su ruta y usa estados guiados.
- Historial de familia muestra detalles del reembolso sin metadatos técnicos innecesarios.

## 6. Permisos

POS no modifica políticas. Mutaciones verifican sesión, cuenta activa, elegibilidad/alcance y política. Refund verifica también organización/ubicación, monto restante, motivo y aprobación. Con aprobación requerida, el administrador procesa desde su sesión; no hay PIN universal ni selección libre de aprobador. Ver historia compartida no concede autoridad financiera. Nuevos estudiantes de padrón no se vinculan automáticamente a la familia demo. Usuarios históricos se conservan desactivados.

## 7. Escenarios demo

La [guía](DEMO_GUIDE.md) describe compras PIKAS, invitado en efectivo, búsqueda por nombre, cambio de cliente con conflicto, saldo insuficiente, recarga independiente, límite diario, cambio automático, historial, refund OFF/ON, aprobación, refund parcial y visibilidad familiar. La configuración puede cargar diez productos/compras ficticias de hace 2/40 días para demostrar ambos Top 5. Incluye capturas desktop y móvil actuales.

## 8. Cobertura

Se añadieron 17 pruebas unitarias financieras y 10 recorridos E2E nuevos por viewport. Cobertura: permisos fuera de UI, full/parcial, exceso acumulado, idempotencia, atribución, original inmutable, cash/change, límites independientes, recargas, offline, nombre/alcance, recomendaciones, persistencia, límites concurrentes entre pestañas y recuperación de checkout interrumpido. Se actualizaron los recorridos existentes para la nueva navegación y árboles ocultos de Next.js 16.3. Los controles de login esperan la hidratación y la protección del último administrador activo se vuelve a comprobar dentro del bloqueo de escritura.

## 9. Resultados

| Verificación | Resultado |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS, 42 pruebas |
| `npm run test:e2e` | PASS, 87 pruebas de la suite completa en 390/768/1440 px |
| `npm run build` | PASS |
| `git diff --check` | PASS |

Se revisaron capturas de entrada desktop y pago móvil. El test visual comprueba ausencia de overflow/errores y que el estado permanezca en el viewport al desplazar hacia Confirmar venta.

## 10. Límites

Finanzas 0.6 son demo local; localStorage no es durable ni resistente a manipulación y no sincroniza dispositivos. Estado Online se refiere al adaptador demo, no a Supabase. Refund parcial es por importe, no por unidades devueltas. Solicitudes parentales, escritor de correcciones administrativas, cola de aprobación y cierre durable de turnos están pendientes. La recarga POS supone recepción exacta del importe indicado.

## 11. Pasos posteriores de producción

Revisar/aplicar migraciones solo en desarrollo con autorización separada; reconciliar el alcance de compras históricas; corregir el backfill 0.5.3 que interactúa con triggers de inmutabilidad; implementar RPCs de compra/recarga/refund con locks PostgreSQL, ledger/evento atómicos y autorización antes de idempotencia; ejecutar pruebas reales de RLS, concurrencia, rollback y auditoría. No conectar el antiguo RPC a la UI 0.6 sin actualizar sus contratos/reglas. Ver [Modelo financiero](POS_FINANCIAL_MODEL.md).

## 12. Próximo milestone recomendado

**0.7.0: persistencia financiera autoritativa en Supabase de desarrollo**, incluyendo RPCs transaccionales, pruebas multirregistro/RLS, auditoría durable y conciliación por turno. Mantener demo aislado y posponer el movimiento de dinero real hasta verificar esas garantías.

## Inventario de archivos modificados o añadidos

- [`README.md`](../README.md)
- [`apps/web/app/admin/cafeteria/configuracion/page.tsx`](../apps/web/app/admin/cafeteria/configuracion/page.tsx)
- [`apps/web/app/api/demo/session/route.ts`](../apps/web/app/api/demo/session/route.ts)
- [`apps/web/app/login/page.tsx`](../apps/web/app/login/page.tsx)
- [`apps/web/app/globals.css`](../apps/web/app/globals.css)
- [`apps/web/components/admin-pages.tsx`](../apps/web/components/admin-pages.tsx)
- [`apps/web/components/admin-shell.tsx`](../apps/web/components/admin-shell.tsx)
- [`apps/web/components/demo-provider.tsx`](../apps/web/components/demo-provider.tsx)
- [`apps/web/components/family-pages.tsx`](../apps/web/components/family-pages.tsx)
- [`apps/web/components/pos-dashboard.tsx`](../apps/web/components/pos-dashboard.tsx)
- [`apps/web/components/pos-settings.tsx`](../apps/web/components/pos-settings.tsx)
- [`apps/web/components/pos-tools.tsx`](../apps/web/components/pos-tools.tsx)
- [`apps/web/components/student-pages.tsx`](../apps/web/components/student-pages.tsx)
- [`apps/web/e2e/critical-journeys.spec.ts`](../apps/web/e2e/critical-journeys.spec.ts)
- [`apps/web/e2e/pos-v060.spec.ts`](../apps/web/e2e/pos-v060.spec.ts)
- [`apps/web/next-env.d.ts`](../apps/web/next-env.d.ts)
- [`apps/web/package.json`](../apps/web/package.json)
- [`docs/ADMINISTRATION_AND_PERMISSIONS.md`](../docs/ADMINISTRATION_AND_PERMISSIONS.md)
- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- [`docs/CHANGELOG_PRODUCT.md`](../docs/CHANGELOG_PRODUCT.md)
- [`docs/DEMO_GUIDE.md`](../docs/DEMO_GUIDE.md)
- [`docs/FEATURE_CATALOG.md`](../docs/FEATURE_CATALOG.md)
- [`docs/IMPLEMENTATION_060.md`](../docs/IMPLEMENTATION_060.md)
- [`docs/MVP.md`](../docs/MVP.md)
- [`docs/POS_FINANCIAL_MODEL.md`](../docs/POS_FINANCIAL_MODEL.md)
- [`docs/PRODUCT_BASELINE.md`](../docs/PRODUCT_BASELINE.md)
- [`docs/assets/demo-guide/30-pos-entry-v060.png`](../docs/assets/demo-guide/30-pos-entry-v060.png)
- [`docs/assets/demo-guide/31-pos-cash-v060.png`](../docs/assets/demo-guide/31-pos-cash-v060.png)
- [`package-lock.json`](../package-lock.json)
- [`packages/data-access/src/financial.test.ts`](../packages/data-access/src/financial.test.ts)
- [`packages/data-access/src/financial.ts`](../packages/data-access/src/financial.ts)
- [`packages/data-access/src/index.ts`](../packages/data-access/src/index.ts)
- [`packages/data-access/src/pos.ts`](../packages/data-access/src/pos.ts)
- [`supabase/migrations/202609210001_pos_financial_foundation.sql`](../supabase/migrations/202609210001_pos_financial_foundation.sql)
