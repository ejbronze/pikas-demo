import { describe, expect, it } from 'vitest';
import { cafeteriaHref, cafeteriaReadiness, managedCounts } from './readiness';
import { cafeteriaRead, id } from './test-fixtures';
import type { CafeteriaRead } from './contracts';

const reg = (patch: Partial<CafeteriaRead['registers'][number]> = {}): CafeteriaRead['registers'][number] => ({ id: '5d300000-0000-4000-8000-000000000905', code: 'CAJA-01', name: 'Caja Principal', status: 'active', version: 1, has_history: false, open: false, ...patch });
const member = (patch: Partial<CafeteriaRead['staff'][number]> = {}): CafeteriaRead['staff'][number] => ({ id, name: 'Cajera Ficticia', role: 'pos_cashier', status: 'active', open: false, ...patch });
const assignment = (patch: Partial<CafeteriaRead['assignments'][number]> = {}): CafeteriaRead['assignments'][number] => ({ id, membership_id: id, register_id: '5d300000-0000-4000-8000-000000000905', status: 'active', version: 1, ...patch });
const product = (patch: Partial<CafeteriaRead['products'][number]> = {}): CafeteriaRead['products'][number] => ({ id, name: 'Empanada ficticia', description: '', unit: 'Unidad', category_id: null, price_minor: 5000, active: true, available: true, ingredients: [], allergens: [], version: 1, ...patch });
const data = (patch: Partial<CafeteriaRead> = {}): CafeteriaRead => ({ ...cafeteriaRead(), ...patch });
const states = (d: CafeteriaRead) => cafeteriaReadiness(d).steps.map(s => [s.key, s.state]);
const complete = (patch: Partial<CafeteriaRead> = {}) => data({ registers: [reg()], staff: [member()], assignments: [assignment()], products: [product()], ...patch });

