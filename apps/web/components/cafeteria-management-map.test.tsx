import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({ default: ({ children, href, className, ...rest }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className} {...rest}>{children}</a> }));
(globalThis as { React?: typeof React }).React = React;
import { HierarchyTrail, ManagementMap, ReadinessGuide } from './cafeteria-management-map';
import { cafeteriaReadiness } from '../lib/cafeteria/readiness';
import { cafeteriaRead, id } from '../lib/cafeteria/test-fixtures';
import type { CafeteriaRead } from '../lib/cafeteria/contracts';

const register: CafeteriaRead['registers'][number] = { id: '5d300000-0000-4000-8000-000000000905', code: 'CAJA-01', name: 'Caja Principal', status: 'active', version: 1, has_history: false, open: false };
const configured = (): CafeteriaRead => ({ ...cafeteriaRead(), registers: [register], staff: [{ id, name: 'Cajera Ficticia', role: 'pos_cashier', status: 'active', open: false }], assignments: [{ id, membership_id: id, register_id: register.id, status: 'active', version: 1 }],
  products: [{ id, name: 'Empanada ficticia', description: '', unit: 'Unidad', category_id: null, price_minor: 5000, active: true, available: true, ingredients: [], allergens: [], version: 1 }] });
const map = (d: CafeteriaRead) => renderToStaticMarkup(<ManagementMap data={d} readiness={cafeteriaReadiness(d)} />);

describe('UX 12A management map', () => {
  it('inherited levels are plain text (never links or buttons); the managed levels are the only links and carry counts', () => {
    const html = map(configured());
    const chain = html.slice(html.indexOf('<ol class="hoy-chain"'), html.indexOf('</ol>', html.indexOf('<ol class="hoy-chain"')));
    const context = chain.slice(0, chain.indexOf('data-level="manage"'));
    expect(context).toContain('Colegio</span><span class="hoy-chain-v">Real school'); expect(context).toContain('Sede</span><span class="hoy-chain-v">Real campus'); expect(context).toContain('data-level="here"><span class="hoy-chain-k">Cafetería</span><span class="hoy-chain-v">Real cafeteria');
    expect(context).not.toMatch(/<a |<button/);
    expect(chain).toContain('Tú administras');
    for (const [path, label] of [['cajas', 'Cajas'], ['personal', 'Personal POS'], ['productos', 'Productos']]) expect(chain).toContain(`<a href="/admin/cafeteria/${path}?cafeteria=${id}" aria-label="${label} de Real cafeteria: 1">`);
    expect(html).toContain('El colegio, la sede y la cafetería los establece PIKAS; no tienes que crearlos.');
    expect(html).toContain('data-launch="ready">Lista para operar');
  });
  it('readiness guide: PIKAS context shown as established (not a step), four admin steps, next step highlighted with its contextual action', () => {
    const d = cafeteriaRead(), html = renderToStaticMarkup(<ReadinessGuide data={d} readiness={cafeteriaReadiness(d)} />);
    expect(html).toContain('Contexto establecido por PIKAS'); expect(html).toContain('Sede Real campus'); expect(html).toContain('Cafetería Real cafeteria');
    const named = { ...d, scope: { ...d.scope, location_name: 'Sede Santiago', cafeteria_name: 'Cafetería Santiago' } };
    const namedHtml = renderToStaticMarkup(<ReadinessGuide data={named} readiness={cafeteriaReadiness(named)} />); expect(namedHtml).toContain('✓</i> Sede Santiago<'); expect(namedHtml).not.toContain('Sede Sede'); expect(namedHtml).not.toContain('Cafetería Cafetería');
    expect(html.match(/<li data-state=/g)).toHaveLength(4); expect(html).not.toContain('Confirmar cafetería');
    expect(html).toContain('data-state="pending" data-next="true"><span class="net-step-mark" aria-hidden="true">1</span>');
    expect(html).toContain('>Crear caja para Real cafeteria<span class="sr-only"> · Crear caja</span></a>');
    expect(html).toContain('Siguiente paso: Crear caja.'); expect(html).toContain('0 de 4'); expect(html).not.toContain('<details');
    const done = renderToStaticMarkup(<ReadinessGuide data={{ ...configured(), registers: [{ ...register, has_history: true }] }} readiness={cafeteriaReadiness({ ...configured(), registers: [{ ...register, has_history: true }] })} collapsed />);
    expect(done).toContain('net-launch-done'); expect(done).toContain('Completa: la cafetería ya opera.'); expect(done).toContain('<details'); expect(done).toContain('4 de 4');
  });
  it('location trail: inherited levels then the current area, colegio collapsible on narrow screens, nothing clickable', () => {
    const html = renderToStaticMarkup(<HierarchyTrail levels={[{ label: 'Colegio', name: 'Colegio Ficticio' }, { label: 'Sede', name: 'Santiago' }, { label: 'Cafetería', name: 'Cafetería Santiago' }]} current="Cajas" />);
    expect(html).toContain('aria-label="Ubicación en la estructura"'); expect(html).toContain('data-compact="hide"><span class="hoy-trail-k">Colegio</span><span class="hoy-trail-v">Colegio Ficticio</span>');
    expect(html).toContain('<li data-level="current" aria-current="page">Cajas</li>'); expect(html).not.toMatch(/<a |<button/);
    expect(html.indexOf('Santiago')).toBeLessThan(html.indexOf('Cafetería Santiago')); expect(html.indexOf('Cafetería Santiago')).toBeLessThan(html.indexOf('>Cajas<'));
  });
});
