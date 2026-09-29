import { BUSINESS_TIME_ZONE } from './financial';
import type { PosMenuItemRecord } from './pos';

export type CafeteriaScope = { organizationId: string; locationId: string };
export type CafeteriaMenu = CafeteriaScope & { id: string; name: string; description?: string; active: boolean };
export type MenuProduct = { menuId: string; productId: string };
/** ISO weekdays: Monday = 1, Sunday = 7. Times are local HH:mm. */
export type ServiceShift = CafeteriaScope & {
  id: string; name: string; menuId: string; weekdays: number[];
  startTime: string; endTime: string; enabled: boolean;
};
/** OFF selects the manual eligible catalog; it does not close the cafeteria or alter shifts. */
export type ServiceSettings = { enabled: boolean; timeZone: typeof BUSINESS_TIME_ZONE };
export type CafeteriaRegister = CafeteriaScope & { id: string; name: string; active: boolean };
/** Operational attributes only; these grant no cafeteria-admin or refund authority. */
export type PosEmployeeAttributes = { posRole: 'cashier' | 'supervisor'; allowedRegisterIds: string[] };
export type CafeteriaOperations = {
  menus: CafeteriaMenu[];
  menuProducts: MenuProduct[];
  serviceShifts: ServiceShift[];
  serviceSettings: ServiceSettings;
  registers: CafeteriaRegister[];
};
export type CafeteriaValidation = { ok: true } | { ok: false; errors: string[] };
const result = (errors: string[]): CafeteriaValidation => errors.length ? { ok: false, errors } : { ok: true };
const sameScope = (a: CafeteriaScope, b: CafeteriaScope) => a.organizationId === b.organizationId && a.locationId === b.locationId;
const validScope = (scope: CafeteriaScope) => !!scope.organizationId.trim() && !!scope.locationId.trim();
const minutes = (time: string): number | null => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hour, minute] = time.split(':').map(Number);
  return hour! * 60 + minute!;
};

export function validateCafeteriaMenus(menus: readonly CafeteriaMenu[], links: readonly MenuProduct[], products: readonly PosMenuItemRecord[]): CafeteriaValidation {
  const errors: string[] = [], ids = new Set<string>(), pairs = new Set<string>();
  const productIds = new Set(products.map(p => p.id));
  for (const menu of menus) {
    if (!menu.id.trim() || !menu.name.trim() || !validScope(menu) || typeof menu.active !== 'boolean') errors.push('Menú no válido.');
    if (ids.has(menu.id)) errors.push('ID de menú duplicado.');
    ids.add(menu.id);
  }
  for (const link of links) {
    const key = JSON.stringify([link.menuId, link.productId]);
    if (!ids.has(link.menuId) || !productIds.has(link.productId)) errors.push('El vínculo requiere un menú y un producto existentes.');
    if (pairs.has(key)) errors.push('Producto duplicado dentro del menú.');
    pairs.add(key);
  }
  return result(errors);
}

/** Validate the whole proposed schedule, including while the manual catalog is enabled. */
export function validateServiceShifts(shifts: readonly ServiceShift[], menus: readonly CafeteriaMenu[]): CafeteriaValidation {
  const errors: string[] = [], ids = new Set<string>();
  for (const shift of shifts) {
    const start = minutes(shift.startTime), end = minutes(shift.endTime);
    if (!shift.id.trim() || !shift.name.trim() || !validScope(shift) || typeof shift.enabled !== 'boolean') errors.push('Turno de servicio no válido.');
    if (ids.has(shift.id)) errors.push('ID de turno de servicio duplicado.');
    ids.add(shift.id);
    if (!shift.weekdays.length || new Set(shift.weekdays).size !== shift.weekdays.length || shift.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) errors.push('Selecciona días válidos sin duplicados.');
    if (start === null || end === null || start >= end) errors.push('El turno debe comenzar y terminar el mismo día, con inicio anterior al fin.');
    if (!menus.some(menu => menu.id === shift.menuId && sameScope(menu, shift))) errors.push('El menú debe pertenecer a la misma cafetería y ubicación.');
  }
  for (let i = 0; i < shifts.length; i++) {
    const a = shifts[i]!;
    if (!a.enabled) continue;
    for (const b of shifts.slice(i + 1)) {
      if (!b.enabled || a.organizationId !== b.organizationId || !a.weekdays.some(day => b.weekdays.includes(day))) continue;
      const as = minutes(a.startTime), ae = minutes(a.endTime), bs = minutes(b.startTime), be = minutes(b.endTime);
      if (as !== null && ae !== null && bs !== null && be !== null && as < be && bs < ae) errors.push('Los turnos de servicio habilitados no pueden superponerse.');
    }
  }
  return result(errors);
}

