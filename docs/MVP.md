# Alcance del MVP — milestone 0.6.0

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
