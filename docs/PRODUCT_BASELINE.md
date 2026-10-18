# Línea base del producto PIKAS

## Phase 5C.3 — aceptación de producción (capa de correcciones Phase 5C completa)

**PHASE 5C.3 — COMPLETE / PRODUCTION ACCEPTED** y congelado. Source `07a1b928096fbc1f5731a2e7b1847dfe5ae8f238`; migración `202610200001_administrative_wallet_adjustments.sql`. Reglas finales y evidencia (un ajuste +RD$25.00, RD$0.00 → RD$25.00, actor/rol/motivo/explicación preservados) en [Phase 5C.3](PHASE_5C3_ADMINISTRATIVE_ADJUSTMENTS.md). Con 5C.1, 5C.2 y 5C.3 aceptados y congelados, la capa de correcciones definida para Phase 5C está completa; aprobaciones, notificaciones, soporte PIKAS autorizado y analítica siguen diferidos.

## Phase 5C.2 — aceptación de producción

**PHASE 5C.2 — COMPLETE / PRODUCTION ACCEPTED** y congelado como línea base Beta de reversión de recargas. Source `9f228dc97de268c01d45290fa8adeb488ef48b8e`; migración `202610190001_replenishment_reversals.sql`. Reglas finales y evidencia (reversión de la recarga de aceptación Phase 5B, saldo RD$0.00, original intacta) en [Phase 5C.2](PHASE_5C2_REPLENISHMENT_REVERSALS.md). 5C.3 diferido.

## Phase 5C.1 — aceptación de producción

