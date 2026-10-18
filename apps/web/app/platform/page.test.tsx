import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ require: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/platform/customer-console', () => ({ requirePlatform: mocks.require, readPlatform: mocks.read }));
(globalThis as { React?: typeof React }).React = React;
import PlatformHomePage from './page';
const admin = ['platform:tenant:provision', 'platform:identity:link', 'platform:customer_admin:provision', 'platform:tenant:lifecycle:read', 'platform:audit:read', 'platform:team:manage'];
const home = async (capabilities: string[]) => { mocks.require.mockResolvedValue({ identity: { person: { displayName: 'Operadora ficticia' } }, capabilities }); return renderToStaticMarkup(await PlatformHomePage()); };
const cards = (html: string) => [...html.matchAll(/<a class="card p-5" href="([^"]+)"/g)].map(m => m[1]);
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue({ kind: 'ready', value: [] }); });
describe('PIKAS Admin Inicio', () => {
  it('a full Platform Admin with Demo gets Clientes, Nuevo cliente, Equipo and Demo entry points', async () => {
    const html = await home([...admin, 'platform:sandbox:pov:enter']);
    expect(cards(html)).toEqual(['/platform/clientes', '/platform/clientes/nuevo', '/platform/equipo', '/platform/demostracion']);
    expect(html).toContain('<h1 class="text-3xl font-bold">PIKAS Admin</h1>');
    expect(html).toContain('Administra clientes y sus accesos desde aquí.');
  });
  it('Platform Admin without sandbox capability gets no Demo card', async () => {
    expect(cards(await home(admin))).toEqual(['/platform/clientes', '/platform/clientes/nuevo', '/platform/equipo']);
  });
  it('a sandbox-only operator sees only Demo and is not told it administers customers', async () => {
    const html = await home(['platform:sandbox:pov:enter']);
    expect(cards(html)).toEqual(['/platform/demostracion']);
    expect(html).not.toContain('Administra clientes');
    expect(html).toContain('Tu acceso de PIKAS Admin incluye Demo.');
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('each card follows its own capability (no card that leads to a 403)', async () => {
    expect(cards(await home(['platform:team:manage']))).toEqual(['/platform/equipo']);
    expect(cards(await home(['platform:tenant:lifecycle:read']))).toEqual(['/platform/clientes']);
    expect(cards(await home(['platform:tenant:provision']))).toEqual([]);
    expect(await home([])).toContain('Tu acceso no incluye destinos administrativos.');
  });
});