/** Manual mode never changes individual enabled flags. */
export function setServiceSchedulingEnabled(operations: CafeteriaOperations, enabled: boolean): CafeteriaOperations {
  return { ...operations, serviceSettings: { ...operations.serviceSettings, enabled } };
}

export type ServiceResolution =
  | { status: 'active'; shift: ServiceShift; menu: CafeteriaMenu; products: PosMenuItemRecord[] }
  | { status: 'manual'; shift: null; menu: null; products: PosMenuItemRecord[] }
  | { status: 'no_active_service' | 'inactive_menu' | 'invalid_configuration'; shift: null; menu: null; products: []; errors?: string[] };

/** Pure scheduling/product eligibility only. Customer restrictions still belong to POS validation. */
export function resolveCafeteriaService(input: { operations: CafeteriaOperations; products: readonly PosMenuItemRecord[]; scope: CafeteriaScope; now: string }): ServiceResolution {
  const { operations, products, scope, now } = input;
  const closed = (status: Exclude<ServiceResolution['status'], 'active' | 'manual'>, errors?: string[]): ServiceResolution => ({ status, shift: null, menu: null, products: [], ...(errors ? { errors } : {}) });
  const eligibleProduct = (product: PosMenuItemRecord) => product.active !== false && product.available && Number.isSafeInteger(product.priceMinor) && product.priceMinor >= 0;
  if (!operations.serviceSettings.enabled) return { status: 'manual', shift: null, menu: null, products: products.filter(eligibleProduct) };
  if (operations.serviceSettings.timeZone !== BUSINESS_TIME_ZONE || !Number.isFinite(Date.parse(now)) || !/(Z|[+-]\d{2}:\d{2})$/.test(now)) return closed('invalid_configuration');
  const cafeteriaMenus = operations.menus.filter(menu => menu.organizationId === scope.organizationId);
  const cafeteriaShifts = operations.serviceShifts.filter(shift => shift.organizationId === scope.organizationId);
  const menus = cafeteriaMenus.filter(menu => sameScope(menu, scope));
  const menuIds = new Set(menus.map(menu => menu.id));
  const links = operations.menuProducts.filter(link => menuIds.has(link.menuId));
  const shifts = cafeteriaShifts.filter(shift => sameScope(shift, scope));
  const checks = [validateCafeteriaMenus(menus, links, products), validateServiceShifts(cafeteriaShifts, cafeteriaMenus)];
  const errors = checks.flatMap(check => check.ok ? [] : check.errors);
  if (errors.length) return closed('invalid_configuration', errors);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(part('weekday')) + 1;
  const minute = Number(part('hour')) * 60 + Number(part('minute'));
  const active = shifts.filter(shift => shift.enabled && shift.weekdays.includes(weekday) && minutes(shift.startTime)! <= minute && minute < minutes(shift.endTime)!);
  if (!active.length) return closed('no_active_service');
  if (active.length !== 1) return closed('invalid_configuration');
  const shift = active[0]!, menu = menus.find(menu => menu.id === shift.menuId)!;
  if (!menu.active) return closed('inactive_menu');
  const eligibleIds = new Set(links.filter(link => link.menuId === menu.id).map(link => link.productId));
  return { status: 'active', shift, menu, products: products.filter(product => eligibleIds.has(product.id) && eligibleProduct(product)) };
}
