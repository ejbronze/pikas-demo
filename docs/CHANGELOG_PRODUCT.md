# Registro de cambios del producto

## UX Wave C: shell administrativo unificado (local)

- PIKAS Admin, Cuenta, Escuela y Cafetería comparten un mismo shell: identidad PIKAS Admin, área y contexto actual (escuela/cafetería), navegación según permisos, cuenta y **Cerrar sesión** en un solo lugar. En móvil: barra superior de 56 px, menú de cuenta y navegación inferior con «Más»; Cafetería prioriza Transacciones, Cajas y Reportes. El POS sigue siendo un espacio de trabajo propio.
- Encabezados de página consistentes (el título coincide con la navegación; enlace de regreso solo en páginas de detalle), estados vacíos/errores con reintento, métricas y tabla responsiva de Clientes.
- Sesión: pantalla clara de «Tu sesión terminó» con el acceso correcto, cuenta regresiva en el aviso y mensaje en `/login` para accesos escolares denegados. Ninguna operación se repite.
- La navegación móvil queda oculta mientras hay un diálogo modal. El Demo, la autoridad, los cálculos financieros y la base de datos no cambian. Sin push ni despliegue.

## UX Foundation B.1: navegación de PIKAS Admin (local)

- Navegación de PIKAS Admin: **Inicio · Clientes · Equipo · Demo**, cada destino según su capacidad de plataforma. «Crear cliente» deja la barra y sigue disponible en Inicio y en Clientes.
- **Inicio** ofrece tarjetas a Clientes, Nuevo cliente, Equipo y Demo solo cuando el operador tiene la capacidad correspondiente; un operador solo de Demo ve únicamente Demo.
- Clientes acepta identificadores bien formados aunque no sean RFC 4122 (fixtures locales), en lugar de ocultar toda la lista. Sin cambios de autoridad, base de datos ni del flujo Demo. Sin push ni despliegue.

## UX Foundation B: entorno Demo persistente (local)

