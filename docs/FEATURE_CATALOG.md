# Catálogo de funcionalidades

## Producción — Phase 4D completa

**STATUS: COMPLETE** · **Production acceptance: PASSED** · 2026-10-15.

El [registro canónico de Phase 4D](PRODUCT_BASELINE.md) enumera los componentes 4D.1–4D.8 completos y la evidencia de aceptación. Las capacidades conectadas incluyen gestión/provisión de clientes en Platform, administración escolar y de cafetería, equipo de Platform, activación segura de cuentas, POVs sandbox, UX administrativa Beta, importación estudiantil, filtros y exportaciones CSV, delegación de cafetería, activación de cajeros y entrada autorizada al POS.

La aceptación probó un cliente nuevo hasta una venta No Usuario + Efectivo comprometida con recibo. La búsqueda POS del estudiante recién inscrito queda como seguimiento acotado; no se declara probado ese camino de venta estudiantil. Las capacidades completadas no equivalen a pruebas individuales de cada función durante 4D.8.

## Backoffice: Agregar colegio y Customer Management (local)

- **Agregar colegio** (`platform:tenant:provision`): una página con nombre, RNC, dirección, República Dominicana fija y provincia canónica; códigos generados por PIKAS; cliente, colegio, sede y cafetería principales en una transacción. Administrador del colegio por el flujo Phase 6A existente.
- `platform:customer:operations:read`: consulta por cliente de cafeterías, catálogo, cajas, personal y transacciones/reportes. Clientes suspendidos o cerrados siguen disponibles en solo lectura.
- `platform:customer:operations:manage`: configuración no financiera de cafeterías de clientes activos: catálogo, importación CSV, menús/turnos, configuración, cajas y asignación de personal POS ya autorizado.
- `platform:customer:access:read`: Usuarios y accesos de un cliente (personas, roles, alcance, cajas, estado de inicio de sesión y accesos pendientes), solo consulta.
- `platform:customer:profile:manage`: edición del perfil del colegio (nombre, RNC, dirección, provincia) y renombrar sedes/cafeterías de clientes activos o suspendidos, con detección de cambios concurrentes y auditoría.
- Estudiantes, padres y profesores/personal pertenecen a la administración escolar; Backoffice no los expone.
- La Plataforma actúa con identidad propia y auditoría `platform_support`; no recibe membresías del cliente. La lista excluye aprovisionamiento/credenciales y toda mutación financiera, de ciclo de vida o de identidad.

## Phase 5A — aceptación productiva con un seguimiento

**PHASE 5A PRODUCTION ACCEPTANCE PASS WITH ONE DOCUMENTED FOLLOW-UP**. La [línea base](PRODUCT_BASELINE.md) registra la evidencia y la re-verificación POS pendiente por acceso al cajero ficticio; no constituye fallo funcional.

- Historial paginado de compras y detalle con productos/precios/tender e identidad de recibo.
- Historial/detalle de sesiones con apertura, operador, movimientos de efectivo y conciliación.
- Cierre excepcional administrativo con revisión/confirmación, esperado revalidado bajo bloqueo, conteo/diferencia inmutables y recuperación de respuesta perdida.
- Cierre propio POS conservado con confirmación explícita; la sesión cerrada no acepta ventas ni se reemplaza automáticamente.

[Autoridad, sandbox, contratos, migración y validación](PHASE_5A_TRANSACTION_REGISTER_OPERATIONS.md). No incluye nuevas recargas/refunds conectadas, reportes amplios ni analytics.

## Phase 5B — PIKAS Cash (completo, aceptado en producción)

**PHASE 5B PRODUCTION ACCEPTANCE PASS** (2026-10-17). Administrador de cuenta: lectura + recarga verificada; cafetería: saldo de solo lectura ([política](ADMINISTRATION_AND_PERMISSIONS.md)).

- Saldo PIKAS Cash autoritativo del estudiante e historial paginado del monedero: recargas, compras POS con recibo/productos, y ajustes/reembolsos históricos existentes en solo lectura.
- Recarga manual verificada (`manual_verified`) por Administración Escolar con referencia o nota, confirmación explícita, saldo resultante del servidor y recuperación exacta de respuesta perdida.
- No registra efectivo de caja ni amplía límites de gasto; POV sandbox sin operaciones financieras.

[Modelo financiero, autoridad, contratos y validación](PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md). Sin reembolsos/reversiones, pasarela de pago ni reportes.

## Phase 5C.3 — Ajustes administrativos de monedero (completo, aceptado en producción)

- "Corregir saldo" en el monedero del estudiante (administración de cuenta/escolar) y en la consulta de saldos de cafetería (solo estudiantes conectados): guía Reembolso / Revertir recarga / ajuste excepcional, monto con signo, motivo, explicación obligatoria, vista previa, advertencia de saldo negativo y confirmación permanente.
- Movimientos positivos (+, verde) y negativos (−, rojo) con motivo, rol y saldo anterior visibles. [Detalle](PHASE_5C3_ADMINISTRATIVE_ADJUSTMENTS.md).

