# Administración y permisos — milestone 0.6.1

La autorización productiva corresponde a Auth/RLS y funciones de servidor. El demo comprueba roles y políticas, pero localStorage y las credenciales públicas no son seguridad productiva.

| Capacidad | Escuela Admin | Cafetería Admin | POS | Familia | Estudiante |
| --- | --- | --- | --- | --- | --- |
| Padrón, identidad, códigos | Su escuela | No | No | Perfiles vinculados | Su preferencia |
| Menú/personal de caja | No | Su cafetería | No | No | No |
| Conexiones | Aprueba/suspende | Solicita | Consulta alcance mínimo | No | No |
| Políticas POS/refund | No | Sí | No | No | No |
| Buscar/verificar cliente | No | No padrón | Solo elegibles | Sus vinculados | Solo propio |
| Comprar POS/recargar en caja | No | No en ruta POS | Sí, con validación | Recarga familiar | Preorden propia |
| Historial operativo compartido | No | Su organización | Su ubicación | Sus estudiantes | Propio |
| Refund | No | Procesa/aprueba | Solo política habilitada | No | No |
| Límite diario ON/OFF | No en flujo parental | No | No | Individual por estudiante | Solo lectura |
| Preferencia de tema | Personal | Personal | Personal | No cambia política | No cambia política |

## Visibilidad y acción son independientes

Configuración POS está en `/admin/cafeteria/configuracion`. Ventas, cantidad, inicio del turno y registro en la barra pueden ocultarse al cajero; datos siguen registrados y visibles en reportes autorizados. Identidad y estado del sistema siempre permanecen. Historial compartido no concede autoridad para reembolsar.

Refund de caja comienza OFF. Parciales OFF, motivo ON y aprobación administrativa ON. Con aprobación obligatoria, el cajero puede consultar la operación y un administrador entra a su propia sesión para procesar ese ID. No hay PIN maestro ni un campo libre para fingir aprobador. Se preservan identidad del original, iniciador/ejecutor del refund y aprobador cuando corresponde.

Solicitudes de padres siguen OFF: modelo de estados preparado sin formulario o escritura financiera. Aprobación de una solicitud futura nunca equivale por sí sola a devolución de fondos.

## Fronteras existentes

Escuela es propietaria de identidad/padrón. Cafetería es propietaria de productos/personal/ubicaciones. Conexiones `pending`, `active`, `suspended`, `rejected`, `revoked` habilitan únicamente scopes explícitos: elegibilidad, saldo, restricciones, límites y transacciones. Suspender/revocar bloquea lookup y compras identificadas. No se comparten contactos familiares ni credenciales.

Búsqueda POS requiere dos caracteres y limita resultados al ámbito elegible; no presenta un padrón completo. Los candidatos muestran nombre, grado y código enmascarado. Datos reales nunca deben introducirse en demo.

El último administrador escolar activo no puede suspenderse. Usuarios históricos se desactivan en vez de borrarse. Restablecimientos/invitaciones no muestran contraseñas anteriores. El CSV escolar sigue siendo vista previa y aplicación de una fila ficticia conocida.

## Enforcement y producción

Desde 0.6.1 todos los escritores demo, incluidos los administrativos legacy, obtienen el rol de cookies HttpOnly mediante `/api/demo/session`, comprueban cuenta/alcance y serializan la mutación. Refund exige organización/ubicación, autorización, monto elegible, política y razón. La UI no es la única comprobación, pero todo saldo demo sigue siendo manipulable por el propietario del navegador.

La migración 0.6 prepara lectura financiera por pertenencia familiar/estudiantil o membresía operativa de organización/ubicación. No habilita escrituras de cliente. RPCs, RLS reales, invitaciones, PIN hasheado/rate limiting, auditoría durable y concurrencia multiusuario requieren implementación y pruebas en desarrollo antes de producción. Ver [Modelo financiero](POS_FINANCIAL_MODEL.md).

## Corrección 0.6.1

La sesión se confirma dentro de Web Locks antes de leer el estado vigente y autorizar. Se comprueban rol, cuenta activa, membresía, organización, ubicación y permiso; no se acepta un rol enviado por la UI. Un admin abierto con cookie cambiada a POS falla sin escribir y muestra sesión cambiada. El menú remoto conserva su autorización de servidor existente.

| Scope | Proyección de cliente POS |
| --- | --- |
| eligibility | ID estable, nombre preferido, grado, código, estado activo |
| balance | Saldo y estado de billetera |
| limits | Máximos diario/compra, activación y gasto diario |
| restrictions | Alergias y productos bloqueados |
| transactions | Uso de historia personal en recomendaciones; no concede saldo o límites |

Eligibility es necesario para obtener cualquier cliente. Checkout identificado exige eligibility + limits + restrictions + transactions; pagar con billetera exige además balance. La caja recibe una proyección, no el estudiante completo ni el grafo familiar. La historia operativa propia por ubicación es independiente del acceso al padrón. localStorage conserva el grafo demo compartido: estos controles del adaptador no aíslan datos de quien controla el navegador; no introducir información real.

Creación familiar/escolar y regeneración validan códigos normalizados únicos bajo bloqueo, incluyendo perfiles archivados. Búsqueda de código ambiguo no devuelve cliente. Selección por nombre usa ID estable.
