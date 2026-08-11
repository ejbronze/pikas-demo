# Arquitectura unificada

## Límites de la aplicación

`apps/web` es el único despliegue. App Router separa páginas públicas, Familias, Estudiante, POS y Administración. `proxy.ts` hace el primer control de rol en servidor; RLS sigue siendo la autoridad de datos. Un redirect nunca sustituye autorización en una mutación.

La interfaz usa Server Components como límite inicial. Los componentes cliente encapsulan formularios, diálogos y el adaptador demo. Producción debe obtener datos mediante el cliente Supabase de servidor y ejecutar mutaciones en Server Actions o RPC validados con Zod. No existe una caché duplicada por portal: ambos roles consultan estudiantes, wallets, ledger y preórdenes compartidos.

## Identidad y propiedad

`profiles.id` coincide con `auth.users.id`. `family_members` concede permisos explícitos sobre una familia. Un estudiante puede tener `profile_id` al activar acceso. Las políticas comprueban pertenencia familiar, identidad estudiantil, escuela del POS o rol administrativo. Los estudiantes no tienen políticas para modificar controles, alergias, restricciones o ledger.

Adultos y personal de cafetería usarán email/contraseña de Supabase Auth. El perfil de cafetería recibe `role = 'pos'` y queda vinculado a su escuela. Para código + PIN estudiantil, una futura función server-only debe aplicar rate limiting, comparar Argon2id/bcrypt y crear una sesión limitada. Nunca se guarda un PIN plano. Recuperación usa el email de Supabase y devuelve una respuesta no enumerable.

## Integridad financiera y mutaciones

Todo importe es entero en moneda menor. `wallet_balances` deriva el saldo de entradas completadas. Clientes no pueden actualizar un saldo ni editar/borrar ledger. Reservas de preorden son débitos; cancelación crea un crédito relacionado, nunca borra el débito. RPCs validan autorización, disponibilidad, alergias, bloqueos, límites y saldo dentro de una transacción.

Cada mutación financiera requiere `idempotency_key`, actor y timestamp. Una evolución de producción añadirá doble entrada, tabla append-only de auditoría, conciliación diaria con procesador, referencias externas, trabajos de discrepancia y estados de refund. Los webhooks verificarán firma y reutilizarán claves idempotentes.

El checkout POS utiliza `purchases` y `purchase_items` como instantánea operativa y `wallet_ledger_entries` como fuente contable. `complete_pos_purchase` vuelve a obtener precios y controles bajo una transacción, bloquea estudiante/wallet, rechaza restricciones y crea el débito, la compra y sus artículos de forma atómica. La unicidad de `idempotency_key` protege los reintentos. Triggers impiden editar o borrar compras y asientos completados; un reverso futuro deberá ser compensatorio.

## Demo y producción

El demo se activa solo con `NEXT_PUBLIC_PIKAS_DEMO_MODE=true` y persiste datos ficticios en el navegador para evaluar flujos compartidos. POS aplica una transición indivisible sobre el mismo estado usado por Familia y Estudiante. Es una garantía de demostración de un solo navegador, no una transacción multiusuario. El alias público tiene demo mode autorizado explícitamente; una futura instancia con datos reales debe desactivarlo y exige URL/anon key, perfiles Auth y acciones Supabase enlazadas.

## Shell y navegación responsiva

Familia y Estudiante comparten `AppShell` y una configuración tipada de destinos con coincidencia exacta o por prefijo. Desde `md`, el shell usa una columna lateral sticky y una columna de contenido `minmax(0,1fr)`; en móvil usa cinco destinos primarios, safe-area padding y logout accesible. Estudiante conserva **Mi plan** en el sidebar y dashboard, mientras **Mis compras** ocupa un destino móvil propio.

## Identidad visual

Los activos aprobados viven en `apps/web/public/brand/`. `BrandLogo` centraliza la selección del logo horizontal o mark en Next Image; `globals.css` define tokens semánticos para superficies, texto, foco, estados y color de marca. Las experiencias conservan sus acentos de rol: azul/teal para Familia, violeta/amarillo para Estudiante y teal/navy para POS. Consulta la [Guía de marca](BRAND_GUIDE.md).

## Privacidad estudiantil

Recolectar el mínimo necesario, limitar lecturas por escuela/familia, evitar IDs crudos en QR, registrar accesos administrativos y definir retención. Avatares deben vivir en buckets privados con URLs firmadas. Antes de declaraciones regulatorias se requiere revisión legal y de seguridad independiente.

## Próximas capas

POS todavía necesita un token QR opaco, binding de la UI con las interfaces Supabase, revalidación de vistas y pruebas reales de RLS/concurrencia. Administración usará permisos por escuela y auditoría para reversos futuros. Pagos futuros se aislarán tras un proveedor tokenizado; PIKAS nunca almacenará números de tarjeta.
