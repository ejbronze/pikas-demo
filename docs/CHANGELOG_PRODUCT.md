# Registro de cambios del producto

## Escuela y cafetería: servicio a estudiantes claro entre roles (UX 13, local)

- **Compartición con la verdad del colegio**: «Cafeterías conectadas» distingue **Sin compartir todavía** (nunca se compartió), **Compartición activa** y **Compartición revocada** (hubo compartición y se retiró), leyendo las filas de compartición propias del colegio (misma autoridad `school:sharing:read`). Antes una relación nueva aparecía como «revocada». Cada cafetería explica qué significa compartir («permite que esta cafetería vea únicamente los estudiantes que el colegio habilite…»), la acción principal dice «Compartir con {cafetería}» / «Volver a compartir con…», y «Identificación básica» queda preseleccionada porque el POS la necesita para encontrar estudiantes.
- **Estudiantes habilitados** con estado y guía: cuenta de habilitados, y cuando no hay ninguno un estado vacío que enseña qué es la elegibilidad y qué hacer: «Primero comparte…», «Aún no hay estudiantes para habilitar» (enlace a Estudiantes) o «Ningún estudiante habilitado todavía» con la sección de habilitar abierta.
- **Resumen escolar · Servicio a estudiantes** usa el modelo de puesta en marcha (UX 12A): 1. Estudiantes registrados, 2. Cafetería compartida, 3. Estudiantes habilitados; estados desde los datos, un solo siguiente paso con acción contextual («Agregar estudiantes», «Compartir con Cafetería Santiago», «Volver a compartir con…», «Habilitar estudiantes»), que también es el botón principal del Resumen. Completo: «Listo para atender estudiantes».
- **Cafetería · Hoy** añade «Servicio a estudiantes · lo administra {colegio}»: los estudiantes que el POS atiende los comparte y habilita el colegio; si el POS no encuentra estudiantes, hay que pedirlo al administrador del colegio. No cambia «Lista para operar» (sigue dependiendo solo de lo que administra la cafetería) y no muestra un estado en vivo: hoy el Administrador de cafetería no tiene una lectura autorizada de compartición/elegibilidad (ver informe).
- **POS**: la búsqueda vacía aclara «Si el colegio aún no ha compartido ni habilitado estudiantes para esta cafetería, no aparecerá ninguno» (el POS no distingue ambos casos).
- **Plataforma · Puesta en marcha**: cada paso pendiente indica quién lo completa (PIKAS o «requiere acción de la cafetería»).
- Sin migración, sin capacidades, permisos ni roles nuevos; la autoridad del colegio sobre compartición y elegibilidad no cambia.

## Identidad: la contraseña temporal caduca a los 15 minutos (UX 12B cierre, local)

- Una contraseña temporal (de un solo uso) emitida para personal POS **caduca 15 minutos después de emitirse si no se usa**. «Usarse» significa completar el cambio de contraseña obligatorio. La regla la aplica la base de datos: una temporal vencida no abre sesión en PIKAS («Tu contraseña temporal venció… pide una nueva») y no puede convertirse en contraseña permanente; el intento no cambia nada ni deja sesión.
- 14:59 sigue valiendo; emitir otra temporal reemplaza la anterior y abre una ventana nueva; una contraseña personal nunca está sujeta a la regla; las sesiones ajenas no se tocan.
- Personal POS y Credenciales muestran «Credencial temporal vencida» / «Contraseña temporal vencida», y los textos de emisión indican la vigencia de 15 minutos.
- **Suspender** en Personal POS se presenta como «Cambiar acceso a esta cafetería»: suspende o retira el acceso POS en esa cafetería; la persona, su usuario y su inicio de sesión en PIKAS se conservan. La suspensión global del inicio de sesión sigue siendo de PIKAS.
- Migración `202611140001_temporary_access_expiry.sql` (solo funciones: predicado privado, `identity_credential_state`, `pikas_session_start`, `identity_complete_password_change`, `identity_summary`). Sin cambios de capacidad, rol, membresía, RLS ni datos.

## Cafetería: pulido del recorrido de puesta en marcha (local)

- Un cajero o supervisor entra **directamente al POS** al iniciar sesión o al crear su contraseña personal (antes pasaba por la pantalla técnica «Conexión PIKAS Pilot»). El POS sigue verificando su acceso.
- Personal POS habla de **personas** (Buscar personal, «n de n personas», columna Persona) en lugar de «empleados»; «Agregar personal POS» también en sandbox.
- **Accesos preparados por enlace** solo lista los que esperan activación (pendientes o vencidos); los accesos creados en un paso ya están en la lista de personal y no se repiten. No se muestra un estado vacío cuando no hay ninguno. Un acceso sin correo se describe como «Acceso sin correo (usuario PIKAS)» en vez de mostrar la dirección interna.
- El rechazo por identidad existente explica que puede ser la propia, la de otro cliente o la de PIKAS.

## Cafetería: personal POS y acceso de cajeros en un paso (UX 12B, local)

- **Agregar personal a {cafetería}** crea el acceso en un solo paso desde Personal POS: nombre, rol POS, **usuario sugerido por PIKAS** a partir del nombre (editable antes de confirmar; las colisiones se explican y se corrigen en el mismo formulario), **correo opcional**, y caja (opcional, entre las cajas activas). Al confirmar: identidad de inicio de sesión confirmada, Persona y membresía POS en esa cafetería, asignación a la caja elegida y una **contraseña temporal de un solo uso** que se muestra una sola vez (con «Copiar contraseña») y nunca se guarda, registra ni vuelve a mostrar. Resultado: **«Listo para iniciar sesión»**.
- **Sin correo**, la persona entra solo con su usuario; detrás del usuario hay una dirección interna no entregable y única por solicitud (`@cajeros.pikas.invalid`) que PIKAS muestra como «Sin correo · entra solo con su usuario»; un usuario ya tomado se rechaza con explicación, nunca se vincula a otra persona. No puede recuperar la contraseña por correo: el administrador le emite otra temporal desde Credenciales. Con correo real, se usa tal cual.
- **Identidad existente**: si el correo ya pertenece a una persona de PIKAS del mismo cliente, se vincula la misma Persona (nunca se duplica) y **conserva su contraseña** (no se emite temporal). Una identidad de otro cliente, de la Plataforma o la del propio administrador se rechaza.
- **Primer inicio de sesión**: usuario + contraseña temporal → PIKAS exige crear una contraseña personal → POS con la **caja asignada**. El cajero no puede entrar a Administración de cafetería, Escuela ni Plataforma.
- **Personal POS** muestra por persona el **estado de acceso** (Acceso listo · Credencial temporal emitida · Cambio de contraseña requerido · Pendiente de activación · Acceso suspendido · Inicio de sesión suspendido · Acceso retirado), su usuario y el **último acceso** (lectura de identidad existente, acotada a la cafetería). Credenciales (usuario, emitir contraseña temporal) y Cambiar acceso (suspender/reactivar) se conservan; el historial de ventas, asignaciones y auditoría nunca se borra.
- **Puesta en marcha** (UX 12A) se actualiza sola desde los datos: al crear y asignar personal, el paso 2 queda completo.
- **Pendiente de decisión/migración (no implementado)**: la caducidad de 15 minutos de la contraseña temporal no usada y la visibilidad de sesiones recientes requieren cambios en la base de datos (ver reporte). Los accesos preparados por enlace existentes se siguen mostrando y completando igual que antes; sandbox conserva su flujo.
- Sin migración y sin cambios de autoridad: la ruta compone, en orden, las operaciones existentes (`provisioning_prepare_with_username` → identidad Auth confirmada → `staff_complete` → `identity_begin/finish_temporary_access` → `assignment_save`), cada una con su propia autoridad, diario y auditoría. Ver `docs/ADMINISTRATION_AND_PERMISSIONS.md`.

## Cafetería: mapa de gestión y puesta en marcha (UX 12A, local)

- **Dónde estoy**: toda la Administración de cafetería muestra, bajo el encabezado, la ubicación en la estructura `Colegio → Sede → Cafetería → área actual` (por ejemplo «Colegio Horizonte → Sede Santiago → Cafetería Santiago → Cajas»). Colegio, sede y cafetería son contexto heredado (texto, sin acciones); solo el área actual se resalta. En móvil el colegio se oculta para no desbordar. El encabezado nombra la cafetería con su sede y colegio.
- **Qué administro**: **Hoy** abre con «Estás administrando {cafetería}» y la cadena Colegio → Sede → Cafetería → *Tú administras:* Cajas · Personal POS · Productos (conteos con enlace a cada sección) más la frase «El colegio, la sede y la cafetería los establece PIKAS; no tienes que crearlos». Es orientación, no un panel en vivo.
- **Puesta en marcha** sustituye el bloque «Configuración de la cafetería» de Hoy: muestra el contexto establecido por PIKAS (✓ Sede, ✓ Cafetería) y los pasos que controla el administrador, en orden: 1. Crear caja, 2. Agregar personal y asignarlo a una caja, 3. Configurar productos (menú y turnos solo con programación activada), 4. Preparar la operación. Un solo siguiente paso resaltado con acción contextual («Crear caja para Cafetería Santiago»). Los estados salen de los datos actuales y retroceden si falta un requisito.
- **Lista para operar** significa que existen los requisitos para empezar a operar (caja activa, personal activo asignado a una caja activa, productos disponibles y programación válida si está activada). **Nunca exige una venta.** «En operación» llega al abrirse la primera sesión de caja en el POS (tampoco exige venta). «¡Primera venta con PIKAS!» sigue siendo un hito aparte. Mientras no está en operación, la guía va arriba; después se pliega al final de Hoy.
- **Navegación agrupada** en escritorio: **Operación** (Hoy, Transacciones, Reportes, PIKAS Cash) y **Mi cafetería** (Cajas, Personal POS, Productos, Menús, Configuración). La barra inferior móvil conserva sus cuatro destinos y «Más» (ahora también agrupado).
- **Acciones contextuales**: «Crear caja para {cafetería}», «Agregar personal a {cafetería}», «Administrar productos de {cafetería}»; los estados vacíos de Cajas y Personal POS nombran la cafetería y explican que la asignación a caja se hace en Cajas.
- Sin migración, sin cambios de autoridad: todo se deriva de `cafeteria_admin_read`. Sin cambios en creación de cajeros, usuarios, credenciales ni sesiones (UX 12B). Ver `docs/CAFETERIA_ADMIN_UX_SPEC.md`.

