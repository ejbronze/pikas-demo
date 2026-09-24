# Línea base del producto PIKAS

El milestone local 0.6.1 corrige la auditoría de 0.6.0 y mantiene aplicación, identidad, roles, menú compartido, cuentas ficticias, informes y conciliación demo. La URL pública no se modificó y puede ejecutar otra versión.

## Comportamiento vigente

POS abre con Usuario PIKAS / No usuario. Nombre o código identifica clientes elegibles de conexiones activas. Cambiar identidad conserva carrito y revalida todo. Los productos se eligen antes de validar/pagar; efectivo exige recepción suficiente y calcula cambio. Nueva transacción vuelve al punto de entrada.

No hay pagos divididos. La recarga es un evento independiente y no amplía el límite diario. Desde 0.6, efectivo identificado también consume capacidad diaria. La familia puede desactivar el máximo diario por estudiante sin desactivar restricciones o saldo.

Compras son snapshots que no se reescriben. Refund completo/parcial añade un registro vinculado; caja solo dispone de la acción cuando la política lo permite. Cuando se requiere aprobación, un administrador procesa desde su propia sesión. Familia ve monto, destino, original, motivo y atribución. Un reembolso histórico no añade capacidad al día actual.

Consulta [Modelo financiero](POS_FINANCIAL_MODEL.md) para tipos, reglas, recomendaciones, concurrencia y límites. El catálogo completo se resume en [Funcionalidades](FEATURE_CATALOG.md).

## Fixtures conservados

- Sofi `PK-10982`: RD$2,450 de saldo, límite diario RD$350, gasto ficticio inicial RD$160, por compra RD$250; Maní/Lactosa y bebidas energéticas restringidas.
- Mateo `PK-11804`: RD$1,680, límite RD$300, gasto inicial RD$105, por compra RD$200.
- `PK-00000` se rechaza. Solo Sofi tiene login estudiantil documentado.
- Pasta RD$180 es la compra inicial permitida. Pizza demuestra alergia; Especial del día, agotado.
- El historial opcional de recomendaciones se carga desde Configuración POS y no altera saldos/gasto actual.

## Verificación y límites

Las suites cubren reglas de compra, política, refunds, zona horaria, recomendaciones, límites independientes, dinero entero y recorridos responsivos a 390/768/1440 px. Los resultados finales se registran en el changelog del milestone.

El demo no es autenticación/persistencia financiera productiva. La migración 0.6 no fue aplicada ni probada en PostgreSQL; requiere revisión y pruebas de desarrollo. Las compras antiguas sin organización/ubicación requieren reconciliación explícita antes de conceder lectura operativa. Este parche 0.6.1 no hace push, PR, merge, despliegue ni modificación de Supabase. La base 0.6.0 auditada sí está en `Pikas_demo` (rama predeterminada); `main` permanece en 0.5.3.

0.6.1 corrige identidad única/ambigua, autorización vigente de escritores legacy, proyecciones por scope y recuperación idempotente antes de límites. Pruebas y estado local: [informe 0.6.1](IMPLEMENTATION_061.md).
