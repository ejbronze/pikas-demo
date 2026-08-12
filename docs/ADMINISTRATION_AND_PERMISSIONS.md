# Administración y permisos de PIKAS 0.5.0

Última revisión: **11 de agosto de 2026**. Esta guía describe la base administrativa local en modo demo; no afirma integración productiva con Supabase.

## Matriz de permisos

| Capacidad | Admin escolar | Admin de cafetería | Personal POS | Futuro docente |
| --- | ---: | ---: | ---: | ---: |
| Administrar configuración escolar | Sí | No | No | No |
| Administrar padrón estudiantil | Sí | No | No | Limitado/No |
| Restablecer acceso estudiantil | Sí | No | No | Solicitud futura |
| Administrar admins escolares | Sí | No | No | No |
| Aprobar conexión con cafetería | Sí | Solicitud | No | No |
| Administrar menú y precios | No | Sí | No | No |
| Administrar personal POS | No | Sí | No | No |
| Verificar estudiantes elegibles | No | Limitado | Limitado | No |
| Completar transacciones POS | Opcional | Opcional | Sí | No |
| Ver el padrón completo | Sí | No | No | Solo asignados, futuro |
| Consultar actividad | Ámbito escolar | Ámbito cafetería | Actividad propia | No |

La política común está en `apps/web/lib/admin-policy.ts`. Las páginas verifican el espacio de trabajo en servidor y cada mutación demo vuelve a comprobar el permiso. Producción deberá repetir estas garantías en RLS, Server Actions y RPCs; ocultar un botón o redirigir una ruta no basta.

Una membresía asigna usuario, rol, organización y, cuando corresponde, ubicación. Los fixtures actuales asignan una sola organización por cuenta, por lo que no aparece un selector vacío o artificial. Si una identidad futura tiene varias membresías, la selección de workspace será obligatoria antes de entrar. `teacher` queda reservado como trabajo futuro y `platform_admin` como función interna futura; ninguno está implementado en 0.5.0.

## Propiedad de datos

- La Escuela es autoridad sobre identidad, estado, grado, código estudiantil, padrón y administradores escolares.
- La Cafetería es autoridad sobre catálogo, precios, disponibilidad, ubicaciones de caja y cuentas POS.
- Una conexión no transfiere propiedad. Solo habilita operaciones explícitas para una escuela y cafetería concretas.
- El POS recibe el mínimo necesario para decidir una compra: elegibilidad, saldo, restricciones, límites y registro transaccional, según el alcance activo.
- Cafetería no recibe contactos familiares, credenciales, navegación del padrón ni edición de perfiles.

## Ciclo de una conexión

`pending` → `active`, `rejected`, `suspended` o `revoked`.

- Cafetería puede emitir una solicitud pendiente.
- Escuela puede aprobar/reactivar, rechazar, suspender o revocar.
- Solo `active` habilita una operación incluida en `scope`.
- Suspender o revocar la conexión activa bloquea lookup y checkout en el demo interconectado.

El fixture incluye una conexión activa, una pendiente y una suspendida para revisar cada estado.

## Privacidad y seguridad demostradas

- Códigos estudiantiles enmascarados en listas; regenerarlos invalida el valor anterior en el estado compartido.
- Los flujos de restablecimiento e invitación no muestran contraseñas anteriores ni generan secretos visibles.
- No se puede suspender el último administrador escolar activo.
- Las cuentas suspendidas/inactivas permanecen visibles para auditoría y no se documentan como credenciales válidas.
- Acciones importantes crean eventos de actividad demo.
- Las rutas de Escuela, Cafetería y POS se mantienen separadas.

Cada evento demo contiene actor, acción, detalle y fecha. Sirve para mostrar trazabilidad, pero no es un registro de seguridad durable o inmutable.

## Datos ficticios incluidos

- Instituto Nueva Generación y Cafetería PIKAS Central.
- Dos administradores escolares, dos administradores de cafetería y tres registros POS con estados distintos.
- Sofi (`PK-10982`) y Mateo (`PK-11804`).
- Catálogo, restricciones, conexiones y actividad sin información real.

Las únicas credenciales que deben usarse están en [Cuentas de demostración](../README.md#cuentas-de-demostración).

## Persistencia y reinicio

Las acciones actualizan `pikas:unified-demo:v2` en el navegador. Los cambios sobreviven una recarga y se comparten con Familia, Estudiante y POS en el mismo origen/perfil. **Restablecer demo** o eliminar esa clave restaura los fixtures. No hay sincronización entre dispositivos ni escritura a Supabase.

## Pendiente para producción

- Esquema y RLS para organizaciones, membresías, invitaciones, conexiones, alcances y auditoría append-only.
- Server Actions/RPCs validados e idempotentes para cada mutación.
- Supabase Auth para invitaciones, sesiones, recuperación y estados de cuenta.
- Pruebas por rol/organización, concurrencia, rate limiting, correo y Storage privado.
- Paginación respaldada por servidor, carga CSV real con trabajos reintentables y resumen durable de errores.
- Revisión independiente de seguridad, privacidad y accesibilidad.
- Cuentas docentes limitadas y administración de plataforma interna, después de definir alcance y revisión de privacidad.
# Actualización 0.5.1

Los guards verifican usuario, rol y membresía activa. Escuela y cafetería no pueden abrir el espacio de la otra; POS solo llega a `/pos`. RLS evita que cafetería navegue perfiles o padrón y limita cambios del menú a su organización. Rol y organización no son mutables desde clientes.

## Actualización 0.5.2

Cafetería lee solo asociaciones, catálogo, ventas y auditoría de su organización; no recibe una política para recorrer el padrón. POS obtiene verificación mínima tras asociación activa. Escuela conserva estado estudiantil y restricciones, y solo ve catálogos vinculados a su escuela.
