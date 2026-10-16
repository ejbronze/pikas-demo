import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { CafeteriaOperations } from './cafeteria-operations';
(globalThis as {
    React?: typeof React;
}).React = React;
const id = '5a000000-0000-4000-8000-000000000001';
describe('connected financial history presentation', () => {
    it('truthfully explains the frozen sandbox financial boundary', () => { const html = renderToStaticMarkup(<CafeteriaOperations cafeteriaId={id} actorId={id} kind="transactions" sandbox/>); expect(html).toContain('no concede acceso a operaciones financieras'); expect(html).not.toContain('Efectivo contado'); });
    it('shows loading without fabricating transaction facts', () => { const html = renderToStaticMarkup(<CafeteriaOperations cafeteriaId={id} actorId={id} kind="transactions" sandbox={false}/>); expect(html).toContain('<h1'); expect(html).toContain('Cargando historial'); expect(html).not.toContain('Recibo #'); });
    it('keeps the session title beneath existing Cajas heading', () => { const html = renderToStaticMarkup(<CafeteriaOperations cafeteriaId={id} actorId={id} kind="sessions" sandbox={false}/>); expect(html).toContain('<h2'); expect(html).toContain('Historial de caja'); });
});