## Plataforma: modo Demo aislado (UX 11, local)

- El Demo y la operación real son modos excluyentes. Mientras un Demo está vigente, la Plataforma muestra la barra **● Demo activo** (con experiencia, persona ficticia y cafetería), la navegación real desaparece y solo queda **Inicio Demo**.
- **Salir del Demo** está disponible desde cualquier lugar del Demo: Plataforma, Escuela Demo, Cafetería Demo y Caja/POS. Al salir se vuelve a `/platform` con la navegación normal.
- Abrir una ruta real (clientes, operación de cafeterías, equipo, identidades, finanzas) con un Demo vigente muestra «Estás en modo Demo», con **Salir del Demo y continuar** o **Volver al Demo**, en lugar de un «cafetería no encontrada» engañoso. Las URL manuales, los marcadores y las pestañas antiguas reciben lo mismo al recargar.
- Entrar al Demo sigue siendo deliberado desde **Demo**; no hay interruptor global. Un Demo vencido o salido no bloquea nada.
- Con un Demo vigente, las mutaciones reales de la Plataforma (equipo, identidades, clientes, accesos, finanzas) se rechazan en el servidor antes de ejecutarse («Estás en modo Demo…»), también desde pestañas antiguas y en llamadas directas a la base de datos (migración `202611130001`, una guarda compartida). Entrar, cambiar y salir del Demo siguen funcionando.
- Sin migración, sin cambios de autoridad ni de permisos. Ver `docs/ADMINISTRATION_AND_PERMISSIONS.md`.

## Plataforma: Finanzas de PIKAS Cash (local)

- Nuevo destino **Finanzas** en la Plataforma. Solo aparece con `platform:finance:read`, que no está otorgado a nadie.
- **Por verificar:** transferencias bancarias pendientes, de la más antigua a la más reciente. Cada una muestra referencia, estudiante, cliente, el monto pagado, el cargo PIKAS (3 %) y lo que se acredita, además de la referencia bancaria y si hay comprobante.
- **Historial:** decisiones recientes (verificadas, rechazadas y revertidas), con operador y fecha. Se puede buscar por referencia, cliente o estudiante y filtrar por estado.
- **Revisión de una transferencia:** montos, quién recibe el crédito y la evidencia manual. PIKAS no confirma transacciones bancarias automáticamente.
- **Acciones:**
  - **Verificar** acredita el neto;
  - **Rechazar** pide un motivo y no mueve dinero;
  - **Revertir** solo procede si el crédito sigue disponible; si no, muestra que el caso requiere resolución financiera.

  Cada acción requiere su propio permiso. Una solicitud ya procesada por otra persona o en otra pestaña lo indica sin duplicar nada.
- **Colegio:** las acciones financieras de PIKAS aparecen como «Recarga por transferencia», «Reversión realizada por PIKAS» y «Ajuste realizado por PIKAS», registradas por PIKAS, sin el nombre del operador. El colegio ya no ve «Revertir recarga» en recargas con cargo PIKAS.
- Sin activación de clientes, cobro en efectivo, liquidación ni reportes financieros. La compensación central sigue requiriendo aprobación legal y contable. Ver `docs/PIKAS_CASH_FINANCE_OPERATIONS.md`.

## PIKAS Cash: base financiera FIN 2 (local)

- **Solo base de datos.** No hay pantallas, navegación, reportes ni carga de comprobantes nuevos. Ningún cliente queda activado y no se otorga ningún permiso.
- **La compensación central requiere aprobación legal y contable antes de activar dinero real.** La custodia legal de la parte de compensación no está asignada.
- **Política de comisión versionada:** v1 es DOP, 3 % (300 pb), redondeo hacia arriba desde la mitad en centavos enteros. Solo aplica a recargas. Cada solicitud guarda bruto, comisión y neto, y bruto = comisión + neto. El monedero recibe el neto.
- **Activación por cliente,** inactiva por defecto. Al activar se toma una foto del saldo existente. Los clientes no activados no cambian: sin comisión, sin obligaciones, sin reprocesar historial.
- **Recargas con fuente de cobro:**
  - transferencia bancaria: enviada → verificada y publicada, o rechazada;
  - efectivo en Cafetería: se cobra y publica en una sola operación.

  Con un cliente activado, el colegio ya no puede publicar recargas directas.
- **Obligaciones:**
  - efectivo cobrado: la Cafetería debe el bruto a compensación;
  - compra con monedero: compensación debe a la Cafetería;
  - reembolso: contra-obligación;
  - reversión: corrige el cobro en efectivo.

  Semana de liquidación de lunes a domingo (America/Santo_Domingo), con vencimiento el martes. Todavía no hay lotes.
- **Reversión en la era de comisión:** es una operación de finanzas de la Plataforma, con el permiso `platform:finance:replenishments:reverse`, que no está otorgado a nadie. El colegio ya no la ejecuta directamente y sigue revirtiendo las recargas previas a la activación como antes. Solo procede si el monedero conserva el neto completo. Si no, `FINANCIAL_RESOLUTION_REQUIRED` y no cambia nada. La reversión completa también revierte la comisión.
- **Ajustes con significado financiero** para clientes activados:
  - un ajuste positivo es valor financiado por compensación. Solo lo ejecuta finanzas de la Plataforma (`platform:finance:adjustments:fund`, no otorgado a nadie). Colegio, Cuenta y Cafetería reciben `finance_adjustment_authority_required` sin que se escriba nada;
  - uno negativo reduce el pasivo y lo siguen ejecutando los mismos administradores de antes.

  Sin comisión y sin simular recargas ni cobros. Los clientes no activados no cambian.
- **Pasivo inicial heredado:** al activar, el saldo positivo existente queda registrado como un único evento de pasivo asumido. No cambia saldos ni historial. Si es cero, no se registra nada.
- **Reembolso de una compra anterior a la activación** (aprobado por el propietario): la Cafetería devuelve ese valor exacto a compensación, sin comisión ni recarga.
- Ningún valor de un monedero activado aparece sin fuente económica.
- Ver `docs/PIKAS_CASH_FINANCIAL_FOUNDATION.md`.

## Cafetería: Reportes y trazabilidad de Hoy (local)

- **Reportes** de la cafetería ahora es una página de inicio («¿qué quieres analizar?») con cuatro reportes. Cada uno lee de la URL el período (Hoy, 7 días, 30 días o Personalizado de hasta 92 días), se puede imprimir y exportar en CSV.
  - **Ventas:** ventas brutas, transacciones, ticket promedio y ventas netas con reembolsos; «Ventas por hora» para Hoy; y el detalle de cada venta (recibo, hora, caja, operador, método, total, reembolso), paginado. Se puede filtrar por método de pago.
  - **Métodos de pago:** monto, transacciones y participación por método. Cada método abre las ventas pagadas con él.
  - **Productos:** los 10 productos principales por unidades netas.
  - **Cajas y cierres:** cajas abiertas y cierres del período con efectivo esperado, contado, diferencia y resultado. Requiere acceso al historial de cajas.
- **Hoy** no cambia de diseño. Ahora sus cifras abren el reporte filtrado al mismo período y la misma lectura, y el número coincide:
  - Ventas de hoy, Ventas y Ticket promedio abren Ventas de hoy.
  - Pagado con PIKAS Cash y «Ver métodos» abren Métodos de pago de hoy.
  - «Lo más vendido» abre Productos de hoy.
  - «Ver cierre» abre Cajas y cierres de los últimos 7 días.
- Sin migraciones ni permisos nuevos. En sandbox no hay datos financieros. El detalle de ventas no incluye nombres de clientes.

## Escuela: Reportes (local)

- Nuevo destino **Reportes** (`/admin/escuela/reportes`) en la navegación escolar. En el escritorio va al final de la barra lateral; en el móvil está en «Más», así que la barra inferior no cambia.
- La página de inicio lista solo los reportes que el rol puede abrir:
  - **Estudiantes:** filtros de estado, campus y grado; resumen (total, activos, suspendidos, inactivos); «Estudiantes por grado», donde cada barra filtra el reporte a ese grado; y la tabla completa con los filtros aplicados.
  - **PIKAS Cash:** el reporte de movimientos por período, que deja de estar en la página PIKAS Cash. Período Hoy, 7 días, 30 días o Personalizado (hasta 92 días). Muestra movimiento neto, recargas netas, monederos con movimiento, la tabla de movimientos (recargas, reversiones, compras, reembolsos, ajustes y ajustes históricos) y el estado actual de los monederos. Sin desglose por cafetería, sin productos y sin rankings.
  - **Cafeterías conectadas:** cafetería, sede, estado, compartición, información compartida y estudiantes habilitados. Sin ventas ni datos de caja.
- **Filtros en la URL:** cada reporte se puede recargar o guardar como marcador, y un enlace abre el mismo reporte filtrado para alguien con la misma autoridad.
- **Imprimir:** solo el reporte, con el nombre del colegio, los filtros y la fecha de generación.
- **Exportar CSV:** el resultado completo con los filtros aplicados, igual al reporte.
- **Del resumen al reporte:**
  - «Estudiantes activos» en Resumen abre Reportes / Estudiantes con el estado Activo;
  - «Monederos con movimiento», en Resumen y en PIKAS Cash, abre Reportes / PIKAS Cash con los mismos 7 días.

  Las cifras coinciden porque el reporte usa la misma lectura y el mismo filtro.
- **PIKAS Cash** (página operativa) ya no incluye el reporte plegado. Muestra «Ver reportes de PIKAS Cash».
- Sin migraciones ni permisos nuevos. Cada reporte usa una lectura escolar existente, reducida en el servidor. Se pospone Administración y accesos (no hay historial de accesos) y Actividad (la lectura muestra solo los últimos eventos, sin fechas ni paginación). Ver `docs/REPORTING_FOUNDATION.md`.

