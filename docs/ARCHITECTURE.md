# Arquitectura

El repositorio usa npm workspaces. Cada interfaz es una aplicación Next.js App Router independiente y comparte contratos y componentes sin acoplar sus rutas.

## Flujo de datos

Las páginas de servidor llaman exclusivamente a funciones asíncronas de `@pikas/data-access`. El adaptador actual encapsula datos locales y devuelve copias para impedir mutaciones accidentales. Ningún componente importa objetos mock directamente. Más adelante, el contenido de estas funciones puede sustituirse por un adaptador Supabase conservando sus contratos.

Los tipos solicitados se preservaron y se agregaron `MenuItem` y `Preorder` para modelar el menú y las reservas sin datos incrustados en la UI.

## Integridad financiera futura

El saldo mostrado no debe convertirse en la fuente contable mutable. Producción requiere un ledger de doble entrada o equivalente, operaciones atómicas en backend, idempotencia, autorización por rol, auditoría y saldos derivados/verificados a partir del ledger. Los clientes nunca deben confirmar por sí solos una transferencia o un cobro.

## Evolución sugerida

Agregar autenticación y autorización, una implementación Supabase del adaptador, validación de esquemas en los límites de entrada, estados de carga por segmento, pruebas de integración y luego POS/administración sobre los mismos contratos versionados.