**PHASE 5C.1 — COMPLETE / PRODUCTION ACCEPTED** y congelado como línea base Beta de reembolsos de compras. Source `f2433884c3eb92b0ba85aa3ffa064776f74c6a85`; migraciones `202610180001` y `202610180002`. Reglas finales y evidencia de aceptación (recibo #2, reembolso #1 de RD$25.00 en BETA-01, efectivo esperado de vuelta a RD$3,000.00, sin reescribir cajas históricas) en [Phase 5C.1](PHASE_5C1_REFUNDS.md). 5C.2 y 5C.3 diferidos; reembolsos de crédito de personal diferidos. Auditoría UX/UI transversal registrada en el [roadmap](MVP.md) antes de Phase 6.

## Phase 5B — aceptación de producción (2026-10-17)

**PHASE 5B — COMPLETE / PRODUCTION ACCEPTED.** Source `e05cf5f27f17733ea26a13bf089ce0ccb654c8b5`; migraciones alineadas hasta `202610170001_beta_wallet_authority.sql` (proyecto pikas-pilot).

- La primera activación (source `4f0e752b`) mostró un bloqueo: el administrador inicial de cuenta (`account_admin`) no podía cargar PIKAS Cash. El propietario definió la política Beta de autoridad PIKAS Cash, que resolvió el bloqueo y queda aceptada ([permisos](ADMINISTRATION_AND_PERMISSIONS.md)).
- Recorrido controlado: Administrador Ficticio Beta, Escuela Ficticia Beta 4D.8, estudiante Sol Ficticia Beta (BETA-4D8-001). Saldo previo RD$0.00, monedero activo. Una recarga `manual_verified` de RD$25.00 (referencia `ACEPTACION-5B`). Saldo final RD$25.00 con un único movimiento, actor, referencia y nota correctos. Persistió tras recargar la página. Sin segunda recarga.
- Phase 5C (reembolsos, reversiones, corrección/auditoría) no iniciada. El acceso de soporte de Plataforma, temporal y de solo lectura autorizado por el cliente, sigue diferido. [Detalle](PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md).

## Phase 5A — aceptación de producción (2026-10-16)

**PHASE 5A PRODUCTION ACCEPTANCE PASS WITH ONE DOCUMENTED FOLLOW-UP**

Checkpoint de activación confirmado por el propietario: `pikas-pikas.app` sirve
`d2fdd6888a53e8571550423f4bffd5876e94883e`, deployment
`dpl_ET7gUF21YZUpXnVzTBP3863EmzV2`, base alineada hasta
`202610160001_transaction_register_operations.sql`. Este registro documental no
repite verificaciones de infraestructura ni ejecuta otra activación.

La aceptación mediante UI normal de Academia Piloto PIKAS · Aceptación 4D.8 /
Cafetería Ficticia Beta confirmó historial de transacciones, detalle del recibo #1,
historial de caja y detalle de la sesión `17fc9f13-6770-4a3c-b38d-6be8ae720f94`
de Caja Ficticia Beta 4D.8 · BETA-01. La compra
`daccc804-d8e1-4ef1-9789-99156075fe50` conservó 1 Agua Ficticia Beta 4D.8,
No Usuario, efectivo RD$25.00, recibido RD$50.00, cambio RD$25.00 y atribución a
Cajero Ficticio Beta.

Antes del cierre, la UI confirmó fondo RD$0.00, una venta en efectivo RD$25.00,
sin otros movimientos de efectivo y esperado RD$25.00. El cierre explícito
administrativo tuvo éxito: **esperado RD$25.00 / contado RD$25.00 / diferencia
RD$0.00**. Tras recargar y reabrir el detalle persistieron el estado cerrado,
los importes, la atribución a Administrador Ficticio Beta y el timestamp visible
`16/10/2026, 9:17:56 p. m.` (Santo Domingo). El recibo #1 permaneció intacto.

**Único seguimiento:** la afirmación final de UI productiva de rechazo POS contra
la sesión cerrada **no se ejecutó**. El acceso `cajero.beta4d8@example.invalid`
está Completado, el propietario no dispone de su contraseña y `.invalid` no tiene
un buzón utilizable para completar la recuperación normal. Se solicitó recuperación
mediante PIKAS; la UI respondió: «Si existe una cuenta con ese correo, recibirás
instrucciones para recuperar el acceso.» No se confirma entrega de un enlace.
Administración mantuvo Completado, sin exponer contraseña ni ofrecer una
reactivación inapropiada. Esto **no se clasifica como fallo funcional de Phase 5A**.

El rechazo POS de sesiones cerradas ya fue probado **localmente** durante Phase 5A,
con pruebas enfocadas/regresiones POS y navegador en modo producción local. Esa
evidencia no sustituye ni se presenta como la comprobación pendiente en producción.

Reverificar el rechazo POS de caja cerrada durante la próxima sesión controlada de
cajero en producción/piloto con credenciales válidas. **No reabrir ni mutar la sesión
BETA-01 completada para obtener esa prueba.** No continuar recuperación de credenciales,
modificar/reemplazar al cajero ni fabricar evidencia mediante intervención técnica.

No se crearon ventas ni sesiones de caja adicionales. No se entró en Colegio Horizonte,
no se modificaron sus datos y no apareció información financiera de otros clientes o
sandbox en los historiales inspeccionados. No se inició Phase 5B. La aceptación se
detiene aquí; este cierre documental no realiza mutaciones en producción.

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

## Phase 5A — fundamento de implementación

Transacciones, detalle de compra/recibo, historial/detalle de sesiones y cierre excepcional administrativo con conciliación durable. Esperado = fondo + ventas efectivo + cobros de personal en efectivo − reembolsos de efectivo; diferencia = contado − esperado. Se preservan capacidades y límites sandbox de Phase 4. [Contrato y evidencia local](PHASE_5A_TRANSACTION_REGISTER_OPERATIONS.md). La aceptación productiva y su único seguimiento se registran arriba; Phase 5 no está completa.

## Phase 5B — fundamento de implementación (local)

PIKAS Cash reutiliza el monedero y el ledger inmutable existentes: saldo actual = suma firmada de movimientos (recargas positivas, compras negativas). Recarga `manual_verified` con capacidades existentes `school:wallets:read/replenish`, revalidación de autoridad tras la espera del bloqueo por estudiante y clave de solicitud ligada al payload. Independiente del efectivo de caja de Phase 5A. [Contrato y evidencia local](PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md). Fundamento inicial local; autoridad ampliada por la política Beta y aceptado en producción el 2026-10-17 (ver arriba). Phase 5 no está completa.

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
