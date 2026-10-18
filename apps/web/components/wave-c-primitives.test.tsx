import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/escuela' }));
vi.mock('./brand-logo', () => ({ BrandLogo: () => <span>PIKAS</span> }));
vi.mock('@/lib/auth/application-session', async () => await import('../lib/auth/application-session'));
(globalThis as { React?: typeof React }).React = React;
import { AppPageHeader } from './app-page-header';
import { EmptyState, ErrorState } from './state-panels';
import { MetricCard } from './metric-card';
import { DataList } from './data-list';
import { SessionStatePanel } from './auth/session-security-boundary';
import { getLoginErrorMessage } from '../app/login/login-error';

describe('AppPageHeader', () => {
  it('renders one h1 title, optional description and action, no eyebrow', () => {
    const html = renderToStaticMarkup(<AppPageHeader title="Estudiantes" description="Gestiona estudiantes." action={<button className="btn">Crear estudiante</button>} />);
    expect(html.match(/<h1/g)).toHaveLength(1); expect(html).toMatch(/<h1[^>]*>Estudiantes<\/h1>/);
    expect(html).toContain('Gestiona estudiantes.'); expect(html).toContain('Crear estudiante');
    expect(html).not.toContain('Administración escolar'); expect(html).not.toContain('<a ');
  });
  it('a back link appears only when the page names a logical parent', () => {
    const html = renderToStaticMarkup(<AppPageHeader back={{ href: '/platform/clientes', label: 'Clientes' }} title="Cliente ficticio" meta="C-1 · Activo" />);
    expect(html).toContain('href="/platform/clientes"'); expect(html).toContain('Clientes</a>'); expect(html).toContain('min-h-11'); expect(html).toContain('C-1 · Activo');
    expect(html).not.toMatch(/›|&gt;.*&gt;/); // no breadcrumb trail
    expect(renderToStaticMarkup(<AppPageHeader title="Resumen" />)).not.toContain('href=');
  });
});

describe('EmptyState / ErrorState', () => {
  it('empty is a status with guidance, never an alert', () => {
    const html = renderToStaticMarkup(<EmptyState title="No hay clientes que coincidan." description="Ajusta los filtros." />);
    expect(html).toContain('role="status"'); expect(html).not.toContain('role="alert"'); expect(html).toContain('Ajusta los filtros.');
  });
  it('error is an alert with a safe retry, distinct from empty', () => {
    const html = renderToStaticMarkup(<ErrorState title="No pudimos cargar esta sección." retryHref="/admin/escuela?school=x" />);
    expect(html).toContain('role="alert"'); expect(html).toContain('href="/admin/escuela?school=x"'); expect(html).toContain('Reintentar'); expect(html).not.toContain('role="status"');
    expect(renderToStaticMarkup(<ErrorState title="Sin permiso." />)).not.toContain('Reintentar');
  });
});

describe('MetricCard / DataList', () => {
  it('metric keeps dt/dd semantics', () => {
    expect(renderToStaticMarkup(<dl><MetricCard label="Estudiantes" help="Total">4</MetricCard></dl>)).toMatch(/<dt[^>]*>Estudiantes<\/dt><dd[^>]*>4<\/dd>/);
  });
  it('one dataset renders as a captioned table (≥1024 px) and as compact rows below', () => {
    const rows = [{ id: 'a', name: 'Cliente A', state: 'Activo' }, { id: 'b', name: 'Cliente B', state: 'Suspendido' }];
    const html = renderToStaticMarkup(<DataList label="Clientes" rows={rows} rowKey={r => r.id} columns={[{ header: 'Estado', cell: r => r.state }, { header: 'Cliente', primary: true, cell: r => r.name }]} />);
    expect(html).toContain('hidden overflow-hidden lg:block'); expect(html).toContain('<caption class="sr-only">Clientes</caption>');
    expect(html.match(/<th scope="col"/g)).toHaveLength(2); expect(html).toContain('lg:hidden'); expect(html).toContain('aria-label="Clientes"');
    expect(html.match(/<li /g)).toHaveLength(2); expect(html).toContain('Estado:</dt>');
  });
});

describe('session states (presentation only)', () => {
  it('ended: explains, offers one safe action to the right entrance and promises no replay', () => {
    const html = renderToStaticMarkup(<SessionStatePanel ended platform={false} />);
    expect(html).toContain('Tu sesión terminó'); expect(html).toContain('href="/login"'); expect(html).toContain('No se repetirá ninguna operación');
    expect(html).not.toContain('backoffice'); expect(html.match(/<a /g)).toHaveLength(1);
    expect(renderToStaticMarkup(<SessionStatePanel ended platform />)).toContain('href="/backoffice/login"');
  });
  it('verifying is not presented as an ended session', () => {
    const html = renderToStaticMarkup(<SessionStatePanel ended={false} platform={false} />);
    expect(html).toContain('Verificando tu sesión'); expect(html).not.toContain('Tu sesión terminó');
  });
  it('school authority denial now explains itself on the login page', () => {
    expect(getLoginErrorMessage('school_authority')?.body).toMatch(/sesión terminó o tu acceso cambió/);
  });
});
