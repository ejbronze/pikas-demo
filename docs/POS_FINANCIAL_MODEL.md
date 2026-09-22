# POS y control financiero — milestone 0.6.0

## Alcance y fuente de verdad

La implementación funcional es **demo local**, sin dinero real. `apps/web/components/demo-provider.tsx` conserva el adaptador compartido existente; `packages/data-access/src/pos.ts` valida las compras y `financial.ts` define políticas, eventos compensatorios, ventanas de recomendaciones y cálculo diario. Los contratos productivos se preparan en una migración local, sin aplicarla a Supabase. El checkout remoto sigue deshabilitado en la interfaz.

## Flujo de caja

`entry → identity (Usuario PIKAS) → items → payment → completed → entry`.

No usuario omite identidad y usa efectivo. Buscar usuario PIKAS y Cambiar cliente conservan cada línea del carrito y repiten restricciones, disponibilidad, límites y saldo. El carrito persiste tras refrescar, pero siempre se verifica nuevamente la identidad. Un producto que deja de ser elegible permanece visible hasta que el cajero lo quite; el cobro se bloquea.

La pantalla de pago repite validación y la mutación vuelve a consultar estado/precios/controles. No existen pagos divididos. Un usuario PIKAS puede pagar todo con saldo o todo en efectivo. Desde 0.6, efectivo identificado también consume capacidad diaria y respeta el límite por compra; no debita la billetera. No usuario no tiene billetera, restricciones personales ni recomendaciones de cliente.

El shell conserva marca, cafetería/ubicación, identidad interactiva, estado operativo y contexto de la venta. Tema claro/oscuro es una preferencia local del cajero. Transacciones, calculadora y turno/recarga están en navegación secundaria. La calculadora no modifica valores financieros.

## Dinero y registros

Las reglas financieras trabajan en enteros de unidades menores DOP. `parseMoney` convierte texto decimal sin multiplicaciones de fracciones binarias. El adaptador mantiene campos históricos en pesos para compatibilidad de presentación y convierte a centavos en cada frontera financiera.

| Registro | Impacto de billetera | Impacto de caja | Capacidad diaria |
| --- | --- | --- | --- |
| Compra PIKAS | −total | 0 | consume total |
| Compra efectivo identificado | 0 | +total | consume total |
| Compra efectivo general | 0 | +total | no aplica |
| Recarga familiar | +monto | 0 | sin cambio |
| Recarga POS recibida en efectivo | +monto | +monto | sin cambio |
| Reembolso PIKAS | +monto | 0 | restaura solo el mismo día de compra |
| Reembolso efectivo | 0 | −monto | restaura solo el mismo día de compra identificada |
| Void de carrito | 0 | 0 | sin cambio |
| Corrección | contrato preparado | contrato preparado | escritor administrativo pendiente |

Una recarga y la compra posterior son dos registros independientes. Recarga POS supone recepción exacta del importe indicado; no es una compra ni convierte automáticamente el efectivo de otra venta en saldo.

Compras conservan artículos/precios históricos, asociación, método, cajero, registro, organización, ubicación, fecha, total, recibido y cambio. Los reembolsos añaden un `FinancialEvent` con compra original, monto, motivo, actor, aprobador cuando aplica, destino, saldo anterior/posterior y clave idempotente. No se modifica el estado ni los artículos de la compra original. Los reembolsos parciales son por importe; asignación de unidades devueltas a artículos queda pendiente. El detalle conserva los artículos de la compra original.

## Límites diarios

Familia puede activar/desactivar y configurar el importe por estudiante. OFF desactiva el límite diario, no el saldo, límite por compra o restricciones alimentarias. La zona de negocio es `America/Santo_Domingo`; el día cambia a medianoche local. `spendingDay` migra los snapshots existentes; `spentToday` inicial conserva el gasto ficticio 0.5.3 en el primer día del demo. En el cambio de día se recalcula el gasto correspondiente.

Compra hoy RD$350, reembolso hoy RD$100: gasto neto RD$250. Compra ayer reembolsada hoy: vuelve el saldo, pero no añade capacidad al límite de hoy. Recargas nunca reducen gasto ni aumentan el máximo parental. Ambos casos tienen pruebas explícitas.

## Recomendaciones

Cafetería Top 5: unidades compradas durante los últimos **30 días**, organización y ubicación actuales. Cliente Top 5: últimas **90 días**, excluyendo todos los IDs del primer grupo antes de tomar cinco. Empates se resuelven por ID estable. Se recorre toda la historia elegible; no se inventan favoritos ni se rellenan grupos vacíos. Disponibilidad, alergias y bloqueos siempre prevalecen. Las constantes son configurables en `financial.ts`. La popularidad usa compras brutas históricas; un reembolso por importe no implica devolver unidades de un artículo específico.

