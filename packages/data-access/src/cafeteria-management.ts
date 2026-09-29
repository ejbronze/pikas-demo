import { validateCafeteriaMenus, validateServiceShifts, setServiceSchedulingEnabled, type CafeteriaMenu, type CafeteriaOperations, type CafeteriaScope, type ServiceShift } from './cafeteria';
import type { PosMenuItemRecord } from './pos';
export type MenuEditSnapshot = { menu: CafeteriaMenu; productIds: string[] };
const scoped = (item: CafeteriaScope, scope: CafeteriaScope) => item.organizationId === scope.organizationId && item.locationId === scope.locationId;
const assertScope = (item: CafeteriaScope, scope: CafeteriaScope) => { if (!scoped(item, scope)) throw new Error('Registro fuera de la cafetería autorizada.'); };
const text = (value: string, label: string, max: number) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label}: revisa el campo.`); return value.trim(); };
export function saveCafeteriaMenu(operations: CafeteriaOperations, products: PosMenuItemRecord[], input: CafeteriaMenu, productIds: string[], scope: CafeteriaScope, expected?: MenuEditSnapshot): CafeteriaOperations {
  assertScope(input, scope);
  const previous = operations.menus.find(menu => menu.id === input.id);
  if (previous) assertScope(previous, scope);
  const links = operations.menuProducts.filter(link => link.menuId === input.id).map(link => link.productId).sort();
  if (expected ? !previous || JSON.stringify(previous) !== JSON.stringify(expected.menu) || JSON.stringify(links) !== JSON.stringify([...expected.productIds].sort()) : !!previous) throw new Error('El menú cambió en otra sesión. Vuelve a abrirlo.');
  const menu = { ...input, id: text(input.id, 'Identificador', 120), name: text(input.name, 'Nombre', 120), description: input.description?.trim() ?? '' };
  if (menu.description.length > 500) throw new Error('La descripción admite hasta 500 caracteres.');
  const menus = previous ? operations.menus.map(item => item.id === menu.id ? menu : item) : [...operations.menus, menu];
  const menuProducts = [...operations.menuProducts.filter(link => link.menuId !== menu.id), ...productIds.map(productId => ({ menuId: menu.id, productId }))];
  const check = validateCafeteriaMenus(menus, menuProducts, products);
  if (!check.ok) throw new Error(check.errors.join(' '));
  return { ...operations, menus, menuProducts };
}
export function saveServiceShift(operations: CafeteriaOperations, input: ServiceShift, scope: CafeteriaScope, expected?: ServiceShift): CafeteriaOperations {
  assertScope(input, scope);
  const previous = operations.serviceShifts.find(shift => shift.id === input.id);
  if (previous) assertScope(previous, scope);
  if (expected ? !previous || JSON.stringify(previous) !== JSON.stringify(expected) : !!previous) throw new Error('El turno cambió en otra sesión. Vuelve a abrirlo.');
  const shift = { ...input, id: text(input.id, 'Identificador', 120), name: text(input.name, 'Nombre', 120) };
  const serviceShifts = previous ? operations.serviceShifts.map(item => item.id === shift.id ? shift : item) : [...operations.serviceShifts, shift];
  const check = validateServiceShifts(serviceShifts, operations.menus);
  if (!check.ok) throw new Error(check.errors.join(' '));
  return { ...operations, serviceShifts };
}
export function changeServiceScheduling(operations: CafeteriaOperations, enabled: boolean, expected: boolean): CafeteriaOperations {
  if (typeof enabled !== 'boolean' || operations.serviceSettings.enabled !== expected) throw new Error('La configuración cambió. Revisa su estado e inténtalo otra vez.');
  if (enabled) { const check = validateServiceShifts(operations.serviceShifts, operations.menus); if (!check.ok) throw new Error(check.errors.join(' ')); }
  return setServiceSchedulingEnabled(operations, enabled);
}
