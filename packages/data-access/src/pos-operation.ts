import { resolveCafeteriaService, type CafeteriaOperations, type CafeteriaRegister, type CafeteriaScope } from './cafeteria';
import { BUSINESS_TIME_ZONE, type FinancialActor } from './financial';
import type { PosCartLine, PosMenuItemRecord } from './pos';
import type { RegisterSession } from './register-sessions';
export type RegisterGate =
  | { status: 'ready'; session: RegisterSession; register: CafeteriaRegister; message: '' }
  | { status: 'unidentified_cashier' | 'no_authorized_register' | 'register_inactive' | 'other_cashier' | 'no_open_session' | 'invalid_sessions'; session: null; register: CafeteriaRegister | null; message: string };
/** The demo selects caja-1 explicitly. Never substitute another register when access is missing. */
export function resolveRegisterGate(input: { actor?: FinancialActor; allowedRegisterIds: readonly string[]; registers: readonly CafeteriaRegister[]; sessions: readonly RegisterSession[] }): RegisterGate {
  const { actor, allowedRegisterIds, registers, sessions } = input;
  const fail = (status: Exclude<RegisterGate['status'], 'ready'>, message: string, register: CafeteriaRegister | null = null): RegisterGate => ({ status, message, register, session: null });
  if (!actor || !actor.active || actor.role !== 'pos_operator') return fail('unidentified_cashier', 'No hay un cajero POS activo identificado.');
  const register = registers.find(r => r.id === actor.registerId && r.organizationId === actor.organizationId && r.locationId === actor.locationId);
  if (!register || !allowedRegisterIds.includes(register.id)) return fail('no_authorized_register', 'No tienes autorización para esta caja. Solicita acceso a una caja activa.');
  if (!register.active) return fail('register_inactive', 'La caja está inactiva. Consulta con administración.', register);
  const open = sessions.filter(s => s.registerId === register.id && s.organizationId === register.organizationId && s.locationId === register.locationId && s.status === 'open');
  if (open.length > 1) return fail('invalid_sessions', 'La caja tiene varias sesiones abiertas. Revisa su configuración.', register);
  if (!open.length) return fail('no_open_session', 'No hay una sesión de caja abierta. Abre caja para operar.', register);
  if (open[0]!.cashierId !== actor.id) return fail('other_cashier', 'Esta caja está abierta por otro cajero.', register);
  return { status: 'ready', session: open[0]!, register, message: '' };
}
export function resolvePosCatalog(input: { operations: CafeteriaOperations; products: readonly PosMenuItemRecord[]; scope: CafeteriaScope; now: string }) {
  const service = resolveCafeteriaService(input);
  const messages = {
    manual: 'Modo manual · catálogo sin restricciones de horario.',
    active: service.status === 'active' ? `Turno de servicio: ${service.shift.name} · Menú: ${service.menu.name}` : '',
    no_active_service: 'No hay un turno de servicio activo.',
    inactive_menu: 'El menú del turno de servicio está inactivo.',
    invalid_configuration: 'La programación de servicio no es válida. Consulta con administración.',
  };
  const message = (service.status === 'active' || service.status === 'manual') && !service.products.length
    ? 'No hay productos elegibles para vender en este momento.' : messages[service.status];
  let nextService = '';
  if (service.status === 'no_active_service') {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(input.now));
    const value = (type: string) => parts.find(p => p.type === type)!.value;
    const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(value('weekday')) + 1;
    const minute = Number(value('hour')) * 60 + Number(value('minute'));
    const next = input.operations.serviceShifts.filter(s => s.enabled && s.organizationId === input.scope.organizationId && s.locationId === input.scope.locationId).flatMap(shift => shift.weekdays.map(weekday => {
      const [hour, min] = shift.startTime.split(':').map(Number);
      let days = (weekday - day + 7) % 7;
      if (!days && hour! * 60 + min! <= minute) days = 7;
      return { shift, days, distance: days * 1440 + hour! * 60 + min! - minute };
    })).sort((a, b) => a.distance - b.distance)[0];
    if (next) nextService = ` Próximo turno: ${next.shift.name} · ${next.days === 0 ? 'hoy' : next.days === 1 ? 'mañana' : `en ${next.days} días`} ${next.shift.startTime} (Santo Domingo).`;
  }
  return { ...service, message: message + nextService };
}
export function ineligibleCartItems(cart: readonly PosCartLine[], eligible: readonly PosMenuItemRecord[], products: readonly PosMenuItemRecord[]) {
  const ids = new Set(eligible.map(p => p.id));
  return cart.filter(line => !ids.has(line.itemId)).map(line => ({ id: line.itemId, name: products.find(p => p.id === line.itemId)?.name ?? line.itemId }));
}
export function cartEligibilityMessage(items: readonly { name: string }[]) {
  return items.length ? `El servicio o catálogo cambió. Retira los productos que ya no son elegibles: ${items.map(item => item.name).join(', ')}.` : '';
}