## Escuela: PIKAS Cash del colegio (local)

- **PIKAS Cash** (`/admin/escuela/pikas-cash`) ahora sirve para administrar los monederos de los estudiantes. No muestra ventas de cafetería ni compras de estudiantes. Solo aparece con `school:wallets:read`; el punto de vista de sandbox sigue sin datos financieros.
- **Monederos:** monederos activos (de cuántos, y cuántos congelados), saldo de estudiantes (ahora) y **Monederos con movimiento**, con fechas explícitas (últimos 7 días). Si el colegio aún no tiene monederos, se explica que el monedero se crea con la primera recarga de un estudiante activo y matriculado.
- **Requiere atención:** solo monederos congelados o con saldo negativo, con la vista «Requieren atención». Si no hay ninguno, se muestra «Todo en orden».
- **Monederos de estudiantes:** nombre, código, estado del monedero («Activo», «Congelado» o «Sin monedero») y saldo, en el orden del listado de Estudiantes, nunca ordenados por saldo ni por gasto. Se busca por nombre o código y se pagina de 50 en 50.
- **Navegación:**
  - el nombre abre la ficha del estudiante;
  - «PIKAS Cash» abre el monedero del estudiante, que vuelve a PIKAS Cash;
  - abierto desde la ficha, el monedero vuelve a la ficha.
- Recargar, revertir y ajustar siguen en el PIKAS Cash de cada estudiante, con sus permisos. Congelar o descongelar no está implementado. El reporte de movimientos por período queda como sección secundaria plegada, con recargas, compras y reembolsos de PIKAS Cash (totales), correcciones y movimiento neto.
- **Sin desglose por cafetería:** se quita del colegio «¿Dónde se usó PIKAS Cash?». El colegio ve los monederos de sus estudiantes, no dónde gastaron por cafetería; ese desglose ya no se envía al navegador del colegio.
- **Privacidad:** el servidor reduce los datos a estado y saldo por estudiante. Compras, líneas, recibos y productos no llegan a la página. Sin migraciones ni cambios de autoridad.

## Escuela: ficha del estudiante (local)

- Nueva página **Estudiante** (`/admin/escuela/estudiantes/{id}`), dentro de Administración escolar. Se abre desde el nombre en Estudiantes, y la vista rápida «Ver perfil» ofrece «Abrir ficha del estudiante». Tiene un enlace de vuelta a Estudiantes.
- **Identidad primero:** nombre, estado en texto, código estudiantil y grado · sección (y campus si hay varios). La acción principal es «Editar información».
- **Requiere atención:** solo hechos registrados: suspendido, inactivo, sin matrícula activa, matrícula sin campus o grado, y, con permiso de monederos, monedero congelado o con saldo negativo, o habilitado solo en una cafetería sin compartición activa.
- **Secciones:**
  - **Matrícula:** campus, grado, sección, aula y fecha de inicio, con «Cambiar matrícula» o «Matricular».
  - **PIKAS Cash:** solo con `school:wallets:read`. Muestra estado y saldo; las recargas y movimientos siguen en «Ver PIKAS Cash».
  - **Cafeterías:** dónde está habilitado el estudiante y si el colegio comparte con esa cafetería.
  - **Restricciones alimentarias:** solo lectura, para el rol de Administrador escolar.
- **Estado y matrícula** («Cambiar estado», «Retirar matrícula») va aparte, con sus confirmaciones existentes. Las tareas de edición, matrícula, retiro y estado son las mismas de antes.
- Solo lecturas escolares existentes, sin migración ni cambios de autoridad:
  - la lista de estudiantes, en modo de un solo estudiante;
  - `school_wallet_read`, reducido en el servidor a estado y saldo; las líneas de compra no llegan a la página;
  - `cafeteria_customers` (`school:customers:read`);
  - la lectura de cafeterías del colegio;
  - `student_dietary_restrictions` (`school:restrictions:read`).

  Sin historial de compras, ventas, productos, cajas ni identificadores internos visibles.

## Escuela: gestión de estudiantes (local)

- **Estudiantes** es ahora una lista clara de alumnos:
  - encabezado con el colegio y «N activos de M»;
  - «Crear estudiante» como acción principal e «Importar CSV» como secundaria;
  - búsqueda por nombre o código como herramienta principal;
  - chips de estado (Todos, Activos, Suspendidos, Inactivos) con los totales del colegio, que conservan la búsqueda; los estados sin alumnos no aparecen;
  - Campus y Grado bajo «Más filtros», solo cuando el colegio tiene más de un campus o grados registrados.
- **Una fila por estudiante:** nombre (abre el perfil existente), código, grado y sección (y campus si hay varios), estado en texto. Acciones discretas: «PIKAS Cash», solo con permiso de monederos, y «Ver perfil». En móvil cada estudiante es una tarjeta, no una tabla comprimida.
- **Colegio sin estudiantes:** invitación con «Crear estudiante» e «Importar CSV»; sin barra de búsqueda ni exportación. «Sin resultados» se distingue de un colegio vacío.
- Sin cambios en la creación, importación CSV, exportación, perfil, matrícula, estado ni PIKAS Cash. Usa las lecturas escolares existentes (`school_student_roster` y los totales del resumen). Sin migración ni cambios de autoridad. No muestra saldos, compras ni datos de cafetería por estudiante.

## Escuela: Resumen del colegio (local)

- El **Resumen** de Administración escolar ahora se centra en estudiantes, accesos y servicio. Nunca muestra el negocio de la cafetería: ventas, tickets, medios de pago, productos, cajas, cajeros ni reembolsos.
- **Estudiantes:** número de estudiantes activos (con suspendidos e inactivos). Solo con el permiso de monederos (`school:wallets:read`) se agregan:
  - **Con PIKAS Cash:** monederos activos;
  - **Movimiento en PIKAS Cash:** monederos con recargas, compras o ajustes en los últimos 7 días, con las fechas visibles;
  - **Saldo de estudiantes:** suma de los saldos de PIKAS Cash.

  Sin ese permiso, esas cifras no aparecen ni dejan espacios vacíos.
- **Requiere atención:** solo estados que el producto registra, en cantidades y sin nombres:
  - invitaciones de administrador vencidas;
  - una cafetería con estudiantes habilitados cuya compartición no está activa;
  - con permiso de monederos, monederos congelados o con saldo negativo.

  Sin umbrales inventados. Si no hay nada, muestra «Todo en orden».
- **Servicio a estudiantes:** tres comprobaciones del lado del colegio: estudiantes activos, una cafetería con compartición activa y estudiantes habilitados en ella. No guarda ningún estado nuevo.
- **Cafeterías que atienden al colegio:** sede, estado, compartición y número de estudiantes habilitados (100 o más cuando se alcanza el límite de la consulta).
- Usa lecturas escolares existentes. Los nombres de estudiantes, los correos de invitaciones y el gasto por cafetería del informe de PIKAS Cash se descartan en el servidor. Sin migración ni cambios de autoridad.

## Plataforma: espacio de trabajo del cliente (local)

- El detalle del cliente es una sola página con una barra de secciones fija: Puesta en marcha, Información, Usuarios y accesos, Estructura, Operación y Estado. La barra marca la sección actual y funciona con teclado. Los enlaces de Puesta en marcha siguen llegando a su control, sin quedar ocultos bajo el encabezado.
- **Encabezado:**
  - nombre del cliente;
  - estado de ciclo de vida, tipo y estado de puesta en marcha, en texto;
  - el código interno queda como dato secundario.
- **Información:** **Editar** (lápiz) es una acción discreta en el encabezado de la sección, o en el de cada colegio si hay varios. Ya no es un botón debajo de la tabla. El formulario no cambia.
- **Usuarios y accesos:** el **Administrador inicial** aparece justo debajo, y la solicitud pendiente del administrador enlaza a él. Sin la capacidad de consulta de accesos, la barra nombra solo «Administrador inicial».
- **Estructura:**
  - se lee como árbol colegio → sede → cafetería;
  - estado y código quedan en segundo plano;
  - se conservan «Agregar sede» y «Renombrar»;
  - cada cafetería enlaza a sus cajas.
- **Operación:** reemplaza «Gestión del cliente». Tiene una acción principal, «Administrar operación», enlaces por cafetería (Abrir, Cajas, Productos) y explica que PIKAS actúa con su propia cuenta, no como usuario del cliente.
- **Estado:** el historial del ciclo de vida va primero. Suspender y Cerrar quedan aparte, al final, en «Cambiar estado del cliente», con su confirmación existente.
- Solo presentación y navegación: sin migración ni cambios de autoridad, de reglas de puesta en marcha, de ciclo de vida ni de aprovisionamiento.

## Plataforma: Inicio como estado de la red y Puesta en marcha (local)

- **Inicio** muestra el estado de la red PIKAS:
  - resumen de clientes reales activos (en configuración, listos para operar, operando);
  - **Requiere atención**: un aviso por cliente con su bloqueo principal y lo que también falta, con enlace a su puesta en marcha;
  - la lista de clientes con su estado y avance («N de 7 listos»);
  - la actividad reciente, con el nombre del cliente;
  - las demostraciones, aparte.

  Sin pasos pendientes muestra «Todo en orden». Sin clientes reales invita a agregar el primero. Sin la capacidad de operaciones se mantienen las tarjetas de destino anteriores.
- En el detalle del cliente, **Puesta en marcha** aparece después de la identidad y antes de la información existente. Son siete pasos con estado escrito (Completo, Pendiente, Requiere atención) y un enlace al control existente cuando falta algo; no repite formularios. Un cliente que ya opera ve «Completa» con los pasos plegados.
- Cómo se determina cada paso; nada se guarda:
  - **Perfil:** colegio activo. RNC, dirección y provincia son opcionales y no bloquean.
  - **Estructura:** una cafetería activa en una sede y colegio activos.
  - **Administrador:**
    - completo con un administrador del colegio (cuenta o escolar) activo y con inicio de sesión;
    - requiere atención si no hay administrador ni solicitud, si la solicitud venció o si el enlace venció sin usarse;
    - pendiente mientras el acceso está preparado, el enlace activo o falta completar.
  - **Personal POS:** al menos una persona de caja (cajero o supervisor) activa y con inicio de sesión. Una invitación vencida requiere atención.
  - **Cajas:** una caja activa con personal de caja activo asignado.
  - **Productos:** un producto activo y disponible.
  - **Primera venta:** existe una compra real del cliente.

  Operando = activo y con primera venta. Listo para operar = pasos 1–6 completos sin venta. El ciclo de vida (activo, suspendido, cerrado) no cambia, y los clientes suspendidos o cerrados no se cuentan.
