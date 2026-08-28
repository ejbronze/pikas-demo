# Alcance del MVP

PIKAS 0.5.3 ofrece una aplicación responsiva unificada en español para Familia, Estudiante, Cafetería/POS, Administración escolar y Administración de cafetería. Las experiencias comparten estudiantes ficticios, wallets, controles, catálogo, conexiones, preórdenes, compras y movimientos dentro del mismo navegador. PIKAS es diseñada y desarrollada por Palmchat Innovations LLC.

## Incluido en el demo

- Familia: saldos, estudiantes vinculados, recargas ficticias, límites, alergias, bloqueos, movimientos y preórdenes.
- Estudiante: saldo y disponible diario, menú con restricciones, preórdenes, historial, presupuesto personal, perfil y QR visual.
- Cafetería/POS: lookup exacto por código, identidad mínima, restricciones, carrito, checkout, recibo e historial compartido.
- Guards por rol, logout, navegación responsiva y persistencia versionada en `localStorage`.

## Fuera de alcance

No hay dinero real, procesador de pagos, integración SIS, QR verificable, búsqueda POS por nombre, refunds/reversos ni sincronización entre dispositivos. La conciliación 0.5.3 es demostrativa y local. Las organizaciones, invitaciones y auditoría aún requieren binding y verificación productiva contra Supabase.

## Criterio de demostración

El demo usa exclusivamente datos ficticios. Los cambios sobreviven una recarga en el mismo navegador y origen, pero no se comparten con otros perfiles o dispositivos. El alias público está autorizado como demo mode; no representa autenticación ni persistencia de producción.
