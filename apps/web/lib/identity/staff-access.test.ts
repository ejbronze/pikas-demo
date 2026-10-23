import { describe, expect, it } from 'vitest';
import { accessState, internalEmail, isInternalEmail, staffAccessRequestSchema, suggestUsername } from './staff-access';
import type { IdentitySummary } from './contracts';

const summary = (patch: Partial<IdentitySummary> = {}): IdentitySummary => ({ person_id: '4d200000-0000-4000-8000-000000000004', display_name: 'Ana Ficticia', person_status: 'active', username: 'ana.ficticia', email: 'ana.ficticia@cajeros.pikas.invalid', email_confirmed: true, last_sign_in_at: null, must_change_password: false, login_suspended: false, temporary_issued_at: null, pending_email: null, version: 1, memberships: [], audit: [], ...patch });

describe('UX 12B staff access rules', () => {
  it.each([['María José Pérez García', 'maria.garcia'], ['Ñandú Ávila', 'nandu.avila'], ['  Juan  ', 'juan'], ['Li', ''], ['Ana-Lucía del Río', 'ana.rio'], ['José', 'jose'], ['!!!', '']])('suggests a username for %s', (name, expected) => expect(suggestUsername(name)).toBe(expected));
  it('a suggestion is never longer than 40 and never ends with a separator', () => { const s = suggestUsername('Abcdefghijklmnopqrstuvwxyzabcdefghijklmnop Zyxwvutsrqponmlkjihgfedcba'); expect(s.length).toBeLessThanOrEqual(40); expect(s).not.toMatch(/[._-]$/); });
  it('the internal address is non-deliverable, derived from the normalized username and recognisable', () => {
    expect(internalEmail(' Ana.Ficticia ', '4D200000-0000-4000-8000-000000000009')).toBe('ana.ficticia.4d200000@cajeros.pikas.invalid');
    expect(internalEmail('ana.ficticia', '4d200000-0000-4000-8000-000000000009')).not.toBe(internalEmail('ana.ficticia', '5e300000-0000-4000-8000-000000000009')); expect(isInternalEmail('ANA.FICTICIA@CAJEROS.PIKAS.INVALID')).toBe(true); expect(isInternalEmail('ana@example.invalid')).toBe(false); expect(isInternalEmail(null)).toBe(false);
  });
  it('the request contract: optional email, normalized username, no authority fields', () => {
    const base = { cafeteriaId: '4d200000-0000-4000-8000-000000000001', display_name: ' Ana Ficticia ', role: 'pos_cashier', username: ' Ana.Ficticia ' };
    const parsed = staffAccessRequestSchema.safeParse(base); expect(parsed.success).toBe(true); if (parsed.success) { expect(parsed.data.username).toBe('ana.ficticia'); expect(parsed.data.display_name).toBe('Ana Ficticia'); expect(parsed.data.email).toBeUndefined(); }
    expect(staffAccessRequestSchema.safeParse({ ...base, email: 'Ana@Example.invalid' }).success).toBe(true);
    expect(staffAccessRequestSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(staffAccessRequestSchema.safeParse({ ...base, role: 'cafeteria_admin' }).success).toBe(false);
    expect(staffAccessRequestSchema.safeParse({ ...base, person_id: base.cafeteriaId }).success).toBe(false);
  });
  it('access states come from membership status and the identity summary, in that order', () => {
    expect(accessState(summary(), 'inactive').label).toBe('Acceso retirado');
    expect(accessState(summary(), 'suspended').label).toBe('Acceso suspendido');
    expect(accessState(summary({ login_suspended: true }), 'active').label).toBe('Inicio de sesión suspendido');
    expect(accessState(summary({ email_confirmed: false }), 'active').label).toBe('Pendiente de activación');
    expect(accessState(summary({ must_change_password: true, temporary_issued_at: '2026-10-22T20:00:00Z' }), 'active').label).toBe('Credencial temporal emitida');
    expect(accessState(summary({ must_change_password: true }), 'active').label).toBe('Cambio de contraseña requerido');
    expect(accessState(summary({ must_change_password: true, temporary_issued_at: '2026-10-22T19:00:00Z', temporary_expired: true }), 'active')).toMatchObject({ label: 'Credencial temporal vencida', tone: 'blocked' });
    expect(accessState(summary({ temporary_expired: true }), 'active').label).toBe('Acceso listo'); // a permanent password is never "expired"
    expect(accessState(summary(), 'active')).toMatchObject({ label: 'Acceso listo', tone: 'ready', detail: expect.stringContaining('aún no ha entrado') });
    expect(accessState(summary({ last_sign_in_at: '2026-10-22T20:00:00Z' }), 'active').detail).toBe('Puede iniciar sesión.');
  });
});