- Nueva lectura de solo consulta `platform_customer_readiness` con la capacidad existente `platform:customer:operations:read`:
  - solo clientes reales; sandbox se lista aparte;
  - no se permite durante una sesión Demo vigente;
  - devuelve conteos, estados de activación y fechas de primera y última venta;
  - sin montos, saldos, credenciales, enlaces ni datos de Auth;
  - no escribe nada.

  Migración `202611080001`.

## Cafetería: «Hoy» y base visual de la experiencia (local)

- El **Resumen** de Administración de cafetería pasa a llamarse **Hoy** (misma ruta) y responde cómo va el día: ventas de hoy (brutas, en RD$) con comparación contra el **mismo día de la semana pasada hasta la misma hora**, número de ventas, ticket promedio, porcentaje pagado con PIKAS Cash, **Así va el día** (ventas por hora, con la semana pasada como referencia punteada), **Requiere atención**, lo más vendido, **Cajas ahora** y **Cómo pagan**. La configuración (productos, menús, personal, cajas) queda en «Configuración de la cafetería», plegada; se muestra abierta y destacada mientras falten productos disponibles, cajas activas o personal activo.
- **Requiere atención** solo usa señales reales: cajas abiertas desde un día anterior y cierres de los últimos 7 días con faltante, sobrante o sin efectivo contado, con enlace a Cajas o Reportes. Sin alertas muestra «Todo en orden». No hay inventario ni productos agotados.
- Pocos datos: sin ventas muestra «Aún no hay ventas hoy. La primera venta aparecerá aquí.»; el porcentaje de comparación solo aparece con al menos 5 ventas hoy y 5 la semana pasada hasta la misma hora; con menos se muestra el monto de la semana pasada, y sin ventas la semana pasada no se compara. La primera venta de la cafetería muestra un reconocimiento breve, sin guardar estado.
- Autoridad sin cambios: la nueva lectura `cafeteria_today_read` exige la misma autoridad de historial de compras que Reportes (Administrador de cafetería); Administración escolar, cuenta, POS y PIKAS Admin no la obtienen. Sandbox muestra solo el estado operativo. Migración `202611070001`.
- Base visual: Inter (interfaz) y Nunito (títulos y cifras importantes) se cargan con `next/font`; antes Inter se declaraba sin cargarse. Nuevos tokens (`--brand-yellow`, `--brand-cream`, superficie de atención, colores por medio de pago) y clases `font-display`, `num` y `num-display` (cifras tabulares). El amarillo marca atención e hitos; error y peligro siguen en rojo.

## Códigos asignados por PIKAS para sedes, cafeterías y cajas (local)

- Los operadores nombran lugares reales; PIKAS asigna los códigos. **Agregar sede** pide solo el nombre de la sede y el de su cafetería (prellenado «Cafetería {sede}», editable y sin sobrescribirse una vez editado) y muestra los códigos asignados al terminar. **Crear caja** pide solo el nombre; el código aparece en la lista de cajas, el POS, el cierre de caja y los recibos, y no se edita (al editar se conserva).
- Formatos `SEDE-NN` (por colegio), `CAF-NN` (por sede) y `CAJA-NN` (por cafetería). Un colegio nuevo creado con **Agregar colegio** empieza con `SEDE-01` y `CAF-01` (antes `SEDE-PRINCIPAL` / `CAF-PRINCIPAL`, que los registros existentes conservan). El siguiente número es el mayor entre «hermanos + 1» y «mayor NN existente + 1», saltando códigos tomados: nunca reutiliza números (con CAJA-01 y CAJA-03 sigue CAJA-04). La generación ocurre en la base de datos con un bloqueo por padre, es segura ante creaciones simultáneas y los reintentos devuelven el mismo código.
- Los UUID siguen siendo la identidad real. Los códigos existentes (incluidos los manuales y heredados como `01`, `CF-0001`, `CAJA-1`) no cambian; el código de una caja usada sigue bloqueado. «Agregar sede» y «Agregar personal de caja» usan el estilo de acción principal; el código del cliente pasa a una línea secundaria («Código interno»). Migración `202611060001`.

## Backoffice: aprovisionamiento de accesos del cliente (local)

- Desde **Usuarios y accesos**, PIKAS prepara **Personal de caja** (nombre, correo, usuario PIKAS y cafetería), genera su enlace de activación (vence en una hora) y completa su acceso cuando la persona guarda su contraseña; también da **Administrador de cafetería** a una persona existente del cliente para una o varias cafeterías, con la misma persona e inicio de sesión, y corrige el nombre visible de una persona. El rol canónico sigue siendo `pos_cashier`; como PIKAS no guarda género, se muestra «Personal de caja».
- El nombre del administrador del colegio se guarda al preparar la solicitud (Agregar colegio o Administrador inicial) y aparece prellenado al completar el acceso; si la persona ya existe en PIKAS se conserva su nombre. Textos breves explican que el enlace vence en una hora y por qué «Completar acceso» espera la contraseña.
- Invariante del nombre del cliente: un cliente con un solo colegio toma el nombre del colegio al guardar su información, aunque el nombre del colegio no cambie (corrige casos heredados con el nombre de una persona). La ruta heredada `/api/platform/tenants` queda retirada (410).
- Capacidad nueva `platform:customer:access:provision` (solo `platform_admin`). Migración `202611050001`.

## Backoffice: Usuarios y accesos (solo consulta, local)

- En el detalle del cliente, **Usuarios y accesos** muestra a cada persona una sola vez con todos sus roles (Administrador del colegio, Administrador escolar, Administrador de cafetería · {cafetería}, Operador de caja · Supervisor/Cajero), usuario, correo, estado de acceso y de inicio de sesión, y en el detalle sus cajas asignadas y señales de credenciales. **Pendientes** muestra las solicitudes de administrador inicial y las invitaciones con su estado de activación y de enlace.
- Capacidad nueva `platform:customer:access:read` (solo `platform_admin`). Una sola lectura de base de datos que no escribe nada, solo para clientes y nunca durante una sesión Demo vigente. No muestra contraseñas, tokens, enlaces ni metadatos de Auth, ni estudiantes, padres o datos financieros. Sin controles de edición. Migración `202611040001`.

## Backoffice: edición del perfil del cliente (local)

- En el detalle del cliente, **Editar información** corrige nombre, RNC, dirección y provincia del colegio (País fijo en República Dominicana; RNC, dirección y provincia pueden quedar sin registrar). Si el cliente tiene un solo colegio, su nombre cambia junto con el del colegio. En **Estructura del cliente**, **Renombrar** cambia el nombre de una sede o cafetería; los códigos no cambian.
- Capacidad nueva `platform:customer:profile:manage` (rol `platform_admin`). Solo clientes activos o suspendidos (cerrados: solo consulta), nunca sandbox, y no durante una sesión Demo vigente. Cada edición usa una clave de solicitud con reintento seguro, rechaza cambios hechos sobre datos desactualizados y queda auditada con el operador real. No cambia usuarios, membresías, operación, ventas ni saldos. Migración `202611030001`.

## Backoffice: Agregar colegio y configuración de clientes (local)

- **Agregar colegio** reemplaza «Nuevo cliente». En una sola página: nombre, RNC, dirección, país República Dominicana (visible, no editable) y provincia de una lista canónica, más el administrador del colegio (nombre, usuario PIKAS y correo). El operador no escribe códigos: PIKAS genera el código del colegio (`COL-…`) y lo muestra como referencia. El cliente se crea internamente junto con el colegio, su sede y cafetería principales en una sola transacción; nunca queda un cliente sin colegio por este flujo.
- El administrador del colegio usa el flujo Phase 6A existente (activación por enlace, contraseña, completar acceso; inicio con usuario o correo). Migración `202610310001`.
- Decisión del propietario: Backoffice no es una segunda administración escolar. Estudiantes, padres y profesores/personal los gestiona el colegio.
- La capacidad nueva `platform:customer:operations:manage` permite a PIKAS configurar cafeterías de clientes activos desde **Administrar cliente**, con el cliente siempre visible como contexto y el empleado real como actor.
- Cafeterías: crear/editar productos, precio, disponibilidad, categorías, importación CSV, menús, turnos, configuración; crear/editar cajas y asignar o retirar personal POS que ya esté autorizado (con identidad confirmada). No prepara personal ni credenciales.
- Lista de servidor y base de datos estrictamente no financiera. Ventas, checkout, reembolsos, transacciones, monederos, cierres excepcionales, conciliación, liquidación, ciclo de vida, identidad y autoridad del cliente quedan fuera. Clientes suspendidos/cerrados y soporte de solo lectura no pueden escribir.
- La auditoría conserva la persona y usuario Auth reales de PIKAS con alcance `platform` y rol `platform_support`; no crea membresías ni suplanta al cliente. Migración `202610300001`. Implementación y verificación local; sin push ni despliegue.

## Backoffice: gestión de clientes, etapa 1 (solo consulta, local)

- En **Clientes → cliente → Administrar cliente**, el personal de PIKAS con la nueva capacidad `platform:customer:operations:read` consulta la operación de las cafeterías del cliente: **Resumen**, **Productos**, **Cajas**, **Personal**, **Transacciones** (con detalle) y **Reportes**, eligiendo la cafetería entre las del cliente.
- Siempre visible: «Gestionando {cliente}» y «Estás viendo la operación como personal de PIKAS». No hay suplantación ni membresías: la persona de PIKAS sigue siendo quien actúa y el cliente es solo el contexto, validado por el servidor en cada consulta.
- Esta etapa conserva la ruta de solo consulta, también para clientes suspendidos o cerrados. La gestión no financiera posterior se documenta arriba; transacciones y reportes continúan sin mutaciones. Migración `202610290001`. Sin push ni despliegue.

