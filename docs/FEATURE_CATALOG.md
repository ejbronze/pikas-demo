# Catálogo de funcionalidades — milestone 0.6.0

“Demo funcional” significa comportamiento local ficticio, con persistencia en el mismo navegador/origen. No implica integración financiera productiva con Supabase. Ver [Modelo financiero](POS_FINANCIAL_MODEL.md) para contratos y límites.

| Área | Funcionalidad | Estado / límite |
| --- | --- | --- |
| POS | Entrada Usuario PIKAS / No usuario | Demo funcional |
| POS | Buscar nombre o código, scope de conexión activa | Demo funcional; máximo ocho resultados mínimos |
| POS | Cambiar cliente conservando carrito | Demo funcional; restricciones se revalidan |
| POS | Catálogo compartido, búsqueda, filtros y restricciones | Preservado; demo funcional |
| POS | Top 5 cafetería + Top 5 cliente | Demo funcional; 30/90 días, hasta diez únicos, sin inventar historia |
| POS | Saldo completo o efectivo completo | Demo funcional; sin split payment |
| POS | Efectivo recibido, faltante, cambio y denominaciones | Demo funcional; metadata conservada |
| POS | Calculadora | Utilidad aislada, sin mutaciones financieras |
| POS | Recibo, nueva venta, carrito tras recarga | Demo funcional; identidad siempre se verifica otra vez |
| Shell | Identidad, ubicación, registro, conexión y contexto | Demo funcional; Online no certifica Supabase |
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
| Conciliación | Caja esperada, conteo y diferencia | Demo; incluye recargas/refunds, cierre durable pendiente |
| Persistencia | Web Locks, idempotencia, storage entre pestañas | Demo del mismo origen; no entre dispositivos |
| Producción | Auth, membresías y catálogo existentes | Integración anterior conservada |
| Producción | Ledger/refunds/RPCs 0.6 | Esquema local preparado, sin aplicar/verificar PostgreSQL |
| Producción | QR, pagos reales, SIS, invitaciones y auditoría durable | Pendientes |

Las capturas históricas en la guía corresponden a 0.5.x. Los cambios/versiones anteriores permanecen en [Changelog](CHANGELOG_PRODUCT.md).
