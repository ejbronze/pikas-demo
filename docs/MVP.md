# Alcance y roadmap de PIKAS

## Phase 4D — Production Administration & Provisioning

**STATUS: COMPLETE** · **Production acceptance: PASSED** · 2026-10-15.

El alcance probado cubre onboarding de cliente nuevo, organización, activación y administración, personal operativo y venta No Usuario en efectivo con recibo, sin intervención de desarrollador/base de datos. La [línea base del producto](PRODUCT_BASELINE.md) conserva componentes completos, evidencia, seguimiento acotado y reglas de congelación.

## Phase 5 — Financial Operations & Visibility

1. **5.1 Transaction & Register History** — implementado y aceptado en producción con un seguimiento documentado en [Phase 5A](PHASE_5A_TRANSACTION_REGISTER_OPERATIONS.md), junto con la base de conciliación de cierre de 5.4.
2. **5.2 Wallet / PIKAS Cash Replenishments** — completo y aceptado en producción en [Phase 5B](PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md) (2026-10-17), con la política Beta de autoridad PIKAS Cash.
3. **5.3 Refunds / correcciones** — 5C.1 reembolsos de compras y 5C.2 reversión de recargas completos y aceptados en producción ([5C.1](PHASE_5C1_REFUNDS.md), [5C.2](PHASE_5C2_REPLENISHMENT_REVERSALS.md)); 5C.3 ajustes administrativos implementado localmente ([5C.3](PHASE_5C3_ADMINISTRATIVE_ADJUSTMENTS.md)), pendiente de checkpoint productivo. Los hitos de corrección definidos para Phase 5C están implementados localmente; aprobaciones configurables, umbrales, alertas, notificaciones y ajustes de soporte PIKAS autorizados por el cliente siguen diferidos.
4. **5.4 Reporting & Reconciliation**
5. **5.5 Platform Analytics**

Phase 5A es el único milestone implementado en este trabajo; la aceptación productiva Phase 5A pasó con un único seguimiento de re-verificación POS pendiente por acceso al cajero ficticio (ver la línea base canónica). Phase 5B (5.2) está completo y aceptado en producción. Phase 5C.1 (reembolsos de compras) está completo y aceptado en producción; Phase 5C.2 (reversión de recargas) está completo y aceptado en producción; Phase 5C.3 (ajustes administrativos) está implementado localmente, pendiente de checkpoint productivo; Phase 5C no está aceptada en producción en su totalidad. Phase 5 no está completa. El soporte de venta en efectivo No Usuario ya existe y no es trabajo futuro. Los comportamientos financieros del demo histórico no constituyen aceptación productiva de Phase 5.

## Después de Phase 5

### Auditoría UX/UI transversal (antes del hardening de Phase 6)

Elemento futuro registrado durante la aceptación de Phase 5C.1; no forma parte de 5C.1 y no se rediseña nada como parte de ese cierre. PIKAS debe recibir una auditoría dedicada de UX/UI y diseño de interacción para todos los roles antes del hardening de Phase 6.

Observaciones conocidas a conservar:
- El cobro POS (método de pago y flujo de efectivo) debe ser más explícito y orientado a la tarea; considerar un modal de pago enfocado entre la confirmación del pedido y la finalización de la transacción.
- Las acciones financieras principales deben ser visualmente inequívocas.
- La pantalla de caja debe mostrar mejor el estado operativo de efectivo/caja.
- La búsqueda de reembolsos podría ofrecer una orientación de tarea más fuerte.
- La pantalla de sesión finalizada / recuperación de autenticación carece de la marca PIKAS, jerarquía visual y acciones pulidas.

Alcance: claridad de tareas, jerarquía de acciones, etapas del flujo, retroalimentación, claridad financiera, terminología, estados de error/recuperación, consistencia, eficiencia, comportamiento responsive/táctil, accesibilidad, adecuación por rol y pulido visual. Los hallazgos se priorizan como usabilidad/seguridad, fricción de flujo, pulido visual o mejora futura antes de implementar cambios.

#### Observaciones adicionales (cierre de Phase 5C.2)

Candidatas para el análisis; no son requisitos de implementación ni autorizan rediseño.

