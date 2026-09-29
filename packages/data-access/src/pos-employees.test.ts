import { describe, it, expect } from 'vitest';
import { savePosEmployee, employeeSnapshot, type DemoEmployeeUser, type PosEmployeeInput } from './pos-employees';
import { hasScopedPermission, type AuthorityRole, type AuthorityScope, type ScopedMembership } from './authorization';
import { migrateCafeteriaDemoState } from './cafeteria-demo';
const scope = { organizationId: 'cafeteria-demo', locationId: 'principal' };
const authorityScope: AuthorityScope = { kind: 'cafeteria', ...scope };
const actor = { id: 'ca-1', status: 'active' as const };
const memberships: ScopedMembership[] = [{ userId: actor.id, role: 'cafeteria_admin', authorityScope }];
const register = { ...scope, id: 'caja-1', name: 'Caja 1', active: true };
const employee: PosEmployeeInput = { id: 'employee-1', name: 'Persona Demo', email: 'persona@demo.test', posRole: 'cashier', status: 'active', allowedRegisterIds: ['caja-1'] };
const input = { actor, memberships, scope, registers: [register], users: [] as DemoEmployeeUser[], employee };
describe('scoped employee authority', () => {
  it.each(['cashier', 'supervisor'] as const)('creates %s with stable ID and POS-only authority', posRole => {
    const saved = savePosEmployee({ ...input, employee: { ...employee, posRole } });
    expect(saved.employee).toMatchObject({ id: employee.id, role: 'pos_operator', posRole, operationalScope: scope });
    expect(saved.changes).toEqual(['Empleado POS creado']);
    const membership: ScopedMembership = { userId: employee.id, role: saved.employee.role, authorityScope };
    expect(hasScopedPermission(saved.employee, [membership], authorityScope, 'pos:checkout')).toBe(true);
    expect(hasScopedPermission(saved.employee, [membership], authorityScope, 'pos_users:manage')).toBe(false);
  });
  it.each(['school_admin', 'pos_operator', 'platform_operator', 'account_admin'] as AuthorityRole[])('does not infer employee authority from %s', role => {
    expect(() => savePosEmployee({ ...input, memberships: [{ ...memberships[0]!, role }] })).toThrow('autorizada');
  });
  it('denies cross-domain, cross-location, inactive and missing memberships', () => {
    for (const bad of [[], [{ ...memberships[0]!, authorityScope: { kind: 'school' as const, schoolId: 'school-demo' } }], [{ ...memberships[0]!, authorityScope: { ...authorityScope, locationId: 'other' } }]]) expect(() => savePosEmployee({ ...input, memberships: bad })).toThrow();
    expect(() => savePosEmployee({ ...input, actor: { ...actor, status: 'suspended' } })).toThrow();
    expect(hasScopedPermission(actor, memberships, { kind: 'school', schoolId: 'school-demo' }, 'students:manage')).toBe(false);
    expect(hasScopedPermission(actor, memberships, authorityScope, 'partnerships:request')).toBe(false);
  });
  it('edits identity and permissions without changing stable ID or its input', () => {
    const original = savePosEmployee(input).employee, before = structuredClone(original);
    const saved = savePosEmployee({ ...input, users: [original], expected: employeeSnapshot(original), employee: { ...employee, name: 'Nombre nuevo', email: 'nuevo@demo.test', posRole: 'supervisor', status: 'suspended', allowedRegisterIds: [] } });
    expect(saved.employee.id).toBe(original.id); expect(original).toEqual(before);
    expect(saved.changes).toEqual(['Identidad POS actualizada', 'Rol POS actualizado', 'Acceso a cajas actualizado', 'Empleado POS suspendido']);
    expect(() => savePosEmployee({ ...input, users: [saved.employee], expected: employeeSnapshot(original) })).toThrow('cambió');
  });
  it('rejects duplicate identifiers, invalid fields, foreign employees and conflicting memberships', () => {
    const original = savePosEmployee(input).employee;
    expect(() => savePosEmployee({ ...input, users: [original], employee: { ...employee, id: 'second', email: employee.email.toUpperCase() } })).toThrow('correo');
    for (const invalid of [{ ...employee, name: ' ' }, { ...employee, email: 'bad' }, { ...employee, posRole: 'admin' as 'cashier' }, { ...employee, status: 'unknown' as 'active' }]) expect(() => savePosEmployee({ ...input, employee: invalid })).toThrow();
    expect(() => savePosEmployee({ ...input, users: [{ ...original, operationalScope: { ...scope, locationId: 'other' } }], expected: employee })).toThrow('fuera');
    expect(() => savePosEmployee({ ...input, memberships: [...memberships, { userId: employee.id, role: 'school_admin', authorityScope: { kind: 'school', schoolId: 'school-demo' } }] })).toThrow('otro ámbito');
  });
  it('assigns multiple active local registers, rejects foreign/inactive new assignments, retains disabled historical assignments', () => {
    const second = { ...register, id: 'caja-2' };
    expect(savePosEmployee({ ...input, registers: [register, second], employee: { ...employee, allowedRegisterIds: ['caja-1', 'caja-2'] } }).employee.allowedRegisterIds).toEqual(['caja-1', 'caja-2']);
    for (const invalid of [{ ...register, active: false }, { ...register, organizationId: 'foreign' }]) expect(() => savePosEmployee({ ...input, registers: [invalid] })).toThrow('cajas activas');
    const previous = savePosEmployee(input).employee;
    expect(savePosEmployee({ ...input, users: [previous], expected: employeeSnapshot(previous), registers: [{ ...register, active: false }] }).employee.allowedRegisterIds).toEqual(['caja-1']);
  });

});
describe('revision 3 identity migration', () => {
  it('adds stable scope to recognized memberships and preserves every historical collection', () => {
    const source = { schemaRevision: 2, menuItems: [], purchases: [{ cashierId: 'pos-1', employeeLabel: 'Original' }], events: [{ actorId: 'pos-1', actorName: 'Original' }], administration: { users: [{ id: 'pos-1', role: 'pos_operator', scope: 'Caja principal' }], memberships: [{ id: 'm', userId: 'pos-1', role: 'pos_operator', organizationType: 'cafeteria', organizationName: 'Cafetería PIKAS Central', location: 'Caja principal' }] } };
    const result = migrateCafeteriaDemoState(source);
    expect(result.administration.memberships[0]).toMatchObject({ authorityScope });
    expect(result.administration.users[0]).toMatchObject({ operationalScope: scope });
    expect(result.purchases).toBe(source.purchases); expect(result.events).toBe(source.events);
    expect(migrateCafeteriaDemoState(result)).toEqual(result);
  });
  it('does not promote a mismatched legacy organization type into authority', () => {
    const source = { schemaRevision: 2, menuItems: [], administration: { users: [{ id: 'pos-1', role: 'pos_operator', scope: 'Caja principal' }], memberships: [{ id: 'm', userId: 'pos-1', role: 'pos_operator', organizationType: 'school', organizationName: 'Cafetería PIKAS Central', location: 'Caja principal' }] } };
    const result = migrateCafeteriaDemoState(source);
    expect(result.administration.memberships[0]).not.toHaveProperty('authorityScope', authorityScope);
    expect(result.administration.users[0]).not.toHaveProperty('operationalScope', scope);
  });
  it('does not infer foreign scope or recreate removed revision-3 authority', () => {
    const source = { schemaRevision: 2, menuItems: [], administration: { users: [{ id: 'foreign', role: 'pos_operator', scope: 'Patio' }], memberships: [{ id: 'm', userId: 'foreign', role: 'pos_operator', organizationType: 'cafeteria', organizationName: 'Other', location: 'Caja principal' }] } };
    expect(migrateCafeteriaDemoState(source).administration.users[0]).not.toHaveProperty('operationalScope', scope);
    const removed = { ...source, schemaRevision: 3, administration: { ...source.administration, memberships: [{ ...source.administration.memberships[0]!, organizationName: 'Cafetería PIKAS Central' }] } };
    expect(migrateCafeteriaDemoState(removed).administration.memberships[0]).not.toHaveProperty('authorityScope', authorityScope);
  });
});
