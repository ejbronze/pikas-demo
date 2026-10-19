# Administración y permisos

## Ciclo de vida del cliente (Clientes, local)

- Estados del cliente: **Activo**, **Suspendido** y **Cerrado** (`accounts.status`). Solo la Plataforma (`platform:tenant:lifecycle:manage`, rol `platform_admin`) puede suspender, reactivar, cerrar o reabrir; siempre con motivo, estado esperado y auditoría inmutable. Ningún rol del cliente tiene esta autoridad.
- Mientras el cliente no está Activo, sus membresías se conservan pero no conceden acceso (bloqueo central en la base de datos, también para sesiones abiertas y rutas guardadas). No es la suspensión individual de identidad de Phase 6A y no la modifica.
- Agregar sede (Plataforma, `platform:tenant:provision`): crea una ubicación y su cafetería en una escuela existente de un cliente Activo, mediante `platform_add_school_location`. No crea cajas, administradores, personal ni productos.
- Suspender o cerrar no elimina ni anonimiza datos, no cambia saldos ni transacciones y no liquida nada. Reabrir devuelve el mismo cliente. Detalle: `docs/CUSTOMER_LIFECYCLE.md`.

## Identidad y credenciales (Phase 6A, local)

- Usuario PIKAS opcional, único y sin distinguir mayúsculas; inicio de sesión con correo o usuario sobre la MISMA identidad Auth y la misma persona. Cambiar usuario, correo o contraseña nunca crea otra persona ni concede membresías.
- Soporte de Plataforma con `platform:identity:support` (rol `platform_admin`): no concede roles de cliente ni lee datos del cliente; no hay suplantación; `tenant_identity_required` no cambia; identidades de Plataforma no son objetivo.
- Alcance de cliente: solo si cada membresía activa o pendiente de la persona la administra quien actúa (Cuenta de la misma cuenta; Escuela de esa escuela; Cafetería solo para roles POS de esa cafetería). Corrección de correo y suspensión son solo de Plataforma.
- Auditoría inmutable sin contraseñas, tokens ni enlaces. Detalle: `docs/PHASE_6A_IDENTITY_CREDENTIALS.md`.

## Política Beta de PIKAS Cash (vigente, 2026-10-17)

Definida por el propietario durante la aceptación productiva de Phase 5B (migración `202610170001_beta_wallet_authority.sql`). Phase 4D.2 había excluido intencionalmente toda autoridad financiera de `account_admin`; esta política la sustituye solo en lo indicado.

| Rol | PIKAS Cash |
| --- | --- |
| Administrador de cuenta | Leer y recargar (`manual_verified`) en las escuelas de su cuenta. Sin `manage` ni `adjust` heredado; desde 5C.3 (local) ajuste administrativo excepcional en su cuenta. |
| Administrador escolar | Leer, recargar, `manage` y `adjust` en su escuela (sin cambios; varias por escuela). |
| Administrador de cafetería | Solo saldo/estado de clientes que la escuela comparte con su cafetería. Sin historial, recargas, `manage` ni `adjust`; se retira la antigua capacidad `cafeteria:wallets:replenish`. |
| Plataforma | Sin acceso permanente. Diferido: acceso de soporte temporal de solo lectura autorizado por el cliente (código/sesión de corta duración, revocable y auditado). |
| POS | Solo uso operativo del saldo en ventas; sin autoridad administrativa. |

Revertir una recarga verificada (Phase 5C.2, local): solo administración de cuenta y escolar, por el monto exacto original, una vez; puede dejar el saldo negativo. Ajuste administrativo (Phase 5C.3, local): administración de cuenta (su cuenta), escolar (su escuela) y de cafetería (solo estudiantes conectados a su cafetería); supervisor POS, cajero, Plataforma y POV sandbox sin autoridad; explicación obligatoria y sin aprobación obligatoria en Beta. Recargar no es ajustar. PIKAS Cash no es efectivo físico de caja. La primera recarga verificada abre el monedero si aún no existe; la creación independiente sigue requiriendo `manage`. Reembolsos/reversiones: Phase 5C. POV sandbox: sin operaciones financieras.

## Reembolsos de compras (Phase 5C.1, local)

| Rol | Reembolsos |
| --- | --- |
| Administrador de cafetería | Autoriza reembolsos en el POS de su cafetería; configura límites diarios de cajeros. No opera cajas. |
| Supervisor POS | Reembolsa directamente desde su caja abierta; autoriza reembolsos de cajeros; configura límites. |
| Cajero | Sin autorización solo dentro de 5 minutos desde la venta y dentro de sus límites diarios (cantidad y monto); si no, requiere autorización en el mismo dispositivo. |
| Plataforma / POV sandbox | Sin autoridad de reembolso. |

Detalle en [Phase 5C.1](PHASE_5C1_REFUNDS.md).

## Referencia histórica — milestone 0.6.1

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
