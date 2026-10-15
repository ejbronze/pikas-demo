# Línea base del producto PIKAS

## Phase 4D — Production Administration & Provisioning

**STATUS: COMPLETE**
**Production acceptance: PASSED** — 2026-10-15.

El alcance probado permite incorporar un cliente nuevo, configurar su organización, provisionar administradores y personal operativo y operar su cuenta mediante los flujos de PIKAS. Después del onboarding de Platform, la administración normal probada no requiere a Edwin, Oscar, SQL, Supabase ni intervención de un desarrollador.

### Línea base de producción aceptada

| Dato | Valor |
| --- | --- |
| Rama | `Pikas_demo` |
| Source | `df802b530b3cab4a92140f7d7b9a025e36f2b9c7` |
| Deployment | `dpl_4pLUTkodjv4qpNEpxDDUNeu3L8E4` |
| Migraciones alineadas hasta | `202610150001_cafeteria_staff_activation.sql` |
| Dominio | `pikas-pikas.app` |
| Fecha de aceptación | `2026-10-15` |

Estos identificadores corresponden a la aceptación completada; este cierre documental no implica otro despliegue ni una nueva verificación de producción.

### Componentes completos

| Paso | Alcance completado |
| --- | --- |
| 4D.1 | Platform Customer Management + Provisioning |
| 4D.2 | Connected School Administration |
| 4D.3 | Connected Cafeteria Administration |
| 4D.4 | Platform Team Administration |
| 4D.5 | Account Invitation & Activation |
| 4D.6 | Sandbox Administration POVs |
| 4D.7 | Beta Admin Experience / UX |
| 4D.8 | Fresh-Customer Acceptance Test — PASS |

4D.7 incluye UX administrativa compartida, administración estudiantil, catálogo/unidad de producto, UX de activación, consistencia responsiva entre administraciones, No Usuario y selección explícita de pago, seguridad/timeouts de sesión, administración masiva de estudiantes, filtros del padrón, exportaciones CSV, delegación de administración de cafetería, activación de cajeros y navegación de entrada al POS. Esta lista registra el alcance completado; no implica que cada función se haya ejercitado individualmente en la aceptación 4D.8.

### Evidencia de aceptación 4D.8

Datos ficticios creados mediante el producto:

| Entidad | Evidencia |
| --- | --- |
| Cliente | Academia Piloto PIKAS · Aceptación 4D.8 |
| Escuela | Escuela Ficticia Beta 4D.8 |
| Sede | Sede Ficticia Beta |
| Cafetería | Cafetería Ficticia Beta |
| Administrador | Administrador Ficticio Beta |
| Estudiante creado e inscrito | Sol Ficticia Beta · `BETA-4D8-001` |
| Producto | Agua Ficticia Beta 4D.8 · Bebidas Beta · botella · RD$25.00 |
| Cajero | Cajero Ficticio Beta |
| Caja | Caja Ficticia Beta 4D.8 · `BETA-01` |

Recorrido probado: Platform → cliente nuevo → escuela → sede → cafetería → administrador inicial → activación segura del administrador → administración explícita de cuenta → creación/inscripción estudiantil → delegación explícita de administración de cafetería → administración de cafetería → creación de producto → invitación de cajero → activación segura y establecimiento de contraseña → completar acceso del cajero explícitamente → creación de caja → asignación del cajero → autenticación normal del cajero → entrada autorizada al POS → apertura de caja → selección de producto → pago explícito en efectivo → venta comprometida → recibo.

La caja inició con RD$0.00 y su asignación al cajero persistió tras recargar. El cajero autenticó normalmente, tuvo únicamente autoridad `pos_cashier`, no recibió autoridad escolar ni de administración de cafetería y utilizó «Entrar al POS».

| Transacción final | Valor |
| --- | --- |
| Producto / cantidad | Agua Ficticia Beta 4D.8 / 1 |
| Cliente / pago | No Usuario / Efectivo |
| Total | RD$25.00 |
| Recibido | RD$50.00 |
| Cambio | RD$25.00 |
| Recibo | #1 |
| Purchase ID | `daccc804-d8e1-4ef1-9789-99156075fe50` |
| Resultado | Venta confirmada |

«Nueva transacción» quedó disponible; no se realizó una segunda transacción. No se requirió SQL, intervención de Supabase, bypass de API de desarrollador, asignación manual de roles ni fondos de wallet. Colegio Horizonte permaneció aislado y sin modificaciones.