describe('cafetería readiness', () => {
  it('empty cafetería: every step pending, next step is the caja with a contextual action; context is never a step', () => {
    const r = cafeteriaReadiness(data());
    expect(r.steps.map(s => s.key)).toEqual(['cajas', 'personal', 'productos', 'operacion']);
    expect(r.steps.every(s => s.state === 'pending')).toBe(true); expect(r.status).toBe('configuring'); expect(r.complete).toBe(0);
    expect(r.next?.action).toEqual({ href: cafeteriaHref(id, '/cajas'), label: 'Crear caja para Real cafeteria' });
    expect(r.steps.find(s => s.key === 'operacion')?.action).toBeNull();
    expect(JSON.stringify(r.steps)).not.toMatch(/sede|colegio|confirmar/i);
  });
  it('caja created: staff is next, pointing to Personal POS with the cafetería named', () => {
    const r = cafeteriaReadiness(data({ registers: [reg()] }));
    expect(states(r.steps.length ? data({ registers: [reg()] }) : data())[0]).toEqual(['cajas', 'complete']); expect(r.steps[0]).toMatchObject({ state: 'complete', detail: '1 caja activa: Caja Principal' });
    expect(r.next).toMatchObject({ key: 'personal', detail: 'Agrega al menos una persona de caja.', action: { href: cafeteriaHref(id, '/personal'), label: 'Agregar personal a Real cafeteria' } });
  });
  it('inactive cajas do not count; staff without an assignment is pending and sent to Cajas to assign', () => {
    expect(cafeteriaReadiness(data({ registers: [reg({ status: 'inactive' })] })).steps[0]).toMatchObject({ state: 'pending', detail: 'Hay cajas, pero ninguna está activa.' });
    const r = cafeteriaReadiness(data({ registers: [reg()], staff: [member()] }));
    expect(r.steps[1]).toMatchObject({ state: 'pending', action: { href: cafeteriaHref(id, '/cajas'), label: 'Asignar en Cajas' } });
    expect(cafeteriaReadiness(data({ staff: [member()] })).steps[1]).toMatchObject({ state: 'pending', action: null });
  });
  it('assignments only count for active staff on active cajas; invitations explain waiting or expired access', () => {
    expect(cafeteriaReadiness(data({ registers: [reg()], staff: [member({ status: 'suspended' })], assignments: [assignment()] })).steps[1].state).toBe('pending');
    expect(cafeteriaReadiness(data({ registers: [reg()], staff: [member()], assignments: [assignment({ status: 'inactive' })] })).steps[1].state).toBe('pending');
    expect(cafeteriaReadiness(data({ invitations: [{ id, email: 'x@example.invalid', role: 'pos_cashier', status: 'pending', expires_at: '2099-01-01T00:00:00Z' }] })).steps[1]).toMatchObject({ state: 'pending', detail: '1 acceso preparado espera activación.' });
    expect(cafeteriaReadiness(data({ invitations: [{ id, email: 'x@example.invalid', role: 'pos_cashier', status: 'expired', expires_at: '2020-01-01T00:00:00Z' }] })).steps[1]).toMatchObject({ state: 'attention', detail: '1 acceso preparado venció sin usarse.' });
  });
  it('products: unavailable products do not count; scheduling needs a valid menu and shift, invalid configuration needs attention', () => {
    expect(cafeteriaReadiness(data({ products: [product({ available: false })] })).steps[2]).toMatchObject({ state: 'pending', action: { label: 'Administrar productos de Real cafeteria' } });
    const scheduling = { currency: 'DOP' as const, scheduling_enabled: true, version: 1 };
    expect(cafeteriaReadiness(data({ products: [product()], settings: scheduling })).steps[2]).toMatchObject({ state: 'pending', action: { href: cafeteriaHref(id, '/menus/turnos'), label: 'Configurar turnos' } });
    const menus = [{ id, name: 'Menú', description: '', active: true, version: 1, product_ids: [id] }], shifts = [{ id, menu_id: id, name: 'Mañana', start_time: '07:00', end_time: '10:00', enabled: true, version: 1, weekdays: [1] }];
    expect(cafeteriaReadiness(data({ products: [product()], settings: scheduling, menus, shifts })).steps[2]).toMatchObject({ state: 'complete', detail: '1 producto disponible · menú y turnos configurados' });
    const service = { status: 'invalid_configuration' as const, scheduling_enabled: true, business_date: '2026-10-22', local_time: '09:00', business_timezone: 'America/Santo_Domingo', service_shift_id: null, service_shift_name: null, menu_id: null, menu_name: null };
    expect(cafeteriaReadiness(data({ products: [product()], settings: scheduling, menus, shifts, service })).steps[2].state).toBe('attention');
  });
  it('ready before any sale: caja, assigned staff and products make the cafetería "Lista para operar" with no session and no purchase', () => {
    const r = cafeteriaReadiness(complete());
    expect(r.status).toBe('ready'); expect(r.complete).toBe(3);
    expect(r.steps[3]).toMatchObject({ state: 'pending', detail: expect.stringContaining('no hace falta una venta'), action: { href: cafeteriaHref(id, '/cajas'), label: 'Ver cajas' } });
    expect(r.next?.key).toBe('operacion');
  });
  it('a caja opened in the POS (session history or open now) completes the operation step without a sale', () => {
    expect(cafeteriaReadiness(complete({ registers: [reg({ has_history: true })] }))).toMatchObject({ status: 'operating', complete: 4, next: null });
    expect(cafeteriaReadiness(complete({ registers: [reg({ open: true })] })).status).toBe('operating');
  });
  it('readiness follows current truth: losing the only assigned person or the only caja drops back to configuring', () => {
    expect(cafeteriaReadiness(complete({ registers: [reg({ has_history: true })], staff: [member({ status: 'inactive' })] })).status).toBe('configuring');
    expect(cafeteriaReadiness(complete({ registers: [reg({ status: 'inactive', has_history: true })] })).status).toBe('configuring');
  });
  it('attention outranks the first pending step as the next step', () => {
    const r = cafeteriaReadiness(data({ registers: [reg()], staff: [member()], assignments: [assignment()], products: [product()], settings: { currency: 'DOP', scheduling_enabled: true, version: 1 }, service: { status: 'invalid_configuration', scheduling_enabled: true, business_date: '2026-10-22', local_time: '09:00', business_timezone: 'America/Santo_Domingo', service_shift_id: null, service_shift_name: null, menu_id: null, menu_name: null } }));
    expect(r.next?.key).toBe('productos'); expect(r.status).toBe('configuring');
  });
  it('managed counts only count active cajas, active staff and available products', () => {
    expect(managedCounts(complete({ registers: [reg(), reg({ id: '5d300000-0000-4000-8000-000000000906', status: 'inactive' })], products: [product(), product({ id: '5d300000-0000-4000-8000-000000000907', available: false })] }))).toEqual({ cajas: 1, personal: 1, productos: 1 });
  });
});
