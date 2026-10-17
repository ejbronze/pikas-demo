# Alcance y roadmap de PIKAS

## Phase 4D — Production Administration & Provisioning

**STATUS: COMPLETE** · **Production acceptance: PASSED** · 2026-10-15.

El alcance probado cubre onboarding de cliente nuevo, organización, activación y administración, personal operativo y venta No Usuario en efectivo con recibo, sin intervención de desarrollador/base de datos. La [línea base del producto](PRODUCT_BASELINE.md) conserva componentes completos, evidencia, seguimiento acotado y reglas de congelación.

## Phase 5 — Financial Operations & Visibility

1. **5.1 Transaction & Register History** — implementado y aceptado en producción con un seguimiento documentado en [Phase 5A](PHASE_5A_TRANSACTION_REGISTER_OPERATIONS.md), junto con la base de conciliación de cierre de 5.4.
2. **5.2 Wallet / PIKAS Cash Replenishments** — completo y aceptado en producción en [Phase 5B](PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md) (2026-10-17), con la política Beta de autoridad PIKAS Cash.
3. **5.3 Refunds** — 5C.1 reembolsos controlados de compras completo y aceptado en producción ([Phase 5C.1](PHASE_5C1_REFUNDS.md)); 5C.2 reversión de recargas y 5C.3 ajustes/aprobaciones/notificaciones diferidos.
4. **5.4 Reporting & Reconciliation**
5. **5.5 Platform Analytics**

Phase 5A es el único milestone implementado en este trabajo; la aceptación productiva Phase 5A pasó con un único seguimiento de re-verificación POS pendiente por acceso al cajero ficticio (ver la línea base canónica). Phase 5B (5.2) está completo y aceptado en producción. Phase 5C.1 (reembolsos de compras) está completo y aceptado en producción; Phase 5C no está completa (5C.2 y 5C.3 diferidos). Phase 5 no está completa. El soporte de venta en efectivo No Usuario ya existe y no es trabajo futuro. Los comportamientos financieros del demo histórico no constituyen aceptación productiva de Phase 5.

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