## Familias y estudiantes: nueva presentación (solo demostración, local)

- Las experiencias de **familia** y **estudiante** se rediseñaron para el móvil con los conceptos reales de PIKAS: saldo **PIKAS Cash** por estudiante, **Compras** (recibo, cafetería, artículos, total, forma de pago y reembolsos) y **movimientos de PIKAS Cash** en lenguaje sencillo, con el saldo después de cada uno.
- Navegación: familia **Inicio · Actividad · Perfil** (una tarjeta por estudiante, sin saldo familiar combinado; selector de estudiante); estudiante **Inicio · Compras · Perfil**.
- Límites diarios y por compra, alergias y restricciones se muestran **solo para consulta**: los administra la escuela.
- Se eliminaron de estas experiencias los conceptos que PIKAS no tiene: preórdenes y pedidos, menú para ordenar, QR rotativo, «Mi plan», recarga de demostración y la gestión de estudiantes por la familia.
- Siguen siendo **solo de demostración** (escenarios ficticios); no hay acceso conectado para familias ni estudiantes. La conexión de familias se hará antes que la de estudiantes, tras definir el modelo de tutores y la autoridad. En modo piloto ya no se monta el estado de demostración (desaparece la solicitud innecesaria a `/api/menu`). Sin cambios de base de datos. Sin push ni despliegue.

## Clientes: agregar sede (local)

- En el detalle del cliente, la Plataforma puede **Agregar sede** a una escuela de un cliente **Activo**: indica el código y nombre de la sede y de su cafetería. Una sola operación crea la sede (ubicación) y su cafetería, que aparecen de inmediato en la estructura del cliente.
- Solo operadores con la capacidad existente de aprovisionamiento de clientes (`platform:tenant:provision`); ningún rol del cliente. Clientes suspendidos o cerrados y entornos sandbox no reciben sedes.
- No crea cajas, administradores, personal ni productos: esos pasos siguen en sus flujos (Cajas, delegación y Personal POS). Reintentar la misma solicitud no duplica la sede. Usa el comando existente `platform_add_school_location`; sin migraciones. Sin push ni despliegue.

## Clientes: ciclo de vida del cliente (local)

- **Clientes** muestra el estado de cada cliente (**Activo**, **Suspendido**, **Cerrado**) y permite filtrarlos; los clientes cerrados siguen visibles.
- En el detalle del cliente, la Plataforma puede **suspender**, **reactivar**, **cerrar** o **reabrir** con motivo obligatorio y confirmación en una tarea; cerrar y reabrir piden una confirmación deliberada. Cada cambio queda en un historial inmutable con el operador real y el motivo.
- Un cliente suspendido o cerrado pierde el acceso operativo de inmediato (también sesiones abiertas y enlaces guardados); sus usuarios ven un mensaje claro de organización suspendida o cerrada, sin motivos internos. Sus datos, personas, accesos, saldos e historial se conservan; reabrir devuelve el mismo cliente.
- No es la suspensión individual de identidad. No elimina, anonimiza ni liquida nada. La política de retención de datos tras el cierre queda como trabajo futuro sin plazos definidos. Migración `202610280001`. Sin push ni despliegue.

## Phase 6A: identidad, credenciales y usuarios (local)

- **Inicio de sesión con «Correo / Usuario»**: cada persona puede tener un usuario PIKAS único (minúsculas, números y `. _ -`) además de su correo; ambos abren la misma cuenta y la misma persona. Los errores son genéricos y no revelan si un usuario existe.
- **Identidades** (PIKAS Admin, capacidad nueva `platform:identity:support`): búsqueda exacta por correo o usuario, asignar o cambiar usuario, corregir el correo de la misma cuenta, emitir contraseña temporal (se muestra una sola vez y nunca se guarda) y suspender o reactivar el inicio de sesión. No otorga roles ni acceso a datos del cliente.
- **El usuario se elige al preparar el acceso** (Personal POS, administradores escolares, delegación de cafetería y administrador inicial del cliente): queda reservado mientras el acceso está pendiente, nadie más puede tomarlo y, al completarse, la persona entra de inmediato con su usuario o su correo. Si el acceso se revoca o vence, el usuario se libera (migración `202610270001`).
- **Personal POS → Credenciales**: el administrador gestiona usuario y contraseña temporal solo de personas cuyos accesos administra por completo.
- Tras una contraseña temporal, la persona debe crear su propia contraseña antes de entrar. Cada cambio queda en un historial inmutable con el operador real, sin contraseñas ni enlaces.
- Migración aditiva `202610260001`. Sin cambios financieros ni en el POS. Sin aprovisionar CEPOINT ni crear identidades de producción. Sin push ni despliegue. Detalle: `docs/PHASE_6A_IDENTITY_CREDENTIALS.md`.

## UX Wave F: accesibilidad, diseño adaptable y pulido final (local)

- Revisión automática (axe) y por teclado de 26 páginas en móvil, tableta y escritorio: ahora sin errores de accesibilidad, sin desbordes y con todos los controles de al menos 44 px (incluidas las filas de sesiones en **Cajas**, el acceso a inicio en móvil y los enlaces de inicio de sesión).
- **Cajas**: sesiones más fáciles de tocar, sin identificadores técnicos en las listas, horas sin segundos y el detalle recibe el foco al abrirse. **Reportes** en móvil: enlaces para saltar a Método de pago, Productos principales y Conciliación de caja.
- Sin diálogos nativos del navegador en los flujos conectados: reemplazar enlaces de activación, cerrar caja en el POS (muestra solo el monto contado; el conteo sigue a ciegas) y salir del demo con trabajo sin enviar ahora se confirman dentro de PIKAS.
- Mensajes del POS con la terminología PIKAS Cash. Sin cambios en base de datos, autoridad, cálculos, cobros, reembolsos, reportes ni en el Demo. Sin push ni despliegue.

## Phase 5D.5: reporte de PIKAS Cash de la escuela (local)

- Nueva sección **PIKAS Cash** en Administración escolar (y para la Administración de cuenta, por escuela): saldo PIKAS Cash total de los estudiantes **ahora**, monederos activos y congelados, y saldos negativos.
- Movimientos del período (Hoy, 7 o 30 días, personalizado hasta 92 días, por fecha de operación de la escuela): **Recargas**, **Compras con PIKAS Cash**, **Reembolsos a PIKAS Cash**, y aparte **Reversiones de recarga**, **Ajustes administrativos** y el movimiento neto.
- **¿Dónde se usó PIKAS Cash?**: compras y reembolsos con PIKAS Cash por cafetería. No son las ventas de la cafetería: no incluye efectivo, crédito de personal, totales de ventas ni datos de caja.
- Lectura nueva `school_wallet_report` (migración `202610250001`), solo lectura y con la autoridad existente de PIKAS Cash. Sin cambios en recargas, compras, reembolsos, reversiones ni ajustes. Sin push ni despliegue.

## UX Wave E + Phase 5D.4: POS y búsqueda de transacciones (local)