- **Profundidad de navegación:** tareas importantes y frecuentes requieren demasiados clics y rutas anidadas. Preferir navegación superficial y orientada a tareas; el usuario no debe entender la jerarquía organizacional interna para encontrar una acción común. Los paneles por rol deberían funcionar cada vez más como lanzadores de tareas comunes.
- **Acciones rápidas** (según rol y autorización): Nueva venta, Reembolsos, Recargar PIKAS Cash, Movimientos, Cajas, Cerrar caja, Productos, Personal, Reportes.
- **Modales y etapas del flujo:** evaluar experiencias modales contextuales para flujos transaccionales cortos (cobro/pago, reembolso, recarga, reversión) que guíen paso a paso y preserven el contexto. No forzar todos los flujos en modales; usarlos donde reduzcan cambios de contexto y carga cognitiva.
- **Cobro POS:** la acción de pago en efectivo no es suficientemente visible. Evaluar un modal de pago enfocado entre la confirmación del pedido y la finalización: total → método de pago → efectivo recibido → cambio → confirmación final. La acción de compromiso financiero final debe ser inequívoca.
- **Lenguaje visual financiero** consistente en todo PIKAS: dinero positivo/aditivo en verde; negativo/deductivo en rojo; saldos actuales neutros (navy) salvo que el estado sea negativo; saldos negativos en rojo. No depender solo del color: conservar +/−, etiquetas, íconos u otras señales para accesibilidad. Ejemplos: +RD$25.00 Recarga verificada (positivo); −RD$25.00 Reversión de recarga (negativo); −RD$50.00 Reembolso (negativo); RD$425.00 Saldo actual (neutro); −RD$75.00 Saldo actual (negativo).
- **Affordance de acciones:** acciones importantes a veces quedan ocultas. Auditar la jerarquía primaria, secundaria, terciaria y correctiva/peligrosa; las acciones primarias deben reconocerse de inmediato como clicables; evitar esconder acciones comunes en tarjetas o páginas anidadas.
- **Experiencia de caja:** mostrar de forma prominente el fondo inicial, ventas en efectivo, reembolsos en efectivo, efectivo esperado y estado actual de caja/sesión. Cerrar la caja no debe ser el único propósito visualmente dominante de la pantalla de caja abierta.
- **Descubrimiento de reembolsos:** evaluar acceso desde transacciones recientes y/o paneles por rol, en lugar de requerir primero el número de recibo o conocer la ruta.
- **Sesión / recuperación:** la pantalla de sesión finalizada es visualmente plana y carece de marca PIKAS, jerarquía y acciones pulidas.

#### Análisis de recorridos (click-path)

Para flujos de alta frecuencia, medir: interacciones/clics actuales, número de páginas/contextos de navegación, cambios de contexto innecesarios, interacción objetivo propuesta y recorrido simplificado propuesto. Incluir al menos: realizar una venta, cobro en efectivo, cobro con PIKAS Cash, reembolsar una transacción reciente, recargar monedero, revertir recarga, buscar estudiante, abrir caja, cerrar caja, revisar la actividad del día, gestionar cajeros/personal y gestionar límites de gasto.

Formato de hallazgos: Tarea · Recorrido actual · Número de interacciones · Número de navegaciones/contextos · Hallazgo · Impacto en el usuario · Severidad · Recomendación · Recorrido objetivo · Esfuerzo estimado.

Prioridad: **P0** riesgo financiero/de usabilidad · **P1** fricción relevante del flujo · **P2** jerarquía visual/pulido · **P3** mejora futura.

La auditoría es **primero análisis**: no autoriza un rediseño amplio autónomo.


Phase 6: hardening financiero, autoridad, concurrencia y casos operativos. Phase 7: paquete de operación/preparación del piloto Beta 1. No se implementan en Phase 5A.

## Referencia histórica — milestone 0.6.0

El alcance siguiente corresponde al demo local de ese milestone, no a la línea base productiva actual.

PIKAS conserva cinco experiencias responsivas en español: Familia, Estudiante, POS, Administración escolar y Administración de cafetería. Diseñada y desarrollada por Palmchat Innovations LLC.

Incluido en demo local:

- Padrón/conexiones/personal/catálogo y controles existentes.
- POS guiado por tipo de cliente, búsqueda mínima por nombre/código, carrito persistente y cambio de cliente sin pérdida de productos.
- Compras completas con saldo o efectivo, cambio automático, recibos, historial compartido y calculadora.
- Límites diarios individuales ON/OFF, restricciones alimentarias y recargas independientes.
- Política de visibilidad y reembolso; full/parcial por importe, atribución, original inmutable, visibilidad familiar y gasto neto del mismo día.
- Reportes/CSV anteriores y caja esperada que incluye recargas/refunds.
- Prevención de duplicados y serialización entre pestañas del mismo navegador/origen.

Fuera de alcance productivo: dinero real, procesador de pagos, sincronización entre dispositivos, QR verificable, conexión SIS, conciliación durable y escritor financiero Supabase 0.6. Correcciones administrativas y solicitudes familiares tienen arquitectura preparada, sin UI/escritor habilitado. Las solicitudes permanecen OFF.

Ver [Modelo financiero](POS_FINANCIAL_MODEL.md) para invariantes, [Demo](DEMO_GUIDE.md) para escenarios y [Permisos](ADMINISTRATION_AND_PERMISSIONS.md) para fronteras. No se aplicaron migraciones ni se desplegó esta versión.
