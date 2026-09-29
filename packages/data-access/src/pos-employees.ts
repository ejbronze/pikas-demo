import type { CafeteriaRegister, CafeteriaScope, PosEmployeeAttributes } from './cafeteria';
import { hasScopedPermission, sameAuthorityScope, type AuthorityScope, type DemoRole, type ScopedMembership, type UserStatus } from './authorization';
export type DemoEmployeeUser = Partial<PosEmployeeAttributes> & {
  id: string; name: string; email: string; role: DemoRole; status: UserStatus;
  scope: string; lastActivity: string; operationalScope?: CafeteriaScope;
};
export type PosEmployeeInput = { id: string; name: string; email: string; posRole: PosEmployeeAttributes['posRole']; status: UserStatus; allowedRegisterIds: string[] };
export function employeeInScope(user: DemoEmployeeUser, scope: CafeteriaScope): boolean {
  return user.role === 'pos_operator' && user.operationalScope?.organizationId === scope.organizationId && user.operationalScope.locationId === scope.locationId;
}
export function employeeSnapshot(user: DemoEmployeeUser): PosEmployeeInput {
  return { id: user.id, name: user.name, email: user.email, posRole: user.posRole ?? 'cashier', status: user.status, allowedRegisterIds: [...user.allowedRegisterIds ?? []] };
}
export function savePosEmployee(input: {
  actor: { id: string; status: UserStatus }; memberships: readonly ScopedMembership[]; users: readonly DemoEmployeeUser[];
  scope: CafeteriaScope; registers: readonly CafeteriaRegister[]; employee: PosEmployeeInput; expected?: PosEmployeeInput;
}) {
  const { actor, scope, employee, users, memberships, registers, expected } = input;
  const authorityScope: AuthorityScope = { kind: 'cafeteria', ...scope };
  if (!hasScopedPermission(actor, memberships, authorityScope, 'pos_users:manage')) throw new Error('Operación no autorizada.');
  const previous = users.find(u => u.id === employee.id);
  if (previous && !employeeInScope(previous, scope)) throw new Error('Empleado fuera de la cafetería autorizada.');
  if (previous ? !expected || JSON.stringify(employeeSnapshot(previous)) !== JSON.stringify(expected) : expected !== undefined) throw new Error('El empleado cambió. Actualiza antes de guardar.');
  if (memberships.some(m => m.userId === employee.id && (m.role !== 'pos_operator' || !sameAuthorityScope(m.authorityScope, authorityScope)))) throw new Error('Identidad con otro ámbito; no se puede reasignar.');
  const name = employee.name.trim(), email = employee.email.trim().toLowerCase();
  if (!employee.id.trim() || !name || name.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Indica nombre y correo válidos.');
  if (!['cashier', 'supervisor'].includes(employee.posRole) || !['active', 'suspended', 'inactive'].includes(employee.status)) throw new Error('Rol o estado no válido.');
  if (users.some(u => u.id !== employee.id && u.email.trim().toLowerCase() === email)) throw new Error('Ya existe una cuenta con ese correo.');
  const ids = [...new Set(employee.allowedRegisterIds)];
  for (const id of ids) {
    const register = registers.find(r => r.id === id && r.organizationId === scope.organizationId && r.locationId === scope.locationId);
    if (!register || (!register.active && !previous?.allowedRegisterIds?.includes(id))) throw new Error('Selecciona cajas activas de esta cafetería.');
  }
  const saved: DemoEmployeeUser = { ...previous, id: employee.id, name, email, role: 'pos_operator', status: employee.status, posRole: employee.posRole, allowedRegisterIds: ids, operationalScope: { ...scope }, scope: previous?.scope ?? 'Caja principal', lastActivity: previous?.lastActivity ?? 'Sin actividad' };
  const changes: string[] = [];
  if (!previous) changes.push('Empleado POS creado');
  else {
    if (previous.name !== name || previous.email !== email) changes.push('Identidad POS actualizada');
    if (previous.posRole !== saved.posRole) changes.push('Rol POS actualizado');
    if (JSON.stringify([...(previous.allowedRegisterIds ?? [])].sort()) !== JSON.stringify([...ids].sort())) changes.push('Acceso a cajas actualizado');
    if (previous.status !== saved.status) changes.push(saved.status === 'active' ? 'Empleado POS activado' : saved.status === 'suspended' ? 'Empleado POS suspendido' : 'Empleado POS desactivado');
  }
  return { employee: saved, changes, authorityScope };
}
