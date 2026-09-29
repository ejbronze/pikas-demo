/** Explicit domain memberships; reserved future roles have no permissions yet. */
export type AuthorityScope =
  | { kind: 'platform' }
  | { kind: 'account'; accountId: string }
  | { kind: 'school'; schoolId: string }
  | { kind: 'cafeteria'; organizationId: string; locationId: string };
export type DemoRole = 'school_admin' | 'cafeteria_admin' | 'pos_operator';
export type AuthorityRole = DemoRole | 'platform_operator' | 'account_admin';
export type UserStatus = 'active' | 'suspended' | 'inactive';
export type ScopedMembership = { userId: string; role: AuthorityRole; authorityScope?: AuthorityScope };
export type Permission = 'school:read' | 'students:manage' | 'school_admins:manage' | 'partnerships:review' | 'cafeteria:read' | 'menu:manage' | 'pos_users:manage' | 'partnerships:request' | 'pos:verify' | 'pos:checkout';
const permissions: Record<AuthorityRole, readonly Permission[]> = {
  school_admin: ['school:read', 'students:manage', 'school_admins:manage', 'partnerships:review'],
  cafeteria_admin: ['cafeteria:read', 'menu:manage', 'pos_users:manage'],
  pos_operator: ['pos:verify', 'pos:checkout'],
  platform_operator: [], account_admin: [],
};
export const roleAllows = (role: AuthorityRole, permission: Permission) => permissions[role]?.includes(permission) ?? false;
export function sameAuthorityScope(a: AuthorityScope | undefined, b: AuthorityScope): boolean {
  if (!a || a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'platform': return true;
    case 'account': return b.kind === 'account' && a.accountId === b.accountId;
    case 'school': return b.kind === 'school' && a.schoolId === b.schoolId;
    case 'cafeteria': return b.kind === 'cafeteria' && a.organizationId === b.organizationId && a.locationId === b.locationId;
  }
}
export function hasScopedPermission(user: { id: string; status: UserStatus }, memberships: readonly ScopedMembership[], scope: AuthorityScope, permission: Permission): boolean {
  return user.status === 'active' && memberships.some(m => m.userId === user.id && sameAuthorityScope(m.authorityScope, scope)
    && (m.role === 'school_admin' ? scope.kind === 'school' : m.role === 'cafeteria_admin' || m.role === 'pos_operator' ? scope.kind === 'cafeteria' : false)
    && roleAllows(m.role, permission));
}
/** Future school-controlled grants. This contract grants nothing by itself and exposes no additional data. */
export type StudentDataCategory = 'identification' | 'grade_class' | 'dietary_restrictions' | 'allergen_warnings' | 'account_balance' | 'guardian_contact';
export type SchoolCafeteriaDataPolicy = {
  schoolId: string;
  cafeteriaOrganizationId: string;
  allowed: Readonly<Record<StudentDataCategory, boolean>>;
};
