import type { CafeteriaRead } from './contracts';

// PIKAS UX 12A: cafetería readiness derived only from the existing cafeteria_admin_read.
// The colegio, sede and cafetería are context PIKAS established; nothing here asks the admin to
// confirm them. The steps are what the Cafetería Admin controls, in management order. "Lista para
// operar" means the prerequisites to begin operating are met: it never requires a sale. Opening a
// caja in the POS (a register session, no money involved) is the only operational validation.
export type ReadinessKey = 'cajas' | 'personal' | 'productos' | 'operacion';
export type ReadinessState = 'complete' | 'pending' | 'attention';
export type ReadinessStep = { key: ReadinessKey; label: string; state: ReadinessState; detail: string; action: { href: string; label: string } | null };
export type ReadinessStatus = 'configuring' | 'ready' | 'operating';
export type CafeteriaReadiness = { steps: ReadinessStep[]; status: ReadinessStatus; next: ReadinessStep | null; complete: number };
export const readinessLabel: Record<ReadinessStatus, string> = { configuring: 'En configuración', ready: 'Lista para operar', operating: 'En operación' };

export const cafeteriaHref = (cafeteriaId: string, path = '') => `/admin/cafeteria${path}?cafeteria=${cafeteriaId}`;
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

// What the admin manages inside the cafetería, as counts for the management map.
export function managedCounts(data: CafeteriaRead) {
  return { cajas: data.registers.filter(r => r.status === 'active').length, personal: data.staff.filter(m => m.status === 'active').length, productos: data.products.filter(p => p.active && p.available).length };
}

export function cafeteriaReadiness(data: CafeteriaRead): CafeteriaReadiness {
  const name = data.scope.cafeteria_name, href = (path: string) => cafeteriaHref(data.scope.cafeteria_id, path);
  const activeRegisters = data.registers.filter(r => r.status === 'active'), activeStaff = data.staff.filter(m => m.status === 'active');
  const assigned = new Set(data.assignments.filter(a => a.status === 'active' && activeStaff.some(m => m.id === a.membership_id) && activeRegisters.some(r => r.id === a.register_id)).map(a => a.membership_id));
  const available = data.products.filter(p => p.active && p.available);
  const pendingInvitations = data.invitations.filter(i => i.status === 'pending').length, expiredInvitations = data.invitations.filter(i => i.status === 'expired').length;

  const cajas: ReadinessStep = activeRegisters.length
    ? { key: 'cajas', label: 'Crear caja', state: 'complete', detail: `${n(activeRegisters.length, 'caja activa', 'cajas activas')}: ${activeRegisters.map(r => r.name).join(', ')}`, action: null }
    : data.registers.length
      ? { key: 'cajas', label: 'Crear caja', state: 'pending', detail: 'Hay cajas, pero ninguna está activa.', action: { href: href('/cajas'), label: 'Revisar cajas' } }
      : { key: 'cajas', label: 'Crear caja', state: 'pending', detail: `Crea la primera caja de ${name}.`, action: { href: href('/cajas'), label: `Crear caja para ${name}` } };

  const personalLabel = 'Agregar personal y asignarlo a una caja';
  const personal: ReadinessStep = assigned.size
    ? { key: 'personal', label: personalLabel, state: 'complete', detail: n(assigned.size, 'persona con caja asignada', 'personas con caja asignada'), action: null }
    : activeStaff.length
      ? activeRegisters.length
        ? { key: 'personal', label: personalLabel, state: 'pending', detail: 'Hay personal POS, pero nadie está asignado a una caja. La asignación se hace en Cajas.', action: { href: href('/cajas'), label: 'Asignar en Cajas' } }
        : { key: 'personal', label: personalLabel, state: 'pending', detail: 'Hay personal POS; se asigna a una caja cuando exista la primera.', action: null }
      : pendingInvitations
        ? { key: 'personal', label: personalLabel, state: 'pending', detail: `${n(pendingInvitations, 'acceso preparado espera', 'accesos preparados esperan')} activación.`, action: { href: href('/personal'), label: 'Ver personal POS' } }
        : expiredInvitations
          ? { key: 'personal', label: personalLabel, state: 'attention', detail: `${n(expiredInvitations, 'acceso preparado venció', 'accesos preparados vencieron')} sin usarse.`, action: { href: href('/personal'), label: 'Preparar de nuevo' } }
          : { key: 'personal', label: personalLabel, state: 'pending', detail: 'Agrega al menos una persona de caja.', action: { href: href('/personal'), label: `Agregar personal a ${name}` } };

  // Scheduling on: the POS needs an active menu with products and an enabled shift for it. Whether a
  // shift is active right now is operation, not readiness; an invalid configuration needs attention.
  const scheduling = data.settings.scheduling_enabled, activeMenus = data.menus.filter(m => m.active && m.product_ids.length > 0);
  const scheduled = activeMenus.length > 0 && data.shifts.some(s => s.enabled && activeMenus.some(m => m.id === s.menu_id));
  const invalid = data.service?.status === 'invalid_configuration';
  const productos: ReadinessStep = !available.length
    ? { key: 'productos', label: 'Configurar productos', state: 'pending', detail: 'Agrega productos activos y disponibles para la venta.', action: { href: href('/productos'), label: `Administrar productos de ${name}` } }
    : invalid
      ? { key: 'productos', label: 'Configurar productos', state: 'attention', detail: 'La programación de turnos y menús no es válida: revísala.', action: { href: href('/menus/turnos'), label: 'Revisar turnos' } }
      : scheduling && !scheduled
        ? { key: 'productos', label: 'Configurar productos', state: 'pending', detail: 'La programación está activada: falta un menú activo con productos y un turno habilitado.', action: { href: href('/menus/turnos'), label: 'Configurar turnos' } }
        : { key: 'productos', label: 'Configurar productos', state: 'complete', detail: `${n(available.length, 'producto disponible', 'productos disponibles')} · ${scheduling ? 'menú y turnos configurados' : 'catálogo manual'}`, action: null };

  const prerequisites = [cajas, personal, productos], ready = prerequisites.every(s => s.state === 'complete');
  const opened = activeRegisters.some(r => r.open || r.has_history);
  const operacion: ReadinessStep = !ready
    ? { key: 'operacion', label: 'Preparar la operación', state: 'pending', detail: 'Se habilita al completar los pasos anteriores.', action: null }
    : opened
      ? { key: 'operacion', label: 'Preparar la operación', state: 'complete', detail: 'Ya se abrió una caja en el POS: la cafetería está operando.', action: null }
      : { key: 'operacion', label: 'Preparar la operación', state: 'pending', detail: 'Todo listo. El personal asignado puede abrir una caja desde el POS; no hace falta una venta para estar lista.', action: { href: href('/cajas'), label: 'Ver cajas' } };

  const steps = [...prerequisites, operacion];
  const status: ReadinessStatus = !ready ? 'configuring' : opened ? 'operating' : 'ready';
  const next = steps.find(s => s.state === 'attention') ?? steps.find(s => s.state !== 'complete') ?? null;
  return { steps, status, next, complete: steps.filter(s => s.state === 'complete').length };
}
