# Línea base del producto PIKAS

Versión local **0.4.0** de la rama `feature/unified-pikas-app`, verificada el **11 de agosto de 2026**. El despliegue público [https://pikas-demo.vercel.app](https://pikas-demo.vercel.app) contiene el POS funcional y demo auth autorizada, pero no incluye todavía los refinamientos locales 0.4.0.

El recorrido reproducible para presentar esta línea base, incluidas capturas y reinicio del estado ficticio, está en la [Guía de demostración](DEMO_GUIDE.md).

## Estado general

La aplicación unificada ofrece recorridos para Familia, Estudiante y Cafetería/POS. En demo mode usa una cookie de rol y un único estado ficticio versionado en `localStorage`; estudiantes, catálogo, compras, balances y movimientos se comparten entre las tres experiencias del mismo navegador. El demo no mueve fondos reales y sus credenciales no constituyen autenticación. En 0.3.0, Familia y Estudiante comparten un shell responsivo con sidebar estable desde tablet, navegación móvil segura y estado activo exacto por ruta.

Producción tiene clientes Supabase de servidor y una migración POS nueva, pero no fue posible aplicar ni validar el esquema contra un proyecto vivo. Cuando demo mode está desactivado, `/pos` no usa fixtures silenciosamente: muestra una configuración requerida hasta que se conecten las acciones Supabase.

## Recorrido Cafetería/POS implementado

1. `/login` selecciona el rol Cafetería; el proxy y la página `/pos` vuelven a comprobar el rol en servidor.
2. El empleado introduce un código con formato `PK-00000`. Solo una coincidencia exacta y activa pasa; desconocidos, malformados o archivados no revelan información.
3. El POS muestra nombre preferido/iniciales, escuela, grado, estado, saldo, disponible diario, límite por compra y alertas esenciales.
4. El catálogo compartido permite búsqueda, filtro, agregar, cambiar cantidad, quitar y vaciar el carrito.
5. Productos agotados, alergénicos o bloqueados muestran una explicación textual y no pueden añadirse.
6. Una confirmación explícita precede al checkout. Los controles pendientes impiden envíos repetidos.
7. El adaptador demo vuelve a resolver estudiante, artículos, precios, cantidades, saldo, límites y restricciones mediante reglas puras en centavos.
8. Una actualización indivisible agrega la compra completada, el débito compartido y los nuevos balance/gasto diario. La clave idempotente devuelve la compra anterior ante un reintento.
9. El recibo y el historial POS muestran artículo, total, fecha, estado y caja. Estudiante y Familia leen el mismo movimiento y saldo tras navegar o refrescar.
10. Un carrito sin terminar se vacía sin registros. Reversos y refunds están marcados como no disponibles; no existe un botón ficticio.

## Persistencia de producción preparada

`202608110003_pos_purchases.sql` incorpora:

- `purchases` y `purchase_items` con moneda, precios históricos, actor, estado, timestamps, claves foráneas, índices e idempotencia única.
- RLS de lectura basada en el estudiante/escuela y ausencia deliberada de escrituras directas de cliente.
- Triggers que impiden editar o borrar registros financieros completados.
- `complete_pos_purchase`, un RPC `security definer` disponible solo para usuarios autenticados.
- Validación dentro de la transacción de rol POS, escuela, estudiante/wallet activos, existencia/disponibilidad, cantidad, precio vigente, alergias, bloqueos, saldo y límites.
- Bloqueo de filas, creación atómica de ledger/compra/artículos y recuperación por clave idempotente.

`apps/web/lib/pos/supabase.ts` define los límites server-only para lookup, checkout e historial. Falta enlazar esos métodos con la interfaz una vez que un proyecto Supabase esté provisionado y pueda verificarse con Auth/RLS reales.

## Datos seguros de demostración

- `PK-10982`: Sofi, activa; saldo RD$2,450, límite diario RD$350, gastado RD$160, límite por compra RD$250, alergias Maní/Lactosa y Bebidas energéticas bloqueadas. Pasta con pollo por RD$180 constituye el caso permitido.
- `PK-11804`: Mateo, activo; saldo RD$1,680, límite diario RD$300, gastado RD$105, límite por compra RD$200 y Bebidas energéticas bloqueadas.
- `PK-00000` y cualquier código desconocido se rechazan.
- Pizza escolar demuestra bloqueo por alergia para Sofi; Bebidas energéticas demuestra restricción familiar; Especial del día demuestra indisponibilidad.

Para reiniciar: elimina `pikas:unified-demo:v2` del almacenamiento del origen. El demo funcional requiere `NEXT_PUBLIC_PIKAS_DEMO_MODE=true`. Nunca uses nombres, alergias, contraseñas o medios de pago reales.

## Límites conocidos

- La atomicidad e idempotencia demo se prueban sobre una actualización pura del estado del navegador, no sobre una base multiusuario.
- La autenticación demo sigue siendo selección de rol; no verifica la contraseña mostrada.
- El PIN estudiantil productivo, rate limiting, correo y Storage todavía requieren Supabase real.
- La migración/RPC no se aplicó ni probó en PostgreSQL local o remoto por falta de configuración disponible.
- No hay QR funcional, búsqueda por nombre, conciliación, cancelación de compras completadas, reverso o refund autorizado.
- La producción aún necesita enlazar UI y funciones server-only, revalidar cachés y ejecutar pruebas Auth/RLS con usuarios reales de desarrollo.

## Evidencia de verificación

- 19 pruebas unitarias de dominio/data access.
- Seis recorridos Playwright configurados para Chromium escritorio y WebKit móvil, incluido checkout compartido POS → Estudiante → Familia.
- TypeScript estricto, ESLint y build de producción.
- Revisión manual en navegador de códigos válido/inválido, restricciones, compra, persistencia, sincronización, consola y overlays.
