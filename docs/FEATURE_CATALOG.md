# Catálogo de funcionalidades

## Producción — Phase 4D completa

**STATUS: COMPLETE** · **Production acceptance: PASSED** · 2026-10-15.

El [registro canónico de Phase 4D](PRODUCT_BASELINE.md) enumera los componentes 4D.1–4D.8 completos y la evidencia de aceptación. Las capacidades conectadas incluyen gestión/provisión de clientes en Platform, administración escolar y de cafetería, equipo de Platform, activación segura de cuentas, POVs sandbox, UX administrativa Beta, importación estudiantil, filtros y exportaciones CSV, delegación de cafetería, activación de cajeros y entrada autorizada al POS.

La aceptación probó un cliente nuevo hasta una venta No Usuario + Efectivo comprometida con recibo. La búsqueda POS del estudiante recién inscrito queda como seguimiento acotado; no se declara probado ese camino de venta estudiantil. Las capacidades completadas no equivalen a pruebas individuales de cada función durante 4D.8.

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