- **Demo** en la navegación de PIKAS Admin → **Explorar PIKAS**, con Escuela y Cafetería en Administración, Caja / POS en Operaciones y Padre/Estudiante como tarjetas no interactivas «Próximamente».
- Una barra Demo compartida permite cambiar de experiencia directamente y **Salir del demo** conserva la sesión del operador. El servidor acepta solo un código de experiencia y reutiliza la autoridad, las personas ficticias, la sustitución auditada y la vigencia de cuatro horas existentes.
- El POS permite dejar su caja abierta; pide confirmar el descarte de venta/pago/conteo sin enviar y bloquea el cambio/salida si hay una operación sin confirmar. No se conservan borradores financieros ni se reenvían operaciones automáticamente. Las pestañas obsoletas muestran una explicación con continuación segura.
- Encabezados Demo compactos; enlace genérico a PIKAS Admin en `/login`; Cajas presenta Sobrante/Faltante/Cuadrada con `MoneyValue`; el resumen escolar ya reconoce PIKAS Cash.
- Sin cambios de DB/esquema/RLS, Waves C–F ni Phase 5D.4–5D.6. Solo commit local, sin push ni despliegue. Arquitectura, decisiones OD-B1–OD-B11 y evidencia en el [registro de implementación](UX_UI_PRODUCT_ARCHITECTURE_AUDIT.md#23-ux-foundation-b--local-implementation-record).

## Phase 5D.3: conciliación de caja (local)

- Reportes de cafetería → **Conciliación de caja** en el mismo período: sesiones cerradas, cuadradas, con faltante y con sobrante (solo conteos; faltantes y sobrantes nunca se compensan), y la lista de sesiones cerradas con esperado, contado y diferencia (contado − esperado), con desglose bajo "Ver desglose".
- Los valores son la captura inmutable de Phase 5A al cierre; nada se recalcula. Un cierre anterior a la captura se marca "Sin captura al cierre". **Cajas abiertas ahora** se muestra aparte, como estado actual sin conciliar.
- Nuevo tipo `reconciliation` en `cafeteria_report_read` (migración aditiva `202610230001_cafeteria_reconciliation_report.sql`), con la autoridad existente de lectura de sesiones de Caja y sin índice nuevo. Sin cambios en POS ni en el cierre ciego. Sin push ni despliegue. Detalle en el [plan Phase 5D](PHASE_5D_REPORTING_PLAN.md).

## Phase 5D.2: productos principales (local)

- Reportes de cafetería → **Productos principales**: hasta 10 productos por unidades netas (vendidas − reembolsadas) del mismo período seleccionado. Los reembolsos cuentan en su propia fecha, así que un período solo con reembolsos puede mostrar unidades netas negativas.
- Desempate por identificador de producto. Los reembolsos sin detalle por artículo (anteriores a 5C.1) no se asignan a productos y se señalan. Se muestra el nombre del producto registrado en la compra más reciente del período.
- Nuevo tipo `top_products` en `cafeteria_report_read` (migración aditiva `202610220001_cafeteria_top_products_report.sql`), con la misma autoridad y sin índice nuevo. Sin push ni despliegue. Detalle en el [plan Phase 5D](PHASE_5D_REPORTING_PLAN.md).

## Phase 5D.1: base de reportes + resumen de ventas (local)

- Decisiones D1–D13 del propietario resueltas en el [plan Phase 5D](PHASE_5D_REPORTING_PLAN.md). Escuela y cuenta no ven ventas de cafetería; los reembolsos se reportan en la fecha en que ocurren.
- Administración de cafetería → **Reportes**: Ventas brutas, Reembolsos, Ventas netas (puede ser negativa), Transacciones, Ticket promedio (bruto) y Método de pago. Períodos Hoy, 7 días, 30 días (predeterminado) y personalizado de hasta 92 días, en fechas de operación de la escuela.
- Función de solo lectura `cafeteria_report_read`, con la autoridad existente de lectura de compras. Migración aditiva `202610210001_cafeteria_sales_report.sql`, sin índice nuevo. PIKAS Cash y el efectivo de caja no se mezclan con ventas. 5D.2–5D.6 no implementados. Sin push ni despliegue.

## UX Foundation A: fundamentos UX previos a Phase 5D (local)

- F01 resuelto: la administración de cafetería llega a **PIKAS Cash** (saldos de clientes compartidos y ajustes administrativos acotados ya aceptados) desde la navegación lateral y el menú móvil "Más". Visible solo con la lectura `cafeteria:wallets:read` derivada del servidor en tenants de cliente; misma ruta, sin cambios de autoridad, RLS, RPC ni reglas financieras.
- Semántica monetaria compartida (`movement` / `balance` / `amount`): recargas `+` en verde, deducciones `−` en rojo, saldos neutros salvo negativos; nunca solo por color. Aplicada al saldo y movimientos PIKAS Cash y a la consulta de cafetería.
- Terminología canónica (PIKAS Cash, Recarga, Reembolso, Reversión de recarga, Ajuste administrativo, Saldo, Movimientos, Caja, Actividad, Reportes) y distinción de arquitectura de información para Phase 5D en [UX_FOUNDATIONS.md](UX_FOUNDATIONS.md). Correcciones puntuales: "monedero" → PIKAS Cash en superficies tocadas; método de pago "Saldo PIKAS" → "PIKAS Cash" en Transacciones de cafetería.
- Sin rediseño: el resto de la [auditoría UX/UI](UX_UI_AUDIT_PRE_PHASE_5D.md) sigue diferido. Sin push ni despliegue.

## Cierre de aceptación productiva Phase 5C.3 — capa de correcciones Phase 5C completa

- **PHASE 5C.3 — COMPLETE / PRODUCTION ACCEPTED**, congelado. Source `07a1b928096fbc1f5731a2e7b1847dfe5ae8f238`; migración `202610200001_administrative_wallet_adjustments.sql`. [Evidencia y reglas finales](PHASE_5C3_ADMINISTRATIVE_ADJUSTMENTS.md).
- Un único ajuste +RD$25.00 "Corrección administrativa" por Administrador Ficticio Beta (Administración de cuenta) sobre Sol Ficticia Beta: RD$0.00 → RD$25.00, explicación y atribución preservadas; sin operación de caja ni movimientos adicionales.
- 5C.1, 5C.2 y 5C.3 aceptados y congelados: la capa de correcciones definida para Phase 5C está completa. Diferidos: soporte PIKAS autorizado por el cliente, aprobaciones, umbrales, alertas, notificaciones y analítica de ajustes.
- Observaciones de producción del monedero añadidas a la auditoría UX/UI del [roadmap](MVP.md). Cierre exclusivamente documental; sin despliegue.

## Phase 5C.3: ajustes administrativos de monedero (local)

- Ajustes positivos y negativos para correcciones excepcionales, como nuevo movimiento inmutable del ledger; nunca se sobrescribe un saldo. Motivo y explicación escrita obligatorios; se registran actor, rol real, alcance, saldo antes/después y evidencia idempotente.
- Autoridad: administración de cuenta (su cuenta), escolar (su escuela) y de cafetería (solo estudiantes conectados a su cafetería). Supervisor, cajero, Plataforma y POV sandbox sin autoridad. Sin aprobación obligatoria en Beta; ajustes de soporte PIKAS autorizados por el cliente diferidos.
- Saldo negativo permitido; compras con PIKAS Cash siguen bloqueadas por la regla de saldo suficiente; sin impacto en el efectivo de caja. Migración aditiva `202610200001_administrative_wallet_adjustments.sql`; [detalle](PHASE_5C3_ADMINISTRATIVE_ADJUSTMENTS.md). Sin acceso productivo, push ni despliegue.

## Cierre de aceptación productiva Phase 5C.2

- **PHASE 5C.2 — COMPLETE / PRODUCTION ACCEPTED**, congelado. Source `9f228dc97de268c01d45290fa8adeb488ef48b8e`; migración `202610190001_replenishment_reversals.sql`. [Evidencia y reglas finales](PHASE_5C2_REPLENISHMENT_REVERSALS.md).
- Una única reversión controlada de la recarga de aceptación Phase 5B (RD$25.00, `ACEPTACION-5B`): original intacta y marcada "Revertida", reversión enlazada con actor y motivo, saldo RD$0.00. Saldo negativo no reproducido en producción (cubierto localmente).
- Phase 5C no completa: 5C.3 diferido. Auditoría UX/UI ampliada con nuevas observaciones en el [roadmap](MVP.md). Cierre exclusivamente documental; sin push ni despliegue.

## Phase 5C.2: reversión de recargas (local)

- Administración de cuenta y escolar pueden revertir una recarga verificada errónea: nuevo evento negativo inmutable enlazado, por el monto exacto original, una sola vez; la recarga original no cambia y ambos movimientos quedan visibles.
- El saldo PIKAS Cash puede quedar negativo; las compras con PIKAS Cash siguen bloqueadas por la regla de saldo suficiente hasta que recargas legítimas lo cubran. Sin impacto en el efectivo de caja. Motivo obligatorio ("Otro" exige explicación).
- Corrige el desbordamiento del guardia de recarga/ajuste con saldo negativo. Migración aditiva `202610190001_replenishment_reversals.sql`; [detalle](PHASE_5C2_REPLENISHMENT_REVERSALS.md). Phase 5C no completa: 5C.3 diferido. Sin acceso productivo, push ni despliegue.

## Cierre de aceptación productiva Phase 5C.1

- **PHASE 5C.1 — COMPLETE / PRODUCTION ACCEPTED**, congelado. Source `f2433884c3eb92b0ba85aa3ffa064776f74c6a85`; migraciones `202610180001_controlled_purchase_refunds.sql` y `202610180002_refine_refund_limits_cash_shortfall.sql`. [Evidencia y reglas finales](PHASE_5C1_REFUNDS.md).
- Reembolso controlado en efectivo de RD$25.00 del recibo #2 en BETA-01 (sesión nueva; la sesión cerrada de Phase 5A no se tocó): recibo intacto, reembolso enlazado, estado acumulado persistente, efectivo esperado de vuelta a RD$3,000.00. Sin transacciones adicionales.
- Phase 5C no completa: 5C.2 y 5C.3 diferidos. Auditoría UX/UI transversal registrada como elemento futuro en el [roadmap](MVP.md). Cierre exclusivamente documental; sin push ni despliegue.

## 2026-10-18 — Phase 5C.1: reembolsos controlados (local)

- Reembolsos por artículo desde el POS: varios eventos por compra sin exceder cantidad ni total; recibo original inmutable. Efectivo sale de la caja abierta actual (nunca se reescribe una caja cerrada); PIKAS Cash vuelve al monedero con asiento de ledger enlazado.
- Cajero sin autorización solo dentro de 5 minutos y de sus límites diarios (cantidad y monto, configurables por administrador de cafetería o supervisor POS). Si no, autorización del supervisor o administrador en el mismo dispositivo, sin cerrar la sesión del cajero; se auditan iniciador, aprobador y motivo del override.
- Correcciones del propietario (`202610180002`): todos los reembolsos iniciados por el cajero, incluidos los autorizados, cuentan en sus totales diarios (los límites solo acotan su autonomía); un reembolso en efectivo puede dejar el efectivo esperado en negativo con autorización (`cash_shortfall`) en lugar de rechazarse. El reintento exacto devuelve el reembolso original aunque haya agotado la línea.
- Motivo obligatorio ("Otro" exige explicación). Migración aditiva `202610180001_controlled_purchase_refunds.sql`; [modelo, autoridad y validación](PHASE_5C1_REFUNDS.md).
- Phase 5C no está completa: 5C.2 (reversión de recargas) y 5C.3 (ajustes, aprobaciones, notificaciones) diferidos. Sin acceso productivo, push ni despliegue.

## 2026-10-17 — Cierre de aceptación productiva Phase 5B

- **PHASE 5B — COMPLETE / PRODUCTION ACCEPTED**. Source `e05cf5f27f17733ea26a13bf089ce0ccb654c8b5`, migraciones alineadas hasta `202610170001_beta_wallet_authority.sql`. [Evidencia canónica](PRODUCT_BASELINE.md).
- Resuelto el bloqueo de autoridad del administrador de cuenta observado en la primera activación. La política Beta de autoridad PIKAS Cash queda aceptada.
- Recarga controlada `manual_verified` de RD$25.00 (Sol Ficticia Beta): saldo RD$0.00 → RD$25.00, un único movimiento, persistencia tras recargar la página. Sin segunda recarga.
- Phase 5C no iniciada; el soporte de Plataforma autorizado por el cliente sigue diferido. Cierre exclusivamente documental; sin push ni despliegue.

## 2026-10-17 — Phase 5B: política Beta de autoridad PIKAS Cash (local)

- La aceptación productiva mostró que el administrador inicial de un cliente nuevo (`account_admin`, sin autoridad financiera desde Phase 4D.2) no podía abrir PIKAS Cash. El propietario definió la política Beta.
- Administrador de cuenta: lectura + recarga `manual_verified`, sin `manage`/`adjust`. Administrador escolar: sin cambios. Administrador de cafetería: solo saldo de clientes compartidos, sin recargas (se retira la antigua capacidad de recarga de cafetería). Plataforma: sin acceso permanente; soporte temporal autorizado por el cliente diferido. POS: solo uso operativo.
- UI según capacidad del servidor: enlace, página y formulario de recarga solo con autoridad; consulta de saldo de solo lectura en "Escuelas conectadas" de cafetería. [Detalle y validación](PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md), [política](ADMINISTRATION_AND_PERMISSIONS.md).
- Migración aditiva `202610170001_beta_wallet_authority.sql`. Sin acceso productivo, push o despliegue; sin Phase 5C.

## 2026-10-16 — Phase 5B: PIKAS Cash / operaciones de monedero (local)

- PIKAS Cash en el perfil estudiantil de Administración Escolar: saldo autoritativo, historial del monedero con recargas y compras POS (recibo y productos) y recarga manual verificada con confirmación explícita.
- Reutiliza monedero, ledger inmutable, `manual_verified` y capacidades escolares existentes; revalida autoridad tras la espera del bloqueo; reintento exacto y recuperación de éxito perdido.
- Migración aditiva `202610160002_wallet_operations.sql`; [modelo, contratos y validación](PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md). Documentación canónica actualizada (README, línea base, catálogo, MVP).
- Las recargas no son efectivo de caja ni amplían límites de gasto. Sin reembolsos/reversiones (Phase 5C). Sin acceso productivo, push o despliegue; Phase 5 no está completa.

## 2026-10-16 — Cierre de aceptación productiva Phase 5A

- **PHASE 5A PRODUCTION ACCEPTANCE PASS WITH ONE DOCUMENTED FOLLOW-UP**. [Evidencia y seguimiento canónicos](PRODUCT_BASELINE.md).
- Source `d2fdd6888a53e8571550423f4bffd5876e94883e`, deployment `dpl_ET7gUF21YZUpXnVzTBP3863EmzV2`, migraciones alineadas hasta `202610160001`, según checkpoint de activación confirmado por el propietario.
- Historial/recibo #1 y sesiones operativos; BETA-01 cerrada explícitamente con esperado/contado/diferencia RD$25.00/RD$25.00/RD$0.00. Persistencia tras recarga y recibo intacto verificados por UI.
- Rechazo POS tras cierre probado localmente; la re-verificación UI productiva no se ejecutó por falta de acceso al cajero ficticio ya activado con correo .invalid. Recuperación normal devolvió respuesta condicional; no constituye fallo funcional de Phase 5A.
- Único seguimiento: verificar durante una futura sesión controlada de producción/piloto con credenciales válidas, sin reabrir ni mutar BETA-01 completada. Sin ventas/sesiones adicionales ni acceso/mutación de Horizonte. Phase 5B no iniciada.
- Cierre exclusivamente documental; sin más recuperación de credenciales ni mutaciones en producción.

## 2026-10-16 — Phase 5A: operaciones de transacciones y caja (local)

- Historial conectado de compras/recibos y sesiones; cierre administrativo excepcional con confirmación, contado/esperado/diferencia y captura inmutable para nuevos cierres.
- Reintento exacto y recuperación de éxito perdido; rechazo de esperado obsoleto y ventas contra sesión cerrada. Capacidades y fronteras sandbox existentes conservadas.
- Migración aditiva `202610160001_transaction_register_operations.sql`; [decisiones, contratos y validación](PHASE_5A_TRANSACTION_REGISTER_OPERATIONS.md). `CLAUDE.md` añade guía durable de ingeniería.
- No completa Phase 5; sin nuevas recargas/refunds conectadas, reporting amplio ni analytics. Sin acceso productivo, push o despliegue.

## 2026-10-15 — Cierre de Phase 4D: Production Administration & Provisioning

- **STATUS: COMPLETE** · **Production acceptance: PASSED**. Cliente ficticio nuevo incorporado y operado mediante PIKAS hasta una venta No Usuario + Efectivo confirmada, sin intervención de desarrollador/base de datos.
- Línea base aceptada: rama `Pikas_demo`, source `df802b530b3cab4a92140f7d7b9a025e36f2b9c7`, deployment `dpl_4pLUTkodjv4qpNEpxDDUNeu3L8E4`, migraciones alineadas hasta `202610150001_cafeteria_staff_activation.sql`, dominio `pikas-pikas.app`.
- Recibo #1, compra `daccc804-d8e1-4ef1-9789-99156075fe50`: 1 Agua Ficticia Beta 4D.8, total RD$25.00, recibido RD$50.00, cambio RD$25.00.
- [Evidencia y componentes completos 4D.1–4D.8](PRODUCT_BASELINE.md), incluido el seguimiento de Sol Ficticia Beta no devuelta por búsqueda POS. No bloqueó el camino aceptado No Usuario + Efectivo. Reautenticación por timeout: política esperada.
- Phase 4D queda como línea base congelada; cambios posteriores requieren defecto confirmado o función aprobada y regresiones dirigidas. Migraciones comprometidas inmutables.
- Próxima fase planificada: [Phase 5 — Financial Operations & Visibility](MVP.md), sin iniciarla.
- Cierre exclusivamente documental, sin nueva versión de paquete, cambios de código/migraciones ni despliegue.

## 2026-09-24 — PIKAS 0.6.5: selección de productos en POS

- Reorganización espacial del desktop POS: Cliente, Top 5 y Productos forman una columna de selección; Venta actual permanece como columna de transacción dedicada.
- Top 5 conservado como tira horizontal acotada y Productos mantiene controles estables, resultados con scroll independiente y continuidad de catálogo.
- Sin cambios a lógica de recomendaciones, catálogo, checkout, pagos, límites, reembolsos, permisos o contabilidad.

## 2026-09-24 — PIKAS 0.6.4: workspace operativo de cafetería

- Workspace Venta más denso en desktop/tablet: Cliente y Productos quedan en la columna izquierda; Top 5 y Venta actual en la derecha, con carrito visible.
- Top 5 compacto con desplazamiento horizontal acotado, controles de catálogo estables y resultados de productos con scroll independiente.
- CTA de pago reforzado, confirmación final con resumen de compra y señal sonora sutil solo después de una venta exitosa.
- Calculadora presentada como utilidad circular, estado de conexión al extremo derecho del footer y filtros operativos de Transacciones para efectivo, saldo PIKAS, reembolsos y recargas.
- Se conserva el comportamiento financiero, autorización, catálogo, reembolsos, recibos, impresión y regresiones de 0.6.3.

## 2026-09-24 — PIKAS 0.6.3: flujo POS, recibos y reembolsos

- Venta y Transacciones quedan como espacios de trabajo claros; el contexto de cliente, Top 5, recargas elegibles, carrito actual y calculadora permanecen accesibles sin competir con la operación.
- Catálogo con vistas Gallery/List, navegación List alfabética, búsqueda, categorías dinámicas, filas compactas sin imágenes y tarjetas Gallery verticales corregidas.
- Top 5 cafetería y accesos de contexto del cliente se mantienen como atajos compactos, con restricciones, disponibilidad, cantidades y carrito persistente preservados.
- Historial muestra estados derivados Completada, Reembolso parcial y Reembolsada sin mutar compras originales.
- Flujo de reembolso guiado con revisión y confirmación explícita; se preservan permisos, aprobación, destinos efectivo/saldo, contabilidad, same-day spending, protección acumulada e idempotencia.
- Recibos de venta refinados, recibos dedicados de reembolso vinculados a la venta original y datos históricos preservados.
- Impresión y reimpresión mediante el diálogo del navegador para recibos de venta y reembolso, con estilos de impresión que aíslan únicamente el recibo.
- Cobertura E2E de navegación, catálogo, vistas, recomendaciones, carrito, estados, recibos, reembolsos, impresión y regresiones financieras.
- Estabilización de selectores de pruebas para el flujo de alto volumen; no representa una funcionalidad ni un cambio de reglas del producto.

## 2026-09-24 — PIKAS 0.6.2: refinamientos UX del POS

- Barra de estado/footer persistente y compacta para conexión, contexto, turno, transacciones y ventas según la visibilidad configurada.
- Indicador de conexión basado en el estado real, con pulso Online accesible y respeto por reduced motion.
- Encabezado POS simplificado, conservando identidad, ubicación, caja y controles del cajero.
- Calculadora flotante como utilidad independiente, con ventana arrastrable, teclado físico, foco y accesibilidad mejorados.
- La calculadora permanece aislada del carrito, pagos, totales, saldos, cambio y demás estado transaccional.
- Cobertura E2E del footer, estados de conexión, visibilidad, calculadora, arrastre, responsive, foco y aislamiento transaccional.
- Estabilización determinista del recorrido E2E familiar en tablet mediante espera explícita del render de Estudiantes; no es una funcionalidad del producto ni una corrección de regresión.

## 2026-09-23 — PIKAS 0.6.1: correcciones de auditoría

- Códigos únicos en creación/regeneración, selección por ID estable y lookup ambiguo rechazado.
- Todos los escritores demo confirman sesión y autorización vigente bajo Web Locks; admin obsoleto pierde autoridad.
- Proyección de cliente POS por eligibility/balance/limits/restrictions/transactions, con validación independiente de checkout.
- Recuperación por clave completada antes de límites de nueva compra; bloqueos parentales sincronizados.
- Fallos HTTP de sesión producen Sync Issue con recuperación explícita.
- Hoy usa fecha Santo Domingo; conciliación separa ventas, recargas, refunds y cierre; actividad muestra monto/destino de refund efectivo.
- Regresiones de auditoría, permisos negativos, dos carritos válidos concurrentes, reintentos y refunds; waits de sesión/hidratación y descarga deterministas.
- Corrección local sobre `Pikas_demo`; sin push, despliegue, migraciones aplicadas o trabajo 0.7.0. Resultados y archivos: [informe 0.6.1](IMPLEMENTATION_061.md).

## 2026-09-22 — PIKAS 0.6.0: caja guiada y eventos financieros

- POS por tipo de cliente, búsqueda mínima por nombre/código, carrito conservado al cambiar identidad y validación/pago explícitos.
- Shell persistente con estado, ubicación, cajero, contexto y tema personal; calculadora y consulta compartida en herramientas.
- Top 5 + Top 5 sin duplicados, ventanas 30/90 días y escenario histórico ficticio opcional.
- Límites diarios individuales ON/OFF. Efectivo identificado también consume límite; recargas no lo amplían.
- Recargas independientes, cambio automático, recibido obligatorio y ausencia de pagos divididos.
- Política de visibilidad separada de autoridad. Refund de caja OFF, parcial OFF, motivo/aprobación ON por defecto.
- Refund completo/parcial por importe, vinculado al original inmutable y atribuido a actor/aprobador; detalle familiar.
- Devolución del mismo día restaura capacidad diaria; devolución histórica solo devuelve fondos. Zona Santo Domingo.
- Mutaciones demo serializadas con Web Locks, idempotencia y relectura del estado; bloqueo offline y errores de sincronización.
- Preórdenes conservadas con validación actual y escritura serializada. Reportes/caja incluyen recargas y refunds.
- Migración local para políticas, alcance, eventos append-only y solicitudes familiares preparadas/deshabilitadas. **No aplicada ni verificada en PostgreSQL.**
- Validación local: lint, TypeScript, 42 unitarias, 87 E2E (390/768/1440 px) y build. Capturas actuales en guía demo.
- Sin push, PR, merge, despliegue, cambios de variables ni acceso/modificación de datos Supabase.

Límites: finanzas 0.6 demo; escritor/RPC remoto, pruebas RLS/concurrencia PostgreSQL, solicitudes familiares, ajustes administrativos, refund por unidades y cierre durable de turnos siguen pendientes. [Modelo financiero](POS_FINANCIAL_MODEL.md).


## 2026-08-27 — PIKAS 0.5.3: POS, caja y atribución

- PIKAS es identificada públicamente como diseñada y desarrollada por Palmchat Innovations LLC en landing y accesos.
- POS separa Ventas PIKAS, Cash — Student-linked y Cash — General sale.
- Las ventas PIKAS exigen verificación y aplican saldo, límites, disponibilidad, alergias y bloqueos.
- El efectivo asociado conserva restricciones estudiantiles sin afectar saldo ni límites; el efectivo general no crea asociación estudiantil.
- Cada compra registra método, asociación, impacto de saldo, impacto de caja, efectivo recibido, cambio, cajero, estación y estado.
- Cafetería recibe tarjetas operativas compactas, filtros, exportación CSV y conciliación entre cierre esperado y conteo ingresado.
- El carrito persiste, la identidad debe verificarse otra vez tras refrescar y Nueva venta limpia rápidamente el POS.
- El crédito efectivo-a-PIKAS permanece desactivado y separado de una venta normal.
- Verificación final: lint, typecheck, 25 pruebas unitarias, 57 E2E responsivas, build y diff check.

## 2026-08-12 — PIKAS 0.5.2: operación compartida

- Catálogo compartido con ingredientes, alérgenos, etiquetas, imágenes ficticias y fallback accesible.
- Bloqueos alimentarios enlazados a IDs estables y validados junto con alergias y disponibilidad en POS.
- POS tablet-first con código/NFC, efectivo, carrito persistente y separación explícita de efectivo y billetera.
- Menú visible en cafetería, POS, estudiante y familia; la disponibilidad afecta la orden inmediatamente.
- Modelo Supabase ampliado para restricciones, forma de pago y auditoría organizacional con RLS.
- Sin despliegue, cambios de Producción ni migraciones aplicadas a bases externas.

## 2026-08-12 — PIKAS 0.5.1: Auth y datos compartidos

- Supabase Auth para las cuentas ficticias escolar, cafetería y POS, con sesión por cookies, logout y guards de servidor.
- Roles consistentes, organizaciones, ubicaciones, membresías y una asociación activa ficticia.
- Menú compartido en Supabase con importes enteros y RLS por alcance.
- Seed Auth exclusivamente de desarrollo; la contraseña se recibe por entorno y no se registra.
- El demo público permanece ficticio. No hubo despliegue, cambio de variables de Producción ni migración externa.

## 2026-08-11 — PIKAS 0.5.0: base administrativa

- Se añadieron espacios separados para Administración escolar y Administración de cafetería, con acceso demo exacto y guards por rol.
- Se centralizó la matriz de permisos para padrón, administradores escolares, conexiones, menú, personal POS y checkout.
- Escuela puede buscar, filtrar, archivar/reactivar, regenerar códigos, iniciar restablecimientos e inspeccionar una importación CSV ficticia sin exponer contraseñas.
- Escuela administra conexiones Cafetería–Escuela y controla su alcance; los estados suspendido/revocado afectan lookup y checkout POS.
- Cafetería administra catálogo, precios, disponibilidad, personal de caja y vistas transaccionales de alcance mínimo.
- Invitaciones, cambios de cuenta, estudiantes, menú y conexiones producen actividad administrativa demo.
- El mismo estado persistente propaga cambios del menú a Estudiante/POS y mantiene las compras visibles en Familia/Estudiante/POS.
- Se añadieron pruebas unitarias de política y recorridos Playwright de fronteras administrativas, privacidad/CSV y propagación del menú.
- Se actualizó documentación, credenciales y material visual a 0.5.0.

Esta fase no desplegó, configuró Supabase ni modificó datos externos. Administración sigue usando el adaptador demo local; el binding productivo, RLS organizacional e invitaciones Auth quedan pendientes.

## 2026-08-11 — PIKAS 0.4.0: identidad visual

Cambios locales sin commit ni despliegue, sobre la interfaz 0.3.0.

### Implementado

- Se integraron los activos de marca aprobados y metadatos/iconos de aplicación.
- Se añadieron tokens semánticos de color, foco y superficie; Familia, Estudiante y POS conservan sus acentos de rol.
- Landing, login y shell usan logo en proporciones apropiadas sin alterar flujos demo.
- Se documentó el sistema en `docs/BRAND_GUIDE.md`.

### Limitaciones sin cambios

- Sin SVG, imagen Open Graph específica ni activo apto para impresión grande.
- Supabase y persistencia real permanecen fuera de esta fase visual.

## 2026-08-11 — Supabase de desarrollo: esquema y cuentas ficticias

### Implementado

- Se aplicaron las migraciones `202608110001` a `202608110004` al proyecto Supabase de desarrollo enlazado.
- Se cargó únicamente `seed.sql` ficticio y se provisionaron perfiles de Familia, Sofi Estudiante y Cafetería.
- Se corrigió la calificación de la función `public.current_role()` para evitar el conflicto con el keyword de PostgreSQL.
- Se añadió un grant mínimo a `service_role` para provisionamiento server-only de perfiles, estudiantes y membresías familiares.

### Pendiente

- Conectar y probar contra Supabase real las pantallas de Familia y Estudiante, recuperación, Storage, RLS de usuario y recorridos Playwright live.

## 2026-08-11 — PIKAS 0.3.0: shell responsivo y densidad visual

Cambios locales sin commit ni despliegue, basados en `1c93c15` sobre `feature/unified-pikas-app`.

### Implementado

- Se corrigió el shell Estudiante para usar sidebar y contenido en columnas desde tablet, con sidebar sticky de altura de viewport y contenido `min-w-0`.
- Se centralizó la configuración tipada de navegación con coincidencia exacta/prefijo y `aria-current` único.
- **Mis compras** recibió destino propio; `/estudiante/transacciones` ya no activa Perfil.
- La barra móvil conserva cinco destinos, incorpora safe-area padding y deja **Mi plan** como acción de dashboard/sidebar.
- Se añadió logout móvil accesible y se redujo densidad en landing, tarjetas, balance, menú y controles sin alterar reglas de dominio.
- Se amplió Playwright para proteger columnas desktop/tablet, navegación activa, overflow, obstrucción móvil y navegación Familia.
- Se renovaron capturas y documentación para la versión y los entornos verificados.

### Limitaciones sin cambios

- Demo auth, datos y persistencia siguen siendo ficticios y locales al navegador.
- Supabase Auth/RLS/Storage/RPC continúa sin conexión ni prueba live.
- Administración, QR verificable, refunds/reversos, pagos y sincronización entre dispositivos siguen pendientes.

## 2026-08-11 — Guía visual de demostración

Documentación preparada en `feature/unified-pikas-app` sobre el commit base `9448dda`; capturas obtenidas desde `http://localhost:3000` con demo mode activo. Sin despliegue ni cambios funcionales.

- Se creó `docs/DEMO_GUIDE.md` con un recorrido reproducible de 8–12 minutos para Familia, Estudiante y Cafetería/POS.
- Se capturaron pantallas originales de la aplicación local para acceso por rol, controles, navegación móvil, lookup inválido/válido, restricciones, carrito, confirmación, recibo, persistencia y visibilidad cruzada.
- Se añadió al README una entrada destacada con audiencia, secuencia, entorno verificado y accesos demo.
- Se documentaron el reinicio de `localStorage`, cambio seguro de roles, troubleshooting, checklist y diferencias entre local, preview protegido y producción con POS estático.
- No se modificó el catálogo de funcionalidades: la verificación confirmó los estados y límites existentes.

## 2026-08-11 — Primer milestone funcional de Cafetería/POS

Checkpoint de `feature/unified-pikas-app`; no desplegado a producción.

- Se sustituyó la respuesta fija de Sofi por lookup exacto de estudiantes ficticios activos y rechazo no enumerativo de códigos inválidos.
- Se añadió identidad mínima, saldo, disponible diario, límite por compra, alergias y bloqueos.
- Se creó catálogo compartido, búsqueda/categorías, disponibilidad, carrito, cantidades, eliminación, limpieza, total y confirmación explícita.
- Se implementaron validaciones en centavos para precios vigentes, cantidades, wallet, límites, alergias, bloqueos e indisponibilidad.
- El checkout demo crea compra y débito compartidos, actualiza saldo/gasto diario, persiste al refrescar y aparece en POS, Estudiante y Familia.
- Se incorporaron recibo, historial POS, búsqueda y detalle; refunds/reversos permanecen explícitamente no disponibles.
- Se añadió idempotencia demo y la migración productiva `202608110003_pos_purchases.sql` con tablas, RLS, inmutabilidad y RPC atómico.
- Se añadieron interfaces Supabase server-only y seed ficticio ampliado. La UI productiva no cae a datos demo cuando demo mode está apagado.
- Se ampliaron pruebas unitarias y Playwright para autorización, lookup inválido/válido, restricciones, checkout y visibilidad compartida.
- Se actualizaron `POS-001`–`POS-021` sin crear identificadores duplicados.

Supabase sigue sin configurar: la migración, Auth/RLS, el RPC y la integración UI productiva no se probaron contra una base viva.

## 2026-08-11 — Línea base de despliegue, demo y POS

Verificación realizada contra el commit `41e89d5`. Los cambios de esta entrada son exclusivamente de documentación; no implementan funcionalidades POS.

- Se verificó de forma independiente el alias público [https://pikas-demo.vercel.app](https://pikas-demo.vercel.app), apuntando a un despliegue de producción Vercel con estado `Ready`.
- Se probaron en navegador los accesos expuestos de Familia, Estudiante y Cafetería y sus destinos `/familias`, `/estudiante` y `/pos`.
- Se documentaron las credenciales demo publicadas, su alcance local/desplegado y el hecho de que demo mode no compara credenciales reales.
- Se revisaron los códigos activos `PK-10982` y `PK-11804`, además de separar los fixtures heredados que no funcionan como credenciales de la aplicación unificada.
- Se comprobó que el POS devuelve la misma respuesta estática para `PK-10982` y para un código inventado; por ello se reclasificó como demo visual, no como validación estudiantil.
- Se añadió la línea base del producto, el flujo POS recomendado para la siguiente fase y el catálogo `POS-001` a `POS-021` con estados verificables.
- Se aclararon los límites pendientes: Auth y persistencia Supabase en vivo, QR, búsqueda, carrito, reglas, checkout, ledger, saldo, recibos, reversos, idempotencia, recuperación e historial POS.

Fecha de verificación del despliegue y recorridos: **11 de agosto de 2026**. El SHA identifica la versión desplegada examinada; las ediciones documentales permanecen sin commit por solicitud expresa.
