# Administración y permisos

## Límite Backoffice vs administración escolar (decisión del propietario, local)

| Ámbito | Quién | Qué |
| --- | --- | --- |
| Alta del colegio | Plataforma, `platform:tenant:provision` | **Agregar colegio**: crea internamente el cliente, el colegio (nombre, RNC, dirección, República Dominicana, provincia canónica), su sede y cafetería principales; PIKAS genera los códigos. |
| Administrador inicial del colegio | Plataforma, `platform:customer_admin:provision` + `platform:identity:link` | Flujo de identidad Phase 6A existente (intención → enlace de activación → contraseña → completar). Una identidad Auth por persona; usuario y correo reales. Hoy es el administrador de la cuenta (`account_admin`), que para un cliente de un solo colegio administra ese colegio. |
| Aprovisionamiento de accesos | Plataforma, `platform:customer:access:provision` (solo `platform_admin`) | Preparar **Personal de caja** (`pos_cashier`: nombre, correo, usuario, cafetería), generar su enlace de activación y completar su acceso; dar **Administrador de cafetería** a una persona existente del cliente (misma persona e inicio de sesión, una o varias cafeterías); corregir el nombre visible de una persona del cliente. Solo clientes activos (corrección de nombre también suspendidos), nunca sandbox ni durante una sesión Demo vigente. Usa el motor de personal existente mediante el contexto de soporte revalidado en modo `provision`, que solo habilita `cafeteria:pos:memberships:manage`: Plataforma no obtiene membresía del cliente, ventas, dinero, roster, estudiantes ni padres, y cada acción queda auditada con el operador real. |
| Usuarios y accesos | Plataforma, `platform:customer:access:read` (solo `platform_admin`) | Solo consulta: quién tiene acceso al cliente (membresías de cuenta, colegio y cafetería), sus roles, cajas asignadas, estado de inicio de sesión y accesos pendientes. Clientes, nunca sandbox; no durante una sesión Demo vigente. No edita roles, membresías ni identidades; el soporte de credenciales sigue en Identidades. |
| Inicio (red) y Puesta en marcha | Plataforma, `platform:customer:operations:read` | Solo consulta: estado de puesta en marcha de cada cliente real (perfil, estructura, administrador, personal POS, cajas, productos, primera venta), qué requiere atención y actividad reciente. Sandbox aparte y nunca contado. Sin montos, saldos ni datos de inicio de sesión; enlaza a los controles existentes. |
| Perfil del cliente | Plataforma, `platform:customer:profile:manage` | Corregir nombre, RNC, dirección y provincia del colegio (País fijo) y renombrar sedes y cafeterías. Clientes activos o suspendidos; cerrados solo consulta. Un cliente con un solo colegio se renombra junto con él. Los códigos no cambian. |
| Configuración de soporte | Plataforma, `platform:customer:operations:manage` | Solo cafetería: catálogo, CSV de productos, menús, turnos, configuración, cajas y asignación de personal POS ya autorizado. |
| Comunidad escolar | Administración escolar | Estudiantes (alta, edición, importación, matrícula, traslado, retiro), padres y profesores/personal. **No** es una superficie de Backoffice. |
| Autoridad financiera | Roles del cliente según sus políticas | Nunca Plataforma. |

## Gestión de clientes desde Backoffice (local)