## Política y permisos

`/admin/cafeteria/configuracion` agrupa:

- Pantalla: ventas, cantidad, inicio de turno y registro en barra de estado.
- Permisos: reembolsos de caja OFF por defecto; aprobación administrativa ON.
- Política: parcial OFF, motivo ON; solicitudes familiares OFF y deshabilitadas.

Ocultar cifras no detiene contabilidad, historial, exportación o conciliación. Identidad y estado no son configurables. Reembolsos de caja apagados no ocultan el historial. Si se requiere aprobación, el administrador inicia sesión en su espacio y procesa el ID original desde Transacciones. No hay PIN maestro ni impersonación mediante un nombre de aprobador enviado por el cliente. La atribución corresponde al administrador que ejecuta el evento; una cola separada de solicitudes de caja queda pendiente.

Las operaciones nuevas consultan `/api/demo/session`, que lee las cookies HttpOnly existentes. El adaptador verifica cuenta activa, rol, organización/ubicación, alcance de conexión y política; `prepareRefund` también exige rol/alcance. El demo sigue siendo manipulable desde herramientas del navegador y **no es una frontera de seguridad productiva**. La búsqueda POS exige dos caracteres, limita a ocho candidatos de conexiones activas y devuelve únicamente nombre, grado e identificador operativo; no contactos familiares ni padrón navegable.

## Integridad y estado de conexión

Web Locks serializa operaciones financieras entre pestañas del mismo origen; cada operación relee el snapshot bajo bloqueo, valida, persiste y solo entonces devuelve éxito. La clave de checkout persiste con el carrito y se renueva al completar/nueva venta; un reintento tras interrupción recupera la compra existente. Las claves idempotentes estables y bloqueo de doble envío evitan repetir checkout/recargas/reembolsos. Se rechazan montos no enteros, negativos, excesos y reembolsos acumulados mayores que la compra. Cada pestaña recibe cambios de `storage`.

Online refleja conectividad del navegador y disponibilidad del almacenamiento demo, no salud de Supabase. Connecting indica inicialización, Offline proviene de eventos de red y Sync Issue de fallos de lectura/escritura o sesión. Sin conexión, Web Locks o sesión confirmada, no se ejecutan operaciones financieras nuevas. No se encolan cobros para sincronización posterior. El almacenamiento local no aporta durabilidad, protección contra manipulación ni coordinación entre dispositivos.

## Conciliación

Se conserva el reporte/CSV anterior. Caja esperada incluye ventas en efectivo + recargas recibidas en caja − reembolsos en efectivo de la ubicación, sin depender de filtros visuales. El fondo inicial del demo es cero; conteo humano y diferencia se mantienen. `shiftStartedAt`, registro y ubicación preparan conciliación futura. Apertura/cierre de turnos persistidos, movimientos de caja, cierre firmado y exportación consolidada de todos los eventos son trabajo posterior.

## Migración y pasos posteriores

`202609210001_pos_financial_foundation.sql` añade controles/políticas, alcance de compra, eventos inmutables y solicitudes preparadas sin permisos de escritura. Corrige la lectura demasiado amplia de compras operativas mediante organización/ubicación y mantiene acceso de familia/estudiante. No da a clientes capacidad de crear eventos directamente.

Antes de producción:

1. Revisar todas las migraciones en una base local/de desarrollo. La migración anterior 0.5.3 contiene backfills sobre compras protegidas por triggers inmutables; requiere una estrategia de mantenimiento revisada antes de aplicarse sobre datos existentes.
2. Reconciliar organización/ubicación de compras antiguas con evidencia; los valores desconocidos no se asignan automáticamente a una cafetería.
3. Implementar RPCs que autoricen antes de consultar claves idempotentes y bloqueen estudiante/wallet/compra original. Recalcular límites por zona horaria, saldo y reembolsos acumulados; escribir ledger y evento atómicamente.
4. Actualizar/reemplazar el antiguo RPC `complete_pos_purchase` y adaptador server-only: su contrato y rol históricos no implementan 0.6. No enlazarlos a la UI sin revisión.
5. Probar RLS, sesiones reales, múltiples registros, concurrencia, fallos, inmutabilidad de artículos y persistencia durable de auditoría. Proyectar detalles familiares sin metadatos internos.
6. Provisionar desarrollo con autorización independiente; después planificar despliegue y migraciones productivas revisadas.

No se aplicó ninguna migración ni se modificaron variables, secretos, datos o servicios remotos.
