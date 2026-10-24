// Public site copy (Brand & Public Experience). Spanish is the primary market language; the copy lives in one
// object so an English edition can be added as a sibling without touching the components.
// Truthfulness rule: everything below describes released behavior. Planned capabilities appear only in
// `pikasCash.notYet`, worded as not available.
import type { ShotId } from "./shots.generated";

export const site = {
  meta: {
    title: "PIKAS | La cafetería escolar, por fin conectada",
    description: "PIKAS conecta las personas, la operación y el dinero detrás de la cafetería escolar: el colegio, la cafetería, el punto de venta y PIKAS Cash, con la información correcta para cada persona.",
  },
  nav: [
    { href: "#producto", label: "Producto" },
    { href: "#como-funciona", label: "Cómo funciona" },
    { href: "#colegios", label: "Colegios" },
    { href: "#cafeterias", label: "Cafeterías" },
    { href: "#pikas-cash", label: "PIKAS Cash" },
    { href: "#contacto", label: "Contacto" },
  ],
  signIn: "Iniciar sesión",
  hero: {
    eyebrow: "Plataforma para la cafetería escolar",
    title: ["La cafetería escolar,", "por fin conectada."],
    lede: "PIKAS conecta el colegio, la cafetería y el punto de venta en una sola operación, con la información correcta para cada persona.",
    primary: { href: "#como-funciona", label: "Ver cómo funciona" },
    secondary: { href: "#contacto", label: "Solicitar información" },
    connects: ["Colegio", "Cafetería", "Punto de venta", "PIKAS Cash"],
  },
  fiction: "Pantallas reales de PIKAS con datos ficticios del colegio de demostración Colegio Horizonte.",
  system: {
    eyebrow: "Cómo funciona",
    title: "Una plataforma, distintas responsabilidades.",
    lede: "Conectado no significa que todos vean todo. PIKAS une el trabajo del colegio, la cafetería y la caja, y le da a cada uno la vista que necesita.",
    roles: [
      { who: "PIKAS", verb: "ve la red", text: "Pone en marcha cada colegio y cafetería, y acompaña su operación sin entrar en el negocio de nadie." },
      { who: "El colegio", verb: "ve a sus estudiantes", text: "Registra estudiantes, decide qué cafetería los atiende y administra su PIKAS Cash." },
      { who: "La cafetería", verb: "ve su negocio", text: "Prepara productos, cajas y personal, y sigue sus ventas, cierres y reportes." },
      { who: "El punto de venta", verb: "hace la venta", text: "Encuentra al estudiante, arma el pedido, cobra y entrega un recibo." },
    ],
    flow: [
      { from: "Colegio", to: "Cafetería", what: "comparte a los estudiantes habilitados" },
      { from: "Cafetería", to: "Punto de venta", what: "prepara catálogo, cajas y personal" },
      { from: "Punto de venta", to: "Historial", what: "registra cada venta con su recibo" },
    ],
  },
  story: {
    eyebrow: "Producto",
    title: "Así se ve un día de cafetería con PIKAS.",
    steps: [
      { id: "colegio", label: "Colegio", title: "El colegio prepara a sus estudiantes", text: "Estudiantes, grado y matrícula en un solo lugar. El colegio decide qué cafetería puede atenderlos, sin hojas de cálculo sueltas.", shot: "colegio-estudiantes", mobile: "colegio-estudiantes-m", alt: "Pantalla Estudiantes de PIKAS con cuatro estudiantes ficticios, su grado, su estado y el acceso a PIKAS Cash." },
      { id: "cafeteria", label: "Cafetería", title: "La cafetería pone su operación en marcha", text: "La cafetería sabe qué administra y qué le falta: cajas, personal con acceso y productos, con una guía de puesta en marcha.", shot: "cafeteria-hoy", mobile: "cafeteria-hoy-m", alt: "Pantalla Hoy de la cafetería: colegio, sede y cafetería que administra, y la guía de puesta en marcha con sus pasos completos." },
      { id: "pos", label: "Punto de venta", title: "La fila avanza en el punto de venta", text: "El cajero busca al estudiante por nombre o código, ve su saldo y sus límites, arma el pedido y cobra con PIKAS Cash o en efectivo. Cada venta sale con recibo numerado.", shot: "pos-venta", mobile: "pos-venta-m", alt: "Punto de venta de PIKAS con una estudiante seleccionada, su saldo PIKAS Cash y sus límites, el catálogo y una venta en curso de tres productos." },
      { id: "resumen", label: "Seguimiento", title: "El colegio sigue lo que importa", text: "Estudiantes activos, monederos, saldo total y lo que necesita atención, en un resumen pensado para el colegio.", shot: "colegio-resumen", mobile: "colegio-resumen-m", alt: "Resumen del colegio en PIKAS: estudiantes activos, monederos PIKAS Cash, saldo total y la lista para atender estudiantes." },
      { id: "cajas", label: "Control", title: "Cajas y personal, en orden", text: "Cada caja tiene su personal autorizado y su historial de sesiones. Cada cierre registra lo esperado, lo contado y la diferencia.", shot: "cafeteria-cajas", mobile: "cafeteria-cajas-m", alt: "Pantalla Cajas de la cafetería con una caja activa, su personal autorizado y el historial de caja." },
    ] satisfies { id: string; label: string; title: string; text: string; shot: ShotId; mobile?: ShotId; alt: string }[],
  },
  schools: {
    eyebrow: "Para colegios",
    title: "Sus estudiantes, sus reglas.",
    lede: "El colegio tiene a la vista lo que le toca administrar, sin tener que operar la cafetería.",
    items: [
      { title: "Estudiantes y matrícula", text: "Créalos uno por uno o impórtalos desde un archivo CSV. Busca y filtra por grado, sede y estado." },
      { title: "Cafeterías conectadas", text: "Decide qué cafetería atiende a tus estudiantes y quiénes están habilitados para comprar." },
      { title: "PIKAS Cash por estudiante", text: "Saldo e historial de cada monedero, con recargas registradas con una referencia verificada." },
      { title: "Correcciones con responsable", text: "Reversiones y ajustes con motivo, rol y saldo anterior a la vista." },
      { title: "Administradores y actividad", text: "Quién administra el colegio y qué cambió, en un historial claro." },
      { title: "Reportes", text: "Movimientos de PIKAS Cash por período, listos para imprimir o exportar." },
    ],
    note: "La venta, las cajas y el catálogo quedan en manos de la cafetería. Cada responsabilidad en su lugar.",
  },
  cafeterias: {
    eyebrow: "Para cafeterías",
    title: "Su negocio, claro y bajo control.",
    lede: "Todo lo que la cafetería necesita para vender cada día, y nada que no le corresponda.",
    items: [
      { title: "Hoy", text: "Ventas del día, cajas abiertas y lo que necesita atención, en cuanto abres PIKAS." },
      { title: "Productos y menús", text: "Precios, disponibilidad, categorías e importación desde CSV." },
      { title: "Cajas y personal POS", text: "Crea cajas, da acceso a tu personal en un paso y decide quién usa cada caja." },
      { title: "Cierre de caja", text: "Efectivo esperado, contado y diferencia en cada cierre, sin recalcular a mano." },
      { title: "Transacciones y reembolsos", text: "Busca un recibo, revisa su detalle y registra reembolsos controlados desde el punto de venta." },
      { title: "Reportes", text: "Ventas, productos más vendidos y conciliación por período." },
    ],
  },
  pikasCash: {
    eyebrow: "PIKAS Cash",
    title: "El saldo escolar, conectado con la cafetería.",
    lede: "Cada estudiante tiene su monedero PIKAS Cash. El colegio lo administra, la cafetería lo usa al cobrar y cada movimiento queda en su historial.",
    today: [
      "Saldo e historial por estudiante.",
      "Recargas registradas por el colegio con una referencia verificada.",
      "Compras en el punto de venta que descuentan el saldo, con recibo.",
      "Límites de gasto que el cajero ve antes de cobrar.",
      "Reversiones y ajustes con motivo y responsable.",
    ],
    notYetTitle: "Lo que todavía no hace",
    notYet: "Las recargas en línea por parte de las familias y los pagos con tarjeta o transferencia aún no están disponibles. Por ahora, las recargas las registra la administración del colegio.",
  },
  trace: {
    eyebrow: "Trazabilidad",
    title: "Un historial que sirve.",
    lede: "Cada acción importante deja un rastro claro: quién la hizo, cuándo y por qué. No para acumular datos, sino para resolver dudas rápido.",
    items: [
      { title: "Accesos", text: "Quién entra, con qué rol y en qué lugar." },
      { title: "Ventas y recibos", text: "Cada venta con su recibo, sus productos y su forma de pago." },
      { title: "Reembolsos", text: "Con motivo y, cuando hace falta, la autorización de un supervisor." },
      { title: "Cierres de caja", text: "Esperado, contado y diferencia, con quién cerró." },
      { title: "PIKAS Cash", text: "Recargas, compras, reversiones y ajustes de cada monedero." },
      { title: "Reportes", text: "Ventas, productos y conciliación por período." },
    ],
  },
  contact: {
    eyebrow: "Contacto",
    title: "¿Quieres PIKAS en tu colegio o cafetería?",
    lede: "Estamos incorporando colegios y cafeterías de forma acompañada. Cuéntanos sobre tu colegio y te mostramos cómo funcionaría en tu operación.",
    write: "Escríbenos",
    fallback: "Si ya trabajas con PIKAS, escribe a tu contacto en el equipo de PIKAS.",
    already: "¿Ya usas PIKAS?",
  },
  footer: {
    line: "La cafetería escolar, por fin conectada.",
    credit: "Diseñado y desarrollado por Palmchat Innovations LLC.",
    copyright: "© 2026 Palmchat Innovations LLC",
  },
} as const;
