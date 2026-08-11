# Alcance del MVP

PIKAS 0.5.0 ofrece una aplicación responsiva unificada en español para Familia, Estudiante, Cafetería/POS, Administración escolar y Administración de cafetería. Las experiencias comparten estudiantes ficticios, wallets, controles, catálogo, conexiones, preórdenes, compras y movimientos dentro del mismo navegador.

## Incluido en el demo

- Familia: saldos, estudiantes vinculados, recargas ficticias, límites, alergias, bloqueos, movimientos y preórdenes.
- Estudiante: saldo y disponible diario, menú con restricciones, preórdenes, historial, presupuesto personal, perfil y QR visual.
- Cafetería/POS: lookup exacto por código, identidad mínima, restricciones, carrito, checkout, recibo e historial compartido.
- Guards por rol, logout, navegación responsiva y persistencia versionada en `localStorage`.

## Fuera de alcance

No hay dinero real, procesador de pagos, integración SIS, QR verificable, búsqueda POS por nombre, refunds/reversos, conciliación ni sincronización entre dispositivos. Administración funciona como demo 0.5.0, pero sus organizaciones, invitaciones y auditoría aún no están conectadas a Supabase. Auth, PostgreSQL/RLS, correo y Storage requieren binding y verificación productiva.

## Criterio de demostración

El demo usa exclusivamente datos ficticios. Los cambios sobreviven una recarga en el mismo navegador y origen, pero no se comparten con otros perfiles o dispositivos. El alias público está autorizado como demo mode; no representa autenticación ni persistencia de producción.