### Seguimiento acotado y sesión

Sol Ficticia Beta (`BETA-4D8-001`) se creó e inscribió correctamente, pero no apareció en la búsqueda estudiantil del POS. La aceptación utilizó el camino soportado No Usuario + Efectivo.

> Follow-up: investigate why a newly enrolled fresh-customer student was not returned by POS student search during 4D.8 acceptance. This did not block the accepted No Usuario cash-sale path.

El seguimiento queda registrado sin diagnóstico ni cambio de comportamiento y no reabre Phase 4D. La reautenticación del administrador después de un timeout durante la aceptación fue la aplicación esperada de la política de sesión existente, no un defecto.

### Congelación del alcance completado

El comportamiento completado de Phase 4D constituye la línea base de producción. Solo debe modificarse para corregir un defecto confirmado o por una necesidad de una función posterior aprobada, en ambos casos con cobertura de regresión dirigida. Las migraciones comprometidas son inmutables: nunca deben reescribirse.

La siguiente fase planificada es [Phase 5 — Financial Operations & Visibility](MVP.md). No se inicia como parte de este cierre. El soporte de venta en efectivo No Usuario ya existe.

## Referencia histórica: demo local 0.6.1

El contenido siguiente conserva el estado y los límites del milestone histórico; no describe el estado de producción aceptado arriba.

El milestone local 0.6.1 corrige la auditoría de 0.6.0 y mantiene aplicación, identidad, roles, menú compartido, cuentas ficticias, informes y conciliación demo. La URL pública no se modificó y puede ejecutar otra versión.

### Comportamiento vigente

POS abre con Usuario PIKAS / No usuario. Nombre o código identifica clientes elegibles de conexiones activas. Cambiar identidad conserva carrito y revalida todo. Los productos se eligen antes de validar/pagar; efectivo exige recepción suficiente y calcula cambio. Nueva transacción vuelve al punto de entrada.

No hay pagos divididos. La recarga es un evento independiente y no amplía el límite diario. Desde 0.6, efectivo identificado también consume capacidad diaria. La familia puede desactivar el máximo diario por estudiante sin desactivar restricciones o saldo.

Compras son snapshots que no se reescriben. Refund completo/parcial añade un registro vinculado; caja solo dispone de la acción cuando la política lo permite. Cuando se requiere aprobación, un administrador procesa desde su propia sesión. Familia ve monto, destino, original, motivo y atribución. Un reembolso histórico no añade capacidad al día actual.

Consulta [Modelo financiero](POS_FINANCIAL_MODEL.md) para tipos, reglas, recomendaciones, concurrencia y límites. El catálogo completo se resume en [Funcionalidades](FEATURE_CATALOG.md).

### Fixtures conservados

- Sofi `PK-10982`: RD$2,450 de saldo, límite diario RD$350, gasto ficticio inicial RD$160, por compra RD$250; Maní/Lactosa y bebidas energéticas restringidas.
- Mateo `PK-11804`: RD$1,680, límite RD$300, gasto inicial RD$105, por compra RD$200.
- `PK-00000` se rechaza. Solo Sofi tiene login estudiantil documentado.
- Pasta RD$180 es la compra inicial permitida. Pizza demuestra alergia; Especial del día, agotado.
- El historial opcional de recomendaciones se carga desde Configuración POS y no altera saldos/gasto actual.

### Verificación y límites

Las suites cubren reglas de compra, política, refunds, zona horaria, recomendaciones, límites independientes, dinero entero y recorridos responsivos a 390/768/1440 px. Los resultados finales se registran en el changelog del milestone.

El demo no es autenticación/persistencia financiera productiva. La migración 0.6 no fue aplicada ni probada en PostgreSQL; requiere revisión y pruebas de desarrollo. Las compras antiguas sin organización/ubicación requieren reconciliación explícita antes de conceder lectura operativa. Este parche 0.6.1 no hace push, PR, merge, despliegue ni modificación de Supabase. La base 0.6.0 auditada sí está en `Pikas_demo` (rama predeterminada); `main` permanece en 0.5.3.

0.6.1 corrige identidad única/ambigua, autorización vigente de escritores legacy, proyecciones por scope y recuperación idempotente antes de límites. Pruebas y estado local: [informe 0.6.1](IMPLEMENTATION_061.md).