- **Transacciones** (Administración de cafetería): filtros del servidor por período (Hoy, 7 o 30 días, personalizado hasta 92 días), método de pago y estado de reembolso; búsqueda exacta por número de recibo; paginación con el total real. Cada venta muestra **Sin reembolso / Reembolso parcial / Reembolsada** calculado por PIKAS, y el detalle incluye artículos con cantidades reembolsadas, el historial de reembolsos y los reembolsos antiguos por monto sin asignarlos a artículos. Indica cómo reembolsar en el POS (Reembolsos → recibo #N).
- Nueva lectura aditiva `cafeteria_transactions_read` / `cafeteria_transaction_detail` (migración `202610240001`), de solo lectura y con la misma autoridad que el historial de compras. Sin índice nuevo.
- **POS**: encabezado con cajero y rol; cambiar de cliente ya no vacía la venta sin avisar; la venta actual muestra precio unitario, total por línea y «Quitar», y en móvil el total y «Continuar al pago» quedan siempre visibles; el pago muestra el disponible de PIKAS Cash, lo que falta o el cambio, y el botón dice exactamente «Cobrar RD$ X en efectivo / con PIKAS Cash». Una venta pendiente muestra su monto y método, y solo permite reintentar la misma venta. Al terminar: recibo, cambio a entregar y acceso directo para reembolsar; ventas recientes de esta pestaña.
- Sin cambios en cálculos, métodos de pago, reembolsos, caja, cierre ciego (D8 sigue diferido) ni en el Demo. Sin push ni despliegue.

## UX Wave D.3: flujos administrativos restantes (local)

- **Estudiantes**: búsqueda y filtros del servidor más claros, conteo, «Limpiar filtros», estados distintos para «sin estudiantes» y «sin resultados», y lista responsiva. Crear, editar información, matrícula, retiro y estado son tareas enfocadas con revisión y acción final explícita; los borradores de creación y edición se conservan solo en esta sesión del navegador y nunca se envían solos.
- **PIKAS Cash del estudiante**: el nombre del estudiante encabeza la página; Recargar, Corregir saldo y Revertir recarga no cambian. Cada movimiento muestra su contexto y un «Ver detalle» con los datos ya registrados.
- **Personal POS, administradores escolares y Equipo**: preparar y cambiar accesos en tareas enfocadas, con los mismos roles y permisos. **Cajas**: crear y editar la configuración en una tarea; una caja con sesión abierta sigue sin poder editarse.
- **Nuevo cliente**: pasos visibles, errores por campo, borrador en la sesión, revisión de lo que se creará y resultado honesto si el administrador inicial queda pendiente. Confirmaciones dentro de la app en lugar de `confirm()`. Sin cambios en base de datos, RPC, autoridad, POS ni Demo. Sin push ni despliegue.

## UX Wave D.2: cierre de caja y catálogo de cafetería (local)

- **Cierre administrativo excepcional** en una tarea guiada: Detalles → Revisar (contado, esperado actual, diferencia estimada) → «Cerrar caja con RD$ X» → resultado guardado por PIKAS (Contado, Esperado, Diferencia: Cuadrada/Sobrante/Faltante). Se envía exactamente el esperado revisado, así que un esperado desactualizado sigue rechazándose. Por decisión del propietario (Opción A) se conserva la semántica de Phase 5A; el cierre ciego del POS no cambia y un cierre administrativo ciego queda para Wave E.
- **Productos**: búsqueda, filtros de categoría y estado, orden por nombre o precio, tarjetas y estados vacíos distintos para «sin productos» y «sin resultados». Crear y editar en una tarea con revisión, «Crear otro producto» y borradores opcionales solo en esta pestaña (nunca se envían solos). La carga de fotos aún no está disponible.
- **Importar CSV**: plantilla, vista previa con las filas listas y las que necesitan atención, y «Importar N productos». Cada producto se registra por separado; el resultado indica cuántos se agregaron, cuáles se rechazaron y si la importación se detuvo en una fila sin confirmar.
- **Menús y turnos** en tareas enfocadas con selector de productos (búsqueda, categoría, seleccionados); sin `confirm()` del navegador. Sin cambios en base de datos, RPC, autoridad, POS ni compras históricas. Sin push ni despliegue.

## UX Wave D.1: tareas guiadas de PIKAS Cash (local)

- **Recarga**, **Ajuste administrativo** y **Reversión de recarga** son ahora tareas enfocadas: Detalles → Confirmar → acción final explícita («Recargar RD$ 500.00», «Aplicar ajuste −RD$ 100.00», «Revertir recarga de RD$ 25.00»), con estados claros de registro, éxito, rechazo y «pendiente de confirmar». Desaparecen el formulario permanente de recarga y el `confirm()` del navegador.
- Al cerrar con datos escritos se pide descartarlos; mientras se registra no se puede cerrar ni enviar dos veces. Nada de lo escrito se guarda: al recargar la página no se recupera, y una operación incierta solo se reintenta con la misma solicitud cuando el usuario lo pide.
- En móvil la tarea ocupa toda la pantalla con la acción principal al alcance. El foco entra en la tarea, se mantiene dentro y vuelve al botón que la abrió.
- Sin cambios en autoridad, cálculos, rutas, RPC, base de datos ni en el Demo. Sin push ni despliegue.

## UX Wave C: shell administrativo unificado (local)

- PIKAS Admin, Cuenta, Escuela y Cafetería comparten un mismo shell: identidad PIKAS Admin, área y contexto actual (escuela/cafetería), navegación según permisos, cuenta y **Cerrar sesión** en un solo lugar. En móvil: barra superior de 56 px, menú de cuenta y navegación inferior con «Más»; Cafetería prioriza Transacciones, Cajas y Reportes. El POS sigue siendo un espacio de trabajo propio.
- Encabezados de página consistentes (el título coincide con la navegación; enlace de regreso solo en páginas de detalle), estados vacíos/errores con reintento, métricas y tabla responsiva de Clientes.
- Sesión: pantalla clara de «Tu sesión terminó» con el acceso correcto, cuenta regresiva en el aviso y mensaje en `/login` para accesos escolares denegados. Ninguna operación se repite.
- La navegación móvil queda oculta mientras hay un diálogo modal. El Demo, la autoridad, los cálculos financieros y la base de datos no cambian. Sin push ni despliegue.

## UX Foundation B.1: navegación de PIKAS Admin (local)

- Navegación de PIKAS Admin: **Inicio · Clientes · Equipo · Demo**, cada destino según su capacidad de plataforma. «Crear cliente» deja la barra y sigue disponible en Inicio y en Clientes.
- **Inicio** ofrece tarjetas a Clientes, Nuevo cliente, Equipo y Demo solo cuando el operador tiene la capacidad correspondiente; un operador solo de Demo ve únicamente Demo.
- Clientes acepta identificadores bien formados aunque no sean RFC 4122 (fixtures locales), en lugar de ocultar toda la lista. Sin cambios de autoridad, base de datos ni del flujo Demo. Sin push ni despliegue.

## UX Foundation B: entorno Demo persistente (local)

- **Demo** en la navegación de PIKAS Admin → **Explorar PIKAS**, con Escuela y Cafetería en Administración, Caja / POS en Operaciones y Padre/Estudiante como tarjetas no interactivas «Próximamente».
- Una barra Demo compartida permite cambiar de experiencia directamente y **Salir del demo** conserva la sesión del operador. El servidor acepta solo un código de experiencia y reutiliza la autoridad, las personas ficticias, la sustitución auditada y la vigencia de cuatro horas existentes.
- El POS permite dejar su caja abierta; pide confirmar el descarte de venta/pago/conteo sin enviar y bloquea el cambio/salida si hay una operación sin confirmar. No se conservan borradores financieros ni se reenvían operaciones automáticamente. Las pestañas obsoletas muestran una explicación con continuación segura.
- Encabezados Demo compactos; enlace genérico a PIKAS Admin en `/login`; Cajas presenta Sobrante/Faltante/Cuadrada con `MoneyValue`; el resumen escolar ya reconoce PIKAS Cash.
- Sin cambios de DB/esquema/RLS, Waves C–F ni Phase 5D.4–5D.6. Solo commit local, sin push ni despliegue. Arquitectura, decisiones OD-B1–OD-B11 y evidencia en el [registro de implementación](UX_UI_PRODUCT_ARCHITECTURE_AUDIT.md#23-ux-foundation-b--local-implementation-record).

## Phase 5D.3: conciliación de caja (local)

- Reportes de cafetería → **Conciliación de caja** en el mismo período: sesiones cerradas, cuadradas, con faltante y con sobrante (solo conteos; faltantes y sobrantes nunca se compensan), y la lista de sesiones cerradas con esperado, contado y diferencia (contado − esperado), con desglose bajo "Ver desglose".
- Los valores son la captura inmutable de Phase 5A al cierre; nada se recalcula. Un cierre anterior a la captura se marca "Sin captura al cierre". **Cajas abiertas ahora** se muestra aparte, como estado actual sin conciliar.
- Nuevo tipo `reconciliation` en `cafeteria_report_read` (migración aditiva `202610230001_cafeteria_reconciliation_report.sql`), con la autoridad existente de lectura de sesiones de Caja y sin índice nuevo. Sin cambios en POS ni en el cierre ciego. Sin push ni despliegue. Detalle en el [plan Phase 5D](PHASE_5D_REPORTING_PLAN.md).

## Phase 5D.2: productos principales (local)

- Reportes de cafetería → **Productos principales**: hasta 10 productos por unidades netas (vendidas − reembolsadas) del mismo período seleccionado. Los reembolsos cuentan en su propia fecha, así que un período solo con reembolsos puede mostrar unidades netas negativas.
- Desempate por identificador de producto. Los reembolsos sin detalle por artículo (anteriores a 5C.1) no se asignan a productos y se señalan. Se muestra el nombre del producto registrado en la compra más reciente del período.
- Nuevo tipo `top_products` en `cafeteria_report_read` (migración aditiva `202610220001_cafeteria_top_products_report.sql`), con la misma autoridad y sin índice nuevo. Sin push ni despliegue. Detalle en el [plan Phase 5D](PHASE_5D_REPORTING_PLAN.md).

## Phase 5D.1: base de reportes + resumen de ventas (local)

- Decisiones D1–D13 del propietario resueltas en el [plan Phase 5D](PHASE_5D_REPORTING_PLAN.md). Escuela y cuenta no ven ventas de cafetería; los reembolsos se reportan en la fecha en que ocurren.
- Administración de cafetería → **Reportes**: Ventas brutas, Reembolsos, Ventas netas (puede ser negativa), Transacciones, Ticket promedio (bruto) y Método de pago. Períodos Hoy, 7 días, 30 días (predeterminado) y personalizado de hasta 92 días, en fechas de operación de la escuela.
- Función de solo lectura `cafeteria_report_read`, con la autoridad existente de lectura de compras. Migración aditiva `202610210001_cafeteria_sales_report.sql`, sin índice nuevo. PIKAS Cash y el efectivo de caja no se mezclan con ventas. 5D.2–5D.6 no implementados. Sin push ni despliegue.

## UX Foundation A: fundamentos UX previos a Phase 5D (local)

- F01 resuelto: la administración de cafetería llega a **PIKAS Cash** (saldos de clientes compartidos y ajustes administrativos acotados ya aceptados) desde la navegación lateral y el menú móvil "Más". Visible solo con la lectura `cafeteria:wallets:read` derivada del servidor en tenants de cliente; misma ruta, sin cambios de autoridad, RLS, RPC ni reglas financieras.
- Semántica monetaria compartida (`movement` / `balance` / `amount`): recargas `+` en verde, deducciones `−` en rojo, saldos neutros salvo negativos; nunca solo por color. Aplicada al saldo y movimientos PIKAS Cash y a la consulta de cafetería.
- Terminología canónica (PIKAS Cash, Recarga, Reembolso, Reversión de recarga, Ajuste administrativo, Saldo, Movimientos, Caja, Actividad, Reportes) y distinción de arquitectura de información para Phase 5D en [UX_FOUNDATIONS.md](UX_FOUNDATIONS.md). Correcciones puntuales: "monedero" → PIKAS Cash en superficies tocadas; método de pago "Saldo PIKAS" → "PIKAS Cash" en Transacciones de cafetería.
- Sin rediseño: el resto de la [auditoría UX/UI](UX_UI_AUDIT_PRE_PHASE_5D.md) sigue diferido. Sin push ni despliegue.

## Cierre de aceptación productiva Phase 5C.3 — capa de correcciones Phase 5C completa

- **PHASE 5C.3 — COMPLETE / PRODUCTION ACCEPTED**, congelado. Source `07a1b928096fbc1f5731a2e7b1847dfe5ae8f238`; migración `202610200001_administrative_wallet_adjustments.sql`. [Evidencia y reglas finales](PHASE_5C3_ADMINISTRATIVE_ADJUSTMENTS.md).
- Un único ajuste +RD$25.00 "Corrección administrativa" por Administrador Ficticio Beta (Administración de cuenta) sobre Sol Ficticia Beta: RD$0.00 → RD$25.00, explicación y atribución preservadas; sin operación de caja ni movimientos adicionales.
- 5C.1, 5C.2 y 5C.3 aceptados y congelados: la capa de correcciones definida para Phase 5C está completa. Diferidos: soporte PIKAS autorizado por el cliente, aprobaciones, umbrales, alertas, notificaciones y analítica de ajustes.
- Observaciones de producción del monedero añadidas a la auditoría UX/UI del [roadmap](MVP.md). Cierre exclusivamente documental; sin despliegue.

## Phase 5C.3: ajustes administrativos de monedero (local)

- Ajustes positivos y negativos para correcciones excepcionales, como nuevo movimiento inmutable del ledger; nunca se sobrescribe un saldo. Motivo y explicación escrita obligatorios; se registran actor, rol real, alcance, saldo antes/después y evidencia idempotente.
- Autoridad: administración de cuenta (su cuenta), escolar (su escuela) y de cafetería (solo estudiantes conectados a su cafetería). Supervisor, cajero, Plataforma y POV sandbox sin autoridad. Sin aprobación obligatoria en Beta; ajustes de soporte PIKAS autorizados por el cliente diferidos.
- Saldo negativo permitido; compras con PIKAS Cash siguen bloqueadas por la regla de saldo suficiente; sin impacto en el efectivo de caja. Migración aditiva `202610200001_administrative_wallet_adjustments.sql`; [detalle](PHASE_5C3_ADMINISTRATIVE_ADJUSTMENTS.md). Sin acceso productivo, push ni despliegue.

## Cierre de aceptación productiva Phase 5C.2

- **PHASE 5C.2 — COMPLETE / PRODUCTION ACCEPTED**, congelado. Source `9f228dc97de268c01d45290fa8adeb488ef48b8e`; migración `202610190001_replenishment_reversals.sql`. [Evidencia y reglas finales](PHASE_5C2_REPLENISHMENT_REVERSALS.md).
- Una única reversión controlada de la recarga de aceptación Phase 5B (RD$25.00, `ACEPTACION-5B`): original intacta y marcada "Revertida", reversión enlazada con actor y motivo, saldo RD$0.00. Saldo negativo no reproducido en producción (cubierto localmente).
- Phase 5C no completa: 5C.3 diferido. Auditoría UX/UI ampliada con nuevas observaciones en el [roadmap](MVP.md). Cierre exclusivamente documental; sin push ni despliegue.

## Phase 5C.2: reversión de recargas (local)

- Administración de cuenta y escolar pueden revertir una recarga verificada errónea: nuevo evento negativo inmutable enlazado, por el monto exacto original, una sola vez; la recarga original no cambia y ambos movimientos quedan visibles.
- El saldo PIKAS Cash puede quedar negativo; las compras con PIKAS Cash siguen bloqueadas por la regla de saldo suficiente hasta que recargas legítimas lo cubran. Sin impacto en el efectivo de caja. Motivo obligatorio ("Otro" exige explicación).
- Corrige el desbordamiento del guardia de recarga/ajuste con saldo negativo. Migración aditiva `202610190001_replenishment_reversals.sql`; [detalle](PHASE_5C2_REPLENISHMENT_REVERSALS.md). Phase 5C no completa: 5C.3 diferido. Sin acceso productivo, push ni despliegue.

## Cierre de aceptación productiva Phase 5C.1

- **PHASE 5C.1 — COMPLETE / PRODUCTION ACCEPTED**, congelado. Source `f2433884c3eb92b0ba85aa3ffa064776f74c6a85`; migraciones `202610180001_controlled_purchase_refunds.sql` y `202610180002_refine_refund_limits_cash_shortfall.sql`. [Evidencia y reglas finales](PHASE_5C1_REFUNDS.md).
- Reembolso controlado en efectivo de RD$25.00 del recibo #2 en BETA-01 (sesión nueva; la sesión cerrada de Phase 5A no se tocó): recibo intacto, reembolso enlazado, estado acumulado persistente, efectivo esperado de vuelta a RD$3,000.00. Sin transacciones adicionales.
- Phase 5C no completa: 5C.2 y 5C.3 diferidos. Auditoría UX/UI transversal registrada como elemento futuro en el [roadmap](MVP.md). Cierre exclusivamente documental; sin push ni despliegue.

## 2026-10-18 — Phase 5C.1: reembolsos controlados (local)

- Reembolsos por artículo desde el POS: varios eventos por compra sin exceder cantidad ni total; recibo original inmutable. Efectivo sale de la caja abierta actual (nunca se reescribe una caja cerrada); PIKAS Cash vuelve al monedero con asiento de ledger enlazado.
- Cajero sin autorización solo dentro de 5 minutos y de sus límites diarios (cantidad y monto, configurables por administrador de cafetería o supervisor POS). Si no, autorización del supervisor o administrador en el mismo dispositivo, sin cerrar la sesión del cajero; se auditan iniciador, aprobador y motivo del override.
- Correcciones del propietario (`202610180002`): todos los reembolsos iniciados por el cajero, incluidos los autorizados, cuentan en sus totales diarios (los límites solo acotan su autonomía); un reembolso en efectivo puede dejar el efectivo esperado en negativo con autorización (`cash_shortfall`) en lugar de rechazarse. El reintento exacto devuelve el reembolso original aunque haya agotado la línea.
- Motivo obligatorio ("Otro" exige explicación). Migración aditiva `202610180001_controlled_purchase_refunds.sql`; [modelo, autoridad y validación](PHASE_5C1_REFUNDS.md).
- Phase 5C no está completa: 5C.2 (reversión de recargas) y 5C.3 (ajustes, aprobaciones, notificaciones) diferidos. Sin acceso productivo, push ni despliegue.

## 2026-10-17 — Cierre de aceptación productiva Phase 5B

- **PHASE 5B — COMPLETE / PRODUCTION ACCEPTED**. Source `e05cf5f27f17733ea26a13bf089ce0ccb654c8b5`, migraciones alineadas hasta `202610170001_beta_wallet_authority.sql`. [Evidencia canónica](PRODUCT_BASELINE.md).
- Resuelto el bloqueo de autoridad del administrador de cuenta observado en la primera activación. La política Beta de autoridad PIKAS Cash queda aceptada.
- Recarga controlada `manual_verified` de RD$25.00 (Sol Ficticia Beta): saldo RD$0.00 → RD$25.00, un único movimiento, persistencia tras recargar la página. Sin segunda recarga.
- Phase 5C no iniciada; el soporte de Plataforma autorizado por el cliente sigue diferido. Cierre exclusivamente documental; sin push ni despliegue.

## 2026-10-17 — Phase 5B: política Beta de autoridad PIKAS Cash (local)

- La aceptación productiva mostró que el administrador inicial de un cliente nuevo (`account_admin`, sin autoridad financiera desde Phase 4D.2) no podía abrir PIKAS Cash. El propietario definió la política Beta.
- Administrador de cuenta: lectura + recarga `manual_verified`, sin `manage`/`adjust`. Administrador escolar: sin cambios. Administrador de cafetería: solo saldo de clientes compartidos, sin recargas (se retira la antigua capacidad de recarga de cafetería). Plataforma: sin acceso permanente; soporte temporal autorizado por el cliente diferido. POS: solo uso operativo.
- UI según capacidad del servidor: enlace, página y formulario de recarga solo con autoridad; consulta de saldo de solo lectura en "Escuelas conectadas" de cafetería. [Detalle y validación](PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md), [política](ADMINISTRATION_AND_PERMISSIONS.md).
- Migración aditiva `202610170001_beta_wallet_authority.sql`. Sin acceso productivo, push o despliegue; sin Phase 5C.

## 2026-10-16 — Phase 5B: PIKAS Cash / operaciones de monedero (local)

- PIKAS Cash en el perfil estudiantil de Administración Escolar: saldo autoritativo, historial del monedero con recargas y compras POS (recibo y productos) y recarga manual verificada con confirmación explícita.
- Reutiliza monedero, ledger inmutable, `manual_verified` y capacidades escolares existentes; revalida autoridad tras la espera del bloqueo; reintento exacto y recuperación de éxito perdido.
- Migración aditiva `202610160002_wallet_operations.sql`; [modelo, contratos y validación](PHASE_5B_PIKAS_CASH_WALLET_OPERATIONS.md). Documentación canónica actualizada (README, línea base, catálogo, MVP).
- Las recargas no son efectivo de caja ni amplían límites de gasto. Sin reembolsos/reversiones (Phase 5C). Sin acceso productivo, push o despliegue; Phase 5 no está completa.

## 2026-10-16 — Cierre de aceptación productiva Phase 5A

- **PHASE 5A PRODUCTION ACCEPTANCE PASS WITH ONE DOCUMENTED FOLLOW-UP**. [Evidencia y seguimiento canónicos](PRODUCT_BASELINE.md).
- Source `d2fdd6888a53e8571550423f4bffd5876e94883e`, deployment `dpl_ET7gUF21YZUpXnVzTBP3863EmzV2`, migraciones alineadas hasta `202610160001`, según checkpoint de activación confirmado por el propietario.
- Historial/recibo #1 y sesiones operativos; BETA-01 cerrada explícitamente con esperado/contado/diferencia RD$25.00/RD$25.00/RD$0.00. Persistencia tras recarga y recibo intacto verificados por UI.
- Rechazo POS tras cierre probado localmente; la re-verificación UI productiva no se ejecutó por falta de acceso al cajero ficticio ya activado con correo .invalid. Recuperación normal devolvió respuesta condicional; no constituye fallo funcional de Phase 5A.
- Único seguimiento: verificar durante una futura sesión controlada de producción/piloto con credenciales válidas, sin reabrir ni mutar BETA-01 completada. Sin ventas/sesiones adicionales ni acceso/mutación de Horizonte. Phase 5B no iniciada.
- Cierre exclusivamente documental; sin más recuperación de credenciales ni mutaciones en producción.

## 2026-10-16 — Phase 5A: operaciones de transacciones y caja (local)

- Historial conectado de compras/recibos y sesiones; cierre administrativo excepcional con confirmación, contado/esperado/diferencia y captura inmutable para nuevos cierres.
- Reintento exacto y recuperación de éxito perdido; rechazo de esperado obsoleto y ventas contra sesión cerrada. Capacidades y fronteras sandbox existentes conservadas.
- Migración aditiva `202610160001_transaction_register_operations.sql`; [decisiones, contratos y validación](PHASE_5A_TRANSACTION_REGISTER_OPERATIONS.md). `CLAUDE.md` añade guía durable de ingeniería.
- No completa Phase 5; sin nuevas recargas/refunds conectadas, reporting amplio ni analytics. Sin acceso productivo, push o despliegue.

## 2026-10-15 — Cierre de Phase 4D: Production Administration & Provisioning

- **STATUS: COMPLETE** · **Production acceptance: PASSED**. Cliente ficticio nuevo incorporado y operado mediante PIKAS hasta una venta No Usuario + Efectivo confirmada, sin intervención de desarrollador/base de datos.
- Línea base aceptada: rama `Pikas_demo`, source `df802b530b3cab4a92140f7d7b9a025e36f2b9c7`, deployment `dpl_4pLUTkodjv4qpNEpxDDUNeu3L8E4`, migraciones alineadas hasta `202610150001_cafeteria_staff_activation.sql`, dominio `pikas-pikas.app`.
- Recibo #1, compra `daccc804-d8e1-4ef1-9789-99156075fe50`: 1 Agua Ficticia Beta 4D.8, total RD$25.00, recibido RD$50.00, cambio RD$25.00.
- [Evidencia y componentes completos 4D.1–4D.8](PRODUCT_BASELINE.md), incluido el seguimiento de Sol Ficticia Beta no devuelta por búsqueda POS. No bloqueó el camino aceptado No Usuario + Efectivo. Reautenticación por timeout: política esperada.
- Phase 4D queda como línea base congelada; cambios posteriores requieren defecto confirmado o función aprobada y regresiones dirigidas. Migraciones comprometidas inmutables.
- Próxima fase planificada: [Phase 5 — Financial Operations & Visibility](MVP.md), sin iniciarla.
- Cierre exclusivamente documental, sin nueva versión de paquete, cambios de código/migraciones ni despliegue.

## 2026-09-24 — PIKAS 0.6.5: selección de productos en POS

- Reorganización espacial del desktop POS: Cliente, Top 5 y Productos forman una columna de selección; Venta actual permanece como columna de transacción dedicada.
- Top 5 conservado como tira horizontal acotada y Productos mantiene controles estables, resultados con scroll independiente y continuidad de catálogo.
- Sin cambios a lógica de recomendaciones, catálogo, checkout, pagos, límites, reembolsos, permisos o contabilidad.

## 2026-09-24 — PIKAS 0.6.4: workspace operativo de cafetería

- Workspace Venta más denso en desktop/tablet: Cliente y Productos quedan en la columna izquierda; Top 5 y Venta actual en la derecha, con carrito visible.
- Top 5 compacto con desplazamiento horizontal acotado, controles de catálogo estables y resultados de productos con scroll independiente.
- CTA de pago reforzado, confirmación final con resumen de compra y señal sonora sutil solo después de una venta exitosa.
- Calculadora presentada como utilidad circular, estado de conexión al extremo derecho del footer y filtros operativos de Transacciones para efectivo, saldo PIKAS, reembolsos y recargas.
- Se conserva el comportamiento financiero, autorización, catálogo, reembolsos, recibos, impresión y regresiones de 0.6.3.

## 2026-09-24 — PIKAS 0.6.3: flujo POS, recibos y reembolsos

- Venta y Transacciones quedan como espacios de trabajo claros; el contexto de cliente, Top 5, recargas elegibles, carrito actual y calculadora permanecen accesibles sin competir con la operación.
- Catálogo con vistas Gallery/List, navegación List alfabética, búsqueda, categorías dinámicas, filas compactas sin imágenes y tarjetas Gallery verticales corregidas.
- Top 5 cafetería y accesos de contexto del cliente se mantienen como atajos compactos, con restricciones, disponibilidad, cantidades y carrito persistente preservados.
- Historial muestra estados derivados Completada, Reembolso parcial y Reembolsada sin mutar compras originales.
- Flujo de reembolso guiado con revisión y confirmación explícita; se preservan permisos, aprobación, destinos efectivo/saldo, contabilidad, same-day spending, protección acumulada e idempotencia.
- Recibos de venta refinados, recibos dedicados de reembolso vinculados a la venta original y datos históricos preservados.
- Impresión y reimpresión mediante el diálogo del navegador para recibos de venta y reembolso, con estilos de impresión que aíslan únicamente el recibo.
- Cobertura E2E de navegación, catálogo, vistas, recomendaciones, carrito, estados, recibos, reembolsos, impresión y regresiones financieras.
- Estabilización de selectores de pruebas para el flujo de alto volumen; no representa una funcionalidad ni un cambio de reglas del producto.

## 2026-09-24 — PIKAS 0.6.2: refinamientos UX del POS

- Barra de estado/footer persistente y compacta para conexión, contexto, turno, transacciones y ventas según la visibilidad configurada.
- Indicador de conexión basado en el estado real, con pulso Online accesible y respeto por reduced motion.
- Encabezado POS simplificado, conservando identidad, ubicación, caja y controles del cajero.
- Calculadora flotante como utilidad independiente, con ventana arrastrable, teclado físico, foco y accesibilidad mejorados.
- La calculadora permanece aislada del carrito, pagos, totales, saldos, cambio y demás estado transaccional.
- Cobertura E2E del footer, estados de conexión, visibilidad, calculadora, arrastre, responsive, foco y aislamiento transaccional.
- Estabilización determinista del recorrido E2E familiar en tablet mediante espera explícita del render de Estudiantes; no es una funcionalidad del producto ni una corrección de regresión.

## 2026-09-23 — PIKAS 0.6.1: correcciones de auditoría

- Códigos únicos en creación/regeneración, selección por ID estable y lookup ambiguo rechazado.
- Todos los escritores demo confirman sesión y autorización vigente bajo Web Locks; admin obsoleto pierde autoridad.
- Proyección de cliente POS por eligibility/balance/limits/restrictions/transactions, con validación independiente de checkout.
- Recuperación por clave completada antes de límites de nueva compra; bloqueos parentales sincronizados.
- Fallos HTTP de sesión producen Sync Issue con recuperación explícita.
- Hoy usa fecha Santo Domingo; conciliación separa ventas, recargas, refunds y cierre; actividad muestra monto/destino de refund efectivo.
- Regresiones de auditoría, permisos negativos, dos carritos válidos concurrentes, reintentos y refunds; waits de sesión/hidratación y descarga deterministas.
- Corrección local sobre `Pikas_demo`; sin push, despliegue, migraciones aplicadas o trabajo 0.7.0. Resultados y archivos: [informe 0.6.1](IMPLEMENTATION_061.md).

## 2026-09-22 — PIKAS 0.6.0: caja guiada y eventos financieros

- POS por tipo de cliente, búsqueda mínima por nombre/código, carrito conservado al cambiar identidad y validación/pago explícitos.
- Shell persistente con estado, ubicación, cajero, contexto y tema personal; calculadora y consulta compartida en herramientas.
- Top 5 + Top 5 sin duplicados, ventanas 30/90 días y escenario histórico ficticio opcional.
- Límites diarios individuales ON/OFF. Efectivo identificado también consume límite; recargas no lo amplían.
- Recargas independientes, cambio automático, recibido obligatorio y ausencia de pagos divididos.
- Política de visibilidad separada de autoridad. Refund de caja OFF, parcial OFF, motivo/aprobación ON por defecto.
- Refund completo/parcial por importe, vinculado al original inmutable y atribuido a actor/aprobador; detalle familiar.
- Devolución del mismo día restaura capacidad diaria; devolución histórica solo devuelve fondos. Zona Santo Domingo.
- Mutaciones demo serializadas con Web Locks, idempotencia y relectura del estado; bloqueo offline y errores de sincronización.
- Preórdenes conservadas con validación actual y escritura serializada. Reportes/caja incluyen recargas y refunds.
- Migración local para políticas, alcance, eventos append-only y solicitudes familiares preparadas/deshabilitadas. **No aplicada ni verificada en PostgreSQL.**
- Validación local: lint, TypeScript, 42 unitarias, 87 E2E (390/768/1440 px) y build. Capturas actuales en guía demo.
- Sin push, PR, merge, despliegue, cambios de variables ni acceso/modificación de datos Supabase.

Límites: finanzas 0.6 demo; escritor/RPC remoto, pruebas RLS/concurrencia PostgreSQL, solicitudes familiares, ajustes administrativos, refund por unidades y cierre durable de turnos siguen pendientes. [Modelo financiero](POS_FINANCIAL_MODEL.md).


## 2026-08-27 — PIKAS 0.5.3: POS, caja y atribución

- PIKAS es identificada públicamente como diseñada y desarrollada por Palmchat Innovations LLC en landing y accesos.
- POS separa Ventas PIKAS, Cash — Student-linked y Cash — General sale.
- Las ventas PIKAS exigen verificación y aplican saldo, límites, disponibilidad, alergias y bloqueos.
- El efectivo asociado conserva restricciones estudiantiles sin afectar saldo ni límites; el efectivo general no crea asociación estudiantil.
- Cada compra registra método, asociación, impacto de saldo, impacto de caja, efectivo recibido, cambio, cajero, estación y estado.
- Cafetería recibe tarjetas operativas compactas, filtros, exportación CSV y conciliación entre cierre esperado y conteo ingresado.
- El carrito persiste, la identidad debe verificarse otra vez tras refrescar y Nueva venta limpia rápidamente el POS.
- El crédito efectivo-a-PIKAS permanece desactivado y separado de una venta normal.
- Verificación final: lint, typecheck, 25 pruebas unitarias, 57 E2E responsivas, build y diff check.

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
