# Registro de cambios del producto

## 2026-08-11 — Guía visual de demostración

Documentación preparada en `feature/unified-pikas-app` sobre el commit base `9448dda`; capturas obtenidas desde `http://localhost:3000` con demo mode activo. Sin despliegue ni cambios funcionales.

- Se creó `docs/DEMO_GUIDE.md` con un recorrido reproducible de 8–12 minutos para Familia, Estudiante y Cafetería/POS.
- Se capturaron pantallas originales de la aplicación local para acceso por rol, controles, navegación móvil, lookup inválido/válido, restricciones, carrito, confirmación, recibo, persistencia y visibilidad cruzada.
- Se añadió al README una entrada destacada con audiencia, secuencia, entorno verificado y accesos demo.
- Se documentaron el reinicio de `localStorage`, cambio seguro de roles, troubleshooting, checklist y diferencias entre local, preview protegido y producción con POS estático.
- No se modificó el catálogo de funcionalidades: la verificación confirmó los estados y límites existentes.

## 2026-08-11 — Primer milestone funcional de Cafetería/POS

Checkpoint de `feature/unified-pikas-app`; no desplegado a producción.

- Se sustituyó la respuesta fija de Sofi por lookup exacto de estudiantes ficticios activos y rechazo no enumerativo de códigos inválidos.
- Se añadió identidad mínima, saldo, disponible diario, límite por compra, alergias y bloqueos.
- Se creó catálogo compartido, búsqueda/categorías, disponibilidad, carrito, cantidades, eliminación, limpieza, total y confirmación explícita.
- Se implementaron validaciones en centavos para precios vigentes, cantidades, wallet, límites, alergias, bloqueos e indisponibilidad.
- El checkout demo crea compra y débito compartidos, actualiza saldo/gasto diario, persiste al refrescar y aparece en POS, Estudiante y Familia.
- Se incorporaron recibo, historial POS, búsqueda y detalle; refunds/reversos permanecen explícitamente no disponibles.
- Se añadió idempotencia demo y la migración productiva `202608110003_pos_purchases.sql` con tablas, RLS, inmutabilidad y RPC atómico.
- Se añadieron interfaces Supabase server-only y seed ficticio ampliado. La UI productiva no cae a datos demo cuando demo mode está apagado.
- Se ampliaron pruebas unitarias y Playwright para autorización, lookup inválido/válido, restricciones, checkout y visibilidad compartida.
- Se actualizaron `POS-001`–`POS-021` sin crear identificadores duplicados.

Supabase sigue sin configurar: la migración, Auth/RLS, el RPC y la integración UI productiva no se probaron contra una base viva.

## 2026-08-11 — Línea base de despliegue, demo y POS

Verificación realizada contra el commit `41e89d5`. Los cambios de esta entrada son exclusivamente de documentación; no implementan funcionalidades POS.

- Se verificó de forma independiente el alias público [https://pikas-demo.vercel.app](https://pikas-demo.vercel.app), apuntando a un despliegue de producción Vercel con estado `Ready`.
- Se probaron en navegador los accesos expuestos de Familia, Estudiante y Cafetería y sus destinos `/familias`, `/estudiante` y `/pos`.
- Se documentaron las credenciales demo publicadas, su alcance local/desplegado y el hecho de que demo mode no compara credenciales reales.
- Se revisaron los códigos activos `PK-10982` y `PK-11804`, además de separar los fixtures heredados que no funcionan como credenciales de la aplicación unificada.
- Se comprobó que el POS devuelve la misma respuesta estática para `PK-10982` y para un código inventado; por ello se reclasificó como demo visual, no como validación estudiantil.
- Se añadió la línea base del producto, el flujo POS recomendado para la siguiente fase y el catálogo `POS-001` a `POS-021` con estados verificables.
- Se aclararon los límites pendientes: Auth y persistencia Supabase en vivo, QR, búsqueda, carrito, reglas, checkout, ledger, saldo, recibos, reversos, idempotencia, recuperación e historial POS.

Fecha de verificación del despliegue y recorridos: **11 de agosto de 2026**. El SHA identifica la versión desplegada examinada; las ediciones documentales permanecen sin commit por solicitud expresa.
