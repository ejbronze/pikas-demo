import type { AuthorityScope } from './authorization';
import type { RegisterSession } from './register-sessions';
import { BUSINESS_TIME_ZONE } from './financial';
import type { CafeteriaOperations, PosEmployeeAttributes } from './cafeteria';
import type { PosMenuItemRecord } from './pos';

/** Persisted demo schema revision, independent of the application version/storage key. */
export const CAFETERIA_DEMO_SCHEMA_REVISION = 3;
export type CafeteriaDemoFoundation = { schemaRevision: number; registerSessions: RegisterSession[]; cafeteriaOperations: CafeteriaOperations };
type LegacyDemo = {
  schemaRevision?: number;
  registerSessions?: RegisterSession[];
  cafeteriaOperations?: Partial<CafeteriaOperations>;
  menuItems: PosMenuItemRecord[];
  administration: { users: Array<{ id: string; role: string } & Partial<PosEmployeeAttributes> & { scope?: string; operationalScope?: { organizationId: string; locationId: string } }>; memberships?: Array<{ id?: string; userId?: string; role?: string; organizationType?: string; organizationName?: string; location?: string; authorityScope?: AuthorityScope }> };
};

/** Additive migration: no synthetic sales, schedules or changes to financial history. */
export function migrateCafeteriaDemoState<T extends LegacyDemo>(state: T): T & CafeteriaDemoFoundation {
  if (state.schemaRevision !== undefined && (!Number.isInteger(state.schemaRevision) || state.schemaRevision < 0 || state.schemaRevision > CAFETERIA_DEMO_SCHEMA_REVISION)) throw new Error('Revisión del estado demo no compatible.');
  const existing = state.cafeteriaOperations;
  const legacy = (state.schemaRevision ?? 0) < 3;
  const cafeteriaScope = { organizationId: 'cafeteria-demo', locationId: 'principal' };
  const memberships = state.administration.memberships?.map(m => ({ ...m, authorityScope: m.authorityScope ?? (legacy ?
    m.role === 'school_admin' && m.organizationType === 'school' && m.organizationName === 'Instituto Nueva Generación' ? { kind: 'school' as const, schoolId: 'school-demo' } :
    ['cafeteria_admin', 'pos_operator'].includes(m.role ?? '') && m.organizationType === 'cafeteria' && m.organizationName === 'Cafetería PIKAS Central' && m.location === 'Caja principal' ? { kind: 'cafeteria' as const, ...cafeteriaScope } : undefined : undefined) }));
  return {
    ...state,
    schemaRevision: CAFETERIA_DEMO_SCHEMA_REVISION,
    registerSessions: state.registerSessions ?? [],
    menuItems: state.menuItems.map(product => ({ ...product, active: product.active ?? true })),
    administration: {
      ...state.administration,
      ...(memberships ? { memberships } : {}),
      users: state.administration.users.map(user => user.role !== 'pos_operator' ? user : {
        ...user,
        posRole: user.posRole ?? 'cashier',
        operationalScope: user.operationalScope ?? (legacy && (
          memberships?.some(m => m.userId === user.id && m.role === 'pos_operator' && m.authorityScope?.kind === 'cafeteria' && m.authorityScope.organizationId === cafeteriaScope.organizationId && m.authorityScope.locationId === cafeteriaScope.locationId) ||
          !memberships?.some(m => m.userId === user.id) && ((user.id === 'pos-2' && user.scope === 'Patio') || (user.id === 'pos-3' && user.scope === 'Eventos'))
        ) ? cafeteriaScope : undefined),
        // Preserve only the register access already exercised by the legacy demo.
        allowedRegisterIds: user.allowedRegisterIds ?? (user.id === 'pos-1' ? ['caja-1'] : []),
      }),
    },
    cafeteriaOperations: {
      ...existing,
      menus: existing?.menus ?? [],
      menuProducts: existing?.menuProducts ?? [],
      serviceShifts: existing?.serviceShifts ?? [],
      serviceSettings: existing?.serviceSettings ?? { enabled: false, timeZone: BUSINESS_TIME_ZONE },
      registers: existing?.registers ?? [{ id: 'caja-1', name: 'Caja 1', organizationId: 'cafeteria-demo', locationId: 'principal', active: true }],
    },
  };
}
