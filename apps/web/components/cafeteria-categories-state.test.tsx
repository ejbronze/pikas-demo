import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => '/admin/cafeteria' }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('./product-image-picker', () => ({ ProductImagePicker: () => null }));
vi.mock('./demo-provider', () => { throw Error('Connected workspace must not load demo authority'); });
(globalThis as { React?: typeof React }).React = React;
import { ConnectedCafeteriaPages } from './connected-cafeteria-pages';
import { ConnectedCafeteriaProvider } from './connected-cafeteria-provider';
import { cafeteriaRead } from '../lib/cafeteria/test-fixtures';

// UX 14 (audit A-9): Productos → Categorías teaches when empty and keeps its controls when not.
const products = (data: ReturnType<typeof cafeteriaRead>) => renderToStaticMarkup(<ConnectedCafeteriaProvider data={data}><ConnectedCafeteriaPages section="products" data={data} /></ConnectedCafeteriaProvider>);
describe('Categorías empty state', () => {
  it('no categories: what they are, why CSV needs one, the create form visible, and a visible CSV prerequisite', () => {
    const data = cafeteriaRead(); data.categories = []; data.products = [];
    const html = products(data);
    expect(html).toContain('Aún no hay categorías en esta cafetería.'); expect(html).toContain('agrupa productos parecidos'); expect(html).toContain('importación por CSV solo acepta categorías');
    expect(html).toContain('Es normal al empezar.'); expect(html).toContain('Crear categoría'); expect(html).toContain('Nombre de categoría'); expect(html).toContain('id="categorias"');
    expect(html).toContain('Para importar productos desde CSV, primero crea una categoría'); expect(html).toContain('href="#categorias"');
    expect(html).toContain('Aún no hay productos.'); expect(html).toContain('crea una categoría primero para poder importar');
    expect(html).not.toContain('role="alert"'); expect(html).not.toContain('data-mascot'); // benign, and the Cafetería stays mascot-free (Phase 1 scope)
  });
  it('with categories: the panel keeps the create form and per-category controls; no prerequisite notice', () => {
    const data = cafeteriaRead(); data.categories = [{ id: '4d700000-0000-4000-8000-0000000000c1', name: 'Bebidas', status: 'active', display_order: 0, version: 1 }];
    const html = products(data);
    expect(html).toContain('Crear categoría'); expect(html).toContain('Guardar categoría'); expect(html).not.toContain('Aún no hay categorías'); expect(html).not.toContain('Para importar productos desde CSV, primero');
  });
});