## Phase 5C.2 — Reversión de recargas (completo, aceptado en producción)

- "Revertir recarga" en el historial PIKAS Cash para administración de cuenta/escolar: modal con monto original, referencia, saldo resultante, advertencia de saldo negativo, motivo y confirmación.
- Recarga original y reversión visibles por separado; una sola reversión por recarga. [Detalle](PHASE_5C2_REPLENISHMENT_REVERSALS.md).

## Phase 5C.1 — Reembolsos controlados (completo, aceptado en producción)

- Pestaña POS "Reembolsos": búsqueda por recibo, estado acumulado, modal por artículo/cantidad con monto calculado, motivo y confirmación.
- Efectivo desde la caja abierta actual; PIKAS Cash al monedero. Autorización de supervisor/administrador en el mismo dispositivo cuando el cajero excede 5 minutos o sus límites diarios.
- Límites diarios de cajero en Configuración POS. [Detalle](PHASE_5C1_REFUNDS.md). Sin reversión de recargas, ajustes ni notificaciones (5C.2/5C.3).

## Referencia histórica — milestone 0.6.1

La tabla siguiente conserva el alcance del demo de ese milestone; sus estados pendientes no describen la producción actual.

“Demo funcional” significa comportamiento local ficticio, con persistencia en el mismo navegador/origen. No implica integración financiera productiva con Supabase. Ver [Modelo financiero](POS_FINANCIAL_MODEL.md) para contratos y límites.

| Área | Funcionalidad | Estado / límite |
| --- | --- | --- |
| POS | Entrada Usuario PIKAS / No usuario | Demo funcional |
| POS | Buscar nombre o código, scope de conexión activa | Demo funcional; ID estable, código único/no ambiguo, campos por scope |
| POS | Cambiar cliente conservando carrito | Demo funcional; restricciones se revalidan |
| POS | Catálogo compartido, búsqueda, filtros y restricciones | Preservado; demo funcional |
| POS | Top 5 cafetería + Top 5 cliente | Demo funcional; 30/90 días, hasta diez únicos, sin inventar historia |
| POS | Saldo completo o efectivo completo | Demo funcional; sin split payment |
| POS | Efectivo recibido, faltante, cambio y denominaciones | Demo funcional; metadata conservada |
| POS | Calculadora | Utilidad aislada, sin mutaciones financieras |
| POS | Recibo, nueva venta, carrito tras recarga | Demo funcional; clave completada restaura resultado; venta nueva revalida identidad |
| Shell | Identidad, ubicación, registro, conexión y contexto | Demo funcional; HTTP de sesión fallido produce Sync Issue |
| Shell | Tema claro/oscuro personal | Preferencia local independiente de política |
| Controles | Límite diario individual ON/OFF | Demo funcional; efectivo identificado también consume límite |
| Eventos | Compra PIKAS / efectivo | Snapshot histórico conservado |
| Eventos | Recarga independiente | Demo funcional; no amplía capacidad diaria |
| Eventos | Reembolso completo y parcial por importe | Demo funcional; vinculado, atribuido, original intacto |
| Eventos | Void antes de completar | Registro sin impacto financiero |
| Eventos | Corrección administrativa | Contrato preparado; escritor/UI pendientes |
| Historial | Investigación compartida por ubicación | ID/nombre/código, día y cajero; detalle y eventos vinculados |
| Política | Visibilidad de ventas/conteo/turno/registro | Demo funcional; no cambia contabilidad ni auditoría |
| Política | Refund de caja OFF por defecto | Enforced en mutación y regla pura, además de UI |
| Política | Aprobación ON, motivo ON, parcial OFF | Administrador procesa desde sesión propia |
| Familia | Saldo, estudiantes, controles, recargas e historial | Preservado; límites y detalles de refund ampliados |
| Familia | Solicitudes de refund | Modelo/configuración preparados, OFF y no habilitado |
| Estudiante | Menú, preórdenes, historial, presupuesto y perfil | Preservado; preórdenes serializan saldo/controles actuales |
| Escuela | Padrón, estados, códigos, admins y conexiones | Preservado; CSV sigue siendo demostrativo |
| Cafetería | Menú, personal, conexiones, reportes/CSV | Preservado; Configuración POS añadida |
| Conciliación | Caja esperada, conteo y diferencia | Demo; ventas/recargas/refunds separados, Hoy por día de negocio; cierre durable pendiente |
| Persistencia | Web Locks, idempotencia, storage entre pestañas | Demo del mismo origen; no entre dispositivos |
| Producción | Auth, membresías y catálogo existentes | Integración anterior conservada |
| Producción | Ledger/refunds/RPCs 0.6 | Esquema local preparado, sin aplicar/verificar PostgreSQL |
| Producción | QR, pagos reales, SIS, invitaciones y auditoría durable | Pendientes |

Las capturas históricas en la guía corresponden a 0.5.x. Los cambios/versiones anteriores permanecen en [Changelog](CHANGELOG_PRODUCT.md).