- Propósito: que el personal de PIKAS apoye a sus clientes en la configuración y operación **sin** convertirse en administradores del cliente ni suplantar a nadie. Ruta: `/platform/clientes/{cliente}/gestion`.
- Capacidad `platform:customer:operations:read` (rol `platform_admin`): consulta explícita de datos operativos de las cafeterías de un cliente (resumen, catálogo, cajas, personal, transacciones y reportes); sigue disponible para clientes suspendidos o cerrados. No otorga roles del cliente, membresías, POV de sandbox ni acceso entre clientes.
- Capacidad `platform:customer:operations:manage` (rol `platform_admin`): solo para clientes activos y solo mediante una lista no financiera. Permite catálogo (productos, precio, disponibilidad, categorías, menús, turnos, configuración e importación CSV), configuración de cajas y asignación de personal POS que ya tenga una membresía activa y una identidad confirmada. No existe ruta ni RPC de Plataforma para escuelas, padrón, importación de estudiantes ni relaciones escuela–cafetería; esas órdenes siguen siendo exclusivas de la administración escolar.
- La persona de PIKAS sigue siendo el actor real; el cliente es contexto validado por el servidor. Cada mutación registra `actor_scope_kind=platform` y `actor_role=platform_support`, con la persona y el usuario Auth reales. No se crea una membresía del cliente ni se suplanta a un empleado.
- Configurar un cliente no equivale a aprovisionar acceso. Esta capacidad no crea ni cambia administradores, personal POS, membresías, credenciales, Parent Access o autenticación estudiantil, ni permite **Agregar colegio**. Asignar una caja solo referencia personal POS ya autorizado; si no lo hay, se rechaza.
- Configurar un cliente tampoco concede autoridad financiera. Venta, checkout, reembolso, edición o eliminación de transacciones, recarga/ajuste/reversión de PIKAS Cash, cierre excepcional, conciliación, liquidación, autoridad de reportes financieros, ciclo de vida e identidad quedan fuera de la lista y se rechazan en el servidor y la base de datos. Transacciones y reportes permanecen de solo lectura.
- Implementación: `platform_support_cafeteria_command` revalida en cada operación la capacidad, el cliente explícito, la pertenencia de la cafetería, el tipo `customer` y el estado activo; después reutiliza el motor de cafetería existente. Las RPC normales del cliente conservan su autoridad y comportamiento.
- Alta del colegio: `platform_onboard_school` valida nombre, RNC (9 u 11 dígitos), dirección, país `DO` y provincia ISO 3166-2:DO, y reutiliza en la misma transacción el aprovisionamiento existente; reintentos con la misma clave y datos devuelven el mismo resultado. La preparación del administrador es una segunda orden independiente con su propia clave; el asistente informa con honestidad si quedó pendiente.

## Modo Demo y operación real (UX 11, local)

El Demo y la operación real de la Plataforma son modos excluyentes. El estado lo decide siempre el
servidor con el POV sandbox **vigente** del operador (`platform_get_active_sandbox_pov`: sesión
activa, no vencida, persona válida y ligada a la misma identidad); un POV vencido o salido no cuenta,
así que el historial del Demo nunca bloquea la operación real. No hay interruptor global de Demo:
se entra de forma deliberada desde **Demo** (`/platform/demostracion`) eligiendo la experiencia.

Con un Demo vigente:

- La Plataforma muestra la barra persistente **● Demo activo**, con la experiencia (Administrador
  escolar, Administrador de cafetería, Cajero), la persona ficticia y la cafetería; la navegación
  real (Clientes, Equipo, Identidades, Finanzas) deja de ofrecerse y solo queda **Inicio Demo**.
- La misma barra aparece en Escuela Demo, Cafetería Demo y Caja/POS Demo, con **Cambiar
  experiencia** y **Salir del Demo**. Salir termina el POV con la operación existente y lleva a
  `/platform` con la navegación normal.
- Toda ruta real de la Plataforma (clientes, operación de cafeterías, equipo, identidades,
  finanzas) se intercepta en el servidor (`requirePlatform`) antes de leer datos y muestra
  «Estás en modo Demo», con **Salir del Demo y continuar** (termina el POV y sigue a la ruta pedida,
  validada como ruta interna de la Plataforma) o **Volver al Demo**. Las URL escritas a mano, los
  marcadores y las pestañas antiguas reciben lo mismo al recargar; nunca un «cliente/cafetería no
  encontrado» engañoso. Un «no encontrado» real (cliente inválido o cafetería de otro cliente) sigue
  igual que antes.
- Las mutaciones reales de la Plataforma (equipo e invitaciones, identidades, administradores y
  accesos del cliente, perfil y estructura del cliente, sedes, alta de colegios, ciclo de vida,
  operación de cafeterías, finanzas) se rechazan en el servidor antes de ejecutarse mientras el
  operador tiene un Demo vigente (`demoMutationBlock`, respuesta `403 demo_mode_active`), así que un
  formulario abierto en una pestaña antigua no cambia nada. Solo entrar, cambiar y salir del Demo
  quedan permitidos. Operación de cafeterías, ciclo de vida y finanzas ya lo rechazaban además en la
  base de datos; eso no cambia.
- La autoridad no cambia: la base de datos sigue rechazando la operación real bajo un POV vigente,
  y el Demo no concede nada.

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
