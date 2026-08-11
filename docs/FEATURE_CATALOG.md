# Catálogo de funcionalidades PIKAS

Última revisión: **11 de agosto de 2026**, checkpoint de `feature/unified-pikas-app`. “Functional with limitations” indica flujo demo verificado y/o producción preparada pero aún no validada contra Supabase.

## Significado de estados

- **Functional:** recorrido completo verificado en el modo indicado.
- **Functional with limitations:** funciona con límites de modo, integración o verificación descritos.
- **Demo-only:** simulación sin equivalente productivo preparado.
- **Visual only:** presentación sin comportamiento de dominio.
- **Planned only:** no existe una implementación utilizable.

## Cafetería/POS

| ID | Funcionalidad | Estado | Evidencia y límites |
| --- | --- | --- | --- |
| POS-001 | Acceso y autorización del operador | Functional with limitations | Proxy y página exigen rol `pos` en servidor; logout funciona. Auth demo no compara credenciales; Auth Supabase no fue probado. |
| POS-002 | Verificación por código estudiantil | Functional with limitations | Local demo exige coincidencia exacta, formato y estado activo. Lookup Supabase server-only preparado, no enlazado/probado en vivo. |
| POS-003 | Lectura QR | Planned only | Sin lector, cámara ni token verificable. |
| POS-004 | Búsqueda de estudiante | Functional with limitations | Lookup exacto por código funciona; búsqueda por nombre no está incluida. |
| POS-005 | Confirmación de identidad | Functional with limitations | Muestra nombre preferido, iniciales, escuela, grado y estado tras validación; foto real pendiente. |
| POS-006 | Saldo, límite diario y restante | Functional with limitations | Valores y actualización funcionan en demo compartido; RPC productivo deriva saldo del ledger pero no fue ejecutado. |
| POS-007 | Advertencias de alergias | Functional with limitations | Mensaje textual y bloqueo verificados en demo; RPC productivo implementado sin verificación live. |
| POS-008 | Aplicación de productos bloqueados | Functional with limitations | Producto bloqueado no se puede añadir y checkout lo revalida; RPC equivalente preparado. |
| POS-009 | Catálogo de cafetería | Functional with limitations | Catálogo compartido, búsqueda, categorías, disponibilidad y precios funcionan en demo; lectura Supabase pendiente de binding. |
| POS-010 | Carrito, cantidades y total | Functional | Agregar, incrementar, reducir, quitar, vaciar y total en centavos verificados en demo. |
| POS-011 | Validación de compra en servidor | Functional with limitations | RPC valida autoridad y reglas en producción, pero no se aplicó. El demo aislado usa las mismas reglas localmente. |
| POS-012 | Checkout de cafetería | Functional with limitations | Checkout demo completo; RPC productivo atómico implementado, no probado con Supabase. |
| POS-013 | Creación de asiento en ledger | Functional with limitations | Demo crea movimiento compartido; migración crea débito inmutable vinculado a compra. Sin prueba DB live. |
| POS-014 | Actualización de saldo | Functional with limitations | Balance/gasto diario se actualizan en las tres vistas demo; producción deriva `wallet_balances`. |
| POS-015 | Confirmación o recibo | Functional | Recibo con estudiante, total e identificador y detalle histórico verificados en demo. |
| POS-016 | Cancelación de carrito | Functional | Vaciar/cambiar estudiante descarta el carrito sin crear registros. Cancelar una compra completada no está permitido. |
| POS-017 | Reembolso o reverso | Planned only | Se informa como función de gerencia no disponible; no existe botón ficticio. |
| POS-018 | Protección contra duplicados | Functional with limitations | Regla demo y unicidad/RPC idempotente implementados; concurrencia PostgreSQL no probada en vivo. |
| POS-019 | Recuperación ante fallos | Functional with limitations | Las validaciones fallidas no mutan demo y PostgreSQL revierte el RPC atómico. Reanudación avanzada pendiente. |
| POS-020 | Historial de transacciones POS | Functional with limitations | Lista, búsqueda, detalle y vacío funcionan en demo; consulta Supabase preparada sin binding. |
| POS-021 | Cierre de sesión | Functional | El endpoint de logout y el control accesible se verifican. |

El despliegue público todavía ejecuta la versión anterior y no constituye evidencia de estos cambios hasta una nueva publicación.
