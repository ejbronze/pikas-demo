# Arquitectura de PIKAS

`apps/web` conserva la aplicación Next.js App Router para Familia, Estudiante, POS, Escuela y Cafetería. `packages/data-access` reúne contratos y reglas; `packages/shared-types` y `packages/ui` mantienen tipos/componentes existentes. Los prototipos permanecen separados. La identidad visual y los activos aprobados siguen en `public/brand`.

## Modos y fronteras

Demo usa datos ficticios compartidos en `pikas:unified-demo:v2`. Supabase usa Auth y catálogo remoto donde ya estaban enlazados. El POS financiero remoto continúa deshabilitado: las funcionalidades financieras 0.6 son demo local y una fundación de esquema, no una declaración productiva.

`proxy.ts`, `requireRole` y `requireAdminRole` conservan guards de servidor. Las nuevas mutaciones consultan `/api/demo/session` para obtener el rol de cookies HttpOnly, luego aplican autorización/política en el adaptador y reglas puras. Esto no vuelve seguro un localStorage manipulable: en producción se requieren RPC/RLS y proyecciones de datos mínimas.

Escuela conserva padrón/identidad/conexiones; Cafetería conserva catálogo/personal/política; POS obtiene candidatos elegibles y opera dentro de su ubicación. Familia controla sus estudiantes; Estudiante solo modifica preferencias permitidas. Ver una compra no concede permiso para reembolsar.

## Extensiones 0.6

- `pos.ts`: snapshots de compra inmutables, precios y validaciones de checkout en centavos.
- `financial.ts`: política, eventos compensatorios, parsing monetario, zona de negocio, gasto neto y Top 5 + Top 5.
- `demo-provider.tsx`: migración compatible, sesión demo, Web Locks, lectura del estado vigente dentro del bloqueo, persistencia antes de éxito, notificaciones entre pestañas y estados de conexión.
- `pos-dashboard.tsx`: estados cliente → identidad → productos → validación/pago → completada.
- `pos-tools.tsx`: investigación compartida, detalle/refund y calculadora aislada.
- `pos-settings.tsx`: configuración exclusivamente de Cafetería Admin.
- Familia y Estudiante siguen leyendo el mismo estado; los reembolsos compensan compras originales sin editarlas.

Compras, recargas, reembolsos y preórdenes validan saldo/controles en el estado actual. El gasto se calcula por fecha de Santo Domingo; efectivo identificado también cuenta desde 0.6. Las preórdenes conservan su modelo anterior de reserva/cancelación, ahora con escritura serializada y restauración diaria solo el mismo día.

## Persistencia futura

La migración local 0.6 añade alcance de compra, controles/políticas, eventos append-only y solicitudes familiares deshabilitadas. Se restringen lecturas operativas por organización y ubicación. No hay escrituras financieras directas desde cliente.

La implementación remota aún necesita RPCs transaccionales, locks PostgreSQL, ledger/evento atómicos, idempotencia ligada a actor/payload, auditoría durable y pruebas reales de RLS/concurrencia. No usar el antiguo RPC de compra sin actualizar su contrato/rol y reglas 0.6. La documentación detallada y las advertencias sobre migraciones históricas están en [Modelo financiero](POS_FINANCIAL_MODEL.md).
