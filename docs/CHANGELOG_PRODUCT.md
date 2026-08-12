# Registro de cambios del producto

## 2026-08-12 — PIKAS 0.5.2: operación compartida

- Catálogo compartido con ingredientes, alérgenos, etiquetas, imágenes ficticias y fallback accesible.
- Bloqueos alimentarios enlazados a IDs estables y validados junto con alergias y disponibilidad en POS.
- POS tablet-first con código/NFC, efectivo, carrito persistente y separación explícita de efectivo y billetera.
- Menú visible en cafetería, POS, estudiante y familia; la disponibilidad afecta la orden inmediatamente.
- Modelo Supabase ampliado para restricciones, forma de pago y auditoría organizacional con RLS.
- Sin despliegue, cambios de Producción ni migraciones aplicadas a bases externas.

## 2026-08-12 — PIKAS 0.5.1: Auth y datos compartidos

- Supabase Auth para las cuentas ficticias escolar, cafetería y POS, con sesión por cookies, logout y guards de servidor.
- Roles consistentes, organizaciones, ubicaciones, membresías y una asociación activa ficticia.
- Menú compartido en Supabase con importes enteros y RLS por alcance.
- Seed Auth exclusivamente de desarrollo; la contraseña se recibe por entorno y no se registra.
- El demo público permanece ficticio. No hubo despliegue, cambio de variables de Producción ni migración externa.

## 2026-08-11 — PIKAS 0.5.0: base administrativa

- Se añadieron espacios separados para Administración escolar y Administración de cafetería, con acceso demo exacto y guards por rol.
- Se centralizó la matriz de permisos para padrón, administradores escolares, conexiones, menú, personal POS y checkout.
- Escuela puede buscar, filtrar, archivar/reactivar, regenerar códigos, iniciar restablecimientos e inspeccionar una importación CSV ficticia sin exponer contraseñas.
- Escuela administra conexiones Cafetería–Escuela y controla su alcance; los estados suspendido/revocado afectan lookup y checkout POS.
- Cafetería administra catálogo, precios, disponibilidad, personal de caja y vistas transaccionales de alcance mínimo.
- Invitaciones, cambios de cuenta, estudiantes, menú y conexiones producen actividad administrativa demo.
- El mismo estado persistente propaga cambios del menú a Estudiante/POS y mantiene las compras visibles en Familia/Estudiante/POS.
- Se añadieron pruebas unitarias de política y recorridos Playwright de fronteras administrativas, privacidad/CSV y propagación del menú.
- Se actualizó documentación, credenciales y material visual a 0.5.0.

Esta fase no desplegó, configuró Supabase ni modificó datos externos. Administración sigue usando el adaptador demo local; el binding productivo, RLS organizacional e invitaciones Auth quedan pendientes.

## 2026-08-11 — PIKAS 0.4.0: identidad visual

Cambios locales sin commit ni despliegue, sobre la interfaz 0.3.0.

### Implementado

- Se integraron los activos de marca aprobados y metadatos/iconos de aplicación.
- Se añadieron tokens semánticos de color, foco y superficie; Familia, Estudiante y POS conservan sus acentos de rol.
- Landing, login y shell usan logo en proporciones apropiadas sin alterar flujos demo.
- Se documentó el sistema en `docs/BRAND_GUIDE.md`.

### Limitaciones sin cambios

- Sin SVG, imagen Open Graph específica ni activo apto para impresión grande.
- Supabase y persistencia real permanecen fuera de esta fase visual.

## 2026-08-11 — Supabase de desarrollo: esquema y cuentas ficticias

### Implementado

- Se aplicaron las migraciones `202608110001` a `202608110004` al proyecto Supabase de desarrollo enlazado.
- Se cargó únicamente `seed.sql` ficticio y se provisionaron perfiles de Familia, Sofi Estudiante y Cafetería.
- Se corrigió la calificación de la función `public.current_role()` para evitar el conflicto con el keyword de PostgreSQL.
- Se añadió un grant mínimo a `service_role` para provisionamiento server-only de perfiles, estudiantes y membresías familiares.

### Pendiente

- Conectar y probar contra Supabase real las pantallas de Familia y Estudiante, recuperación, Storage, RLS de usuario y recorridos Playwright live.

## 2026-08-11 — PIKAS 0.3.0: shell responsivo y densidad visual

Cambios locales sin commit ni despliegue, basados en `1c93c15` sobre `feature/unified-pikas-app`.

### Implementado

- Se corrigió el shell Estudiante para usar sidebar y contenido en columnas desde tablet, con sidebar sticky de altura de viewport y contenido `min-w-0`.
- Se centralizó la configuración tipada de navegación con coincidencia exacta/prefijo y `aria-current` único.
- **Mis compras** recibió destino propio; `/estudiante/transacciones` ya no activa Perfil.
- La barra móvil conserva cinco destinos, incorpora safe-area padding y deja **Mi plan** como acción de dashboard/sidebar.
- Se añadió logout móvil accesible y se redujo densidad en landing, tarjetas, balance, menú y controles sin alterar reglas de dominio.
- Se amplió Playwright para proteger columnas desktop/tablet, navegación activa, overflow, obstrucción móvil y navegación Familia.
- Se renovaron capturas y documentación para la versión y los entornos verificados.

### Limitaciones sin cambios

- Demo auth, datos y persistencia siguen siendo ficticios y locales al navegador.
- Supabase Auth/RLS/Storage/RPC continúa sin conexión ni prueba live.
- Administración, QR verificable, refunds/reversos, pagos y sincronización entre dispositivos siguen pendientes.

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
