# Arquitectura unificada

## Límites de la aplicación

`apps/web` es el único despliegue. App Router separa páginas públicas, Familias, Estudiante, POS y Administración. `proxy.ts` hace el primer control de rol en servidor; RLS sigue siendo la autoridad de datos. Un redirect nunca sustituye autorización en una mutación.

La interfaz usa Server Components como límite inicial. Los componentes cliente encapsulan formularios, diálogos y el adaptador demo. Producción debe obtener datos mediante el cliente Supabase de servidor y ejecutar mutaciones en Server Actions o RPC validados con Zod. No existe una caché duplicada por portal: ambos roles consultan estudiantes, wallets, ledger y preórdenes compartidos.

## Identidad y propiedad

`profiles.id` coincide con `auth.users.id`. `family_members` concede permisos explícitos sobre una familia. Un estudiante puede tener `profile_id` al activar acceso. Las políticas comprueban pertenencia familiar, identidad estudiantil, escuela del POS o rol administrativo. Los estudiantes no tienen políticas para modificar controles, alergias, restricciones o ledger.

Adultos y personal —incluido el usuario de cafetería añadido por Oscar— usan email/contraseña de Supabase Auth. El perfil de cafetería recibe `role = 'pos'` y queda vinculado a su escuela. Para código + PIN estudiantil, una futura función server-only debe aplicar rate limiting, comparar Argon2id/bcrypt y crear una sesión limitada. Nunca se guarda un PIN plano. Recuperación usa el email de Supabase y devuelve una respuesta no enumerable.

## Integridad financiera y mutaciones

Todo importe es entero en moneda menor. `wallet_balances` deriva el saldo de entradas completadas. Clientes no pueden actualizar un saldo ni editar/borrar ledger. Reservas de preorden son débitos; cancelación crea un crédito relacionado, nunca borra el débito. RPCs validan autorización, disponibilidad, alergias, bloqueos, límites y saldo dentro de una transacción.

Cada mutación financiera requiere `idempotency_key`, actor y timestamp. Una evolución de producción añadirá doble entrada, tabla append-only de auditoría, conciliación diaria con procesador, referencias externas, trabajos de discrepancia y estados de refund. Los webhooks verificarán firma y reutilizarán claves idempotentes.

## Demo y producción

El demo se activa solo con `NEXT_PUBLIC_PIKAS_DEMO_MODE=true` y persiste datos ficticios en el navegador para evaluar flujos compartidos. La aplicación no debe caer silenciosamente a demo en producción. Sin URL/anon key, el cliente server Supabase falla con un mensaje de configuración.

## Privacidad estudiantil

Recolectar el mínimo necesario, limitar lecturas por escuela/familia, evitar IDs crudos en QR, registrar accesos administrativos y definir retención. Avatares deben vivir en buckets privados con URLs firmadas. Antes de declaraciones regulatorias se requiere revisión legal y de seguridad independiente.

## Próximas capas

POS consumirá un token QR opaco y solo recibirá nombre preferido, foto, elegibilidad y resultado de compra. Administración usará permisos por escuela y auditoría. Pagos futuros se aislarán tras un proveedor tokenizado; PIKAS nunca almacenará números de tarjeta.
