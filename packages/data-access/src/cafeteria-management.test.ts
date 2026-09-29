import { describe, expect, it } from 'vitest';
import { changeServiceScheduling, saveCafeteriaMenu, saveServiceShift } from './cafeteria-management';
import { resolveCafeteriaService, type CafeteriaMenu, type CafeteriaOperations, type ServiceShift } from './cafeteria';
import { createCatalogProduct, editCatalogProduct } from './products';
import { MAX_PRODUCT_IMAGE_CHARS, MAX_CATALOG_IMAGE_CHARS, PRODUCT_IMAGE_GALLERY, resolveProductImageUrl } from './product-images';
import type { PosMenuItemRecord } from './pos';
const scope = { organizationId: 'cafeteria-demo', locationId: 'principal' };
const product: PosMenuItemRecord = { id: 'p', name: 'Pasta', description: '', category: 'Almuerzo', priceMinor: 0, available: true, active: true, allergens: ['Gluten'], ingredients: [], restrictionTags: [], imageUrl: null };
const menu: CafeteriaMenu = { ...scope, id: 'm', name: 'Desayuno', active: true };
const shift: ServiceShift = { ...scope, id: 's', name: 'Mañana', menuId: 'm', weekdays: [1], startTime: '07:00', endTime: '10:00', enabled: true };
const empty = (): CafeteriaOperations => ({ menus: [], menuProducts: [], serviceShifts: [], registers: [], serviceSettings: { enabled: false, timeZone: 'America/Santo_Domingo' } });
describe('menu and service mutations', () => {
  it('references products across menus, edits descriptions and removes membership without deleting products', () => {
    const products = [product];
    let ops = saveCafeteriaMenu(empty(), products, menu, ['p'], scope);
    ops = saveCafeteriaMenu(ops, products, { ...menu, id: 'm2' }, ['p'], scope);
    expect(ops.menuProducts).toHaveLength(2); expect(products).toEqual([product]);
    const previous = ops.menus[0]!;
    ops = saveCafeteriaMenu(ops, products, { ...previous, description: 'Nuevo', active: false }, [], scope, { menu: previous, productIds: ['p'] });
    expect(ops.menuProducts).toEqual([{ menuId: 'm2', productId: 'p' }]);
    expect(ops.menus[0]).toMatchObject({ description: 'Nuevo', active: false });
    expect(products).toHaveLength(1);
  });
  it('rejects invalid products, duplicates, stale edits and wrong scope', () => {
    expect(() => saveCafeteriaMenu(empty(), [product], menu, ['missing'], scope)).toThrow();
    expect(() => saveCafeteriaMenu(empty(), [product], menu, ['p', 'p'], scope)).toThrow();
    expect(() => saveCafeteriaMenu(empty(), [product], { ...menu, locationId: 'other' }, [], scope)).toThrow('autorizada');
    const ops = saveCafeteriaMenu(empty(), [product], menu, ['p'], scope);
    expect(() => saveCafeteriaMenu(ops, [product], menu, [], scope, { menu, productIds: [] })).toThrow('otra sesión');
  });
  it('creates, edits, disables and reenables shifts with overlap checks even while globally off', () => {
    let ops = saveCafeteriaMenu(empty(), [product], menu, ['p'], scope);
    ops = saveServiceShift(ops, shift, scope);
    ops = saveServiceShift(ops, { ...shift, id: 'next', startTime: '10:00', endTime: '12:00' }, scope);
    expect(() => saveServiceShift(ops, { ...shift, id: 'overlap', startTime: '09:00' }, scope)).toThrow('superponerse');
    const previous = ops.serviceShifts[0]!;
    ops = saveServiceShift(ops, { ...previous, enabled: false, weekdays: [2] }, scope, previous);
    expect(ops.serviceShifts[0]).toMatchObject({ enabled: false, weekdays: [2] });
    expect(() => saveServiceShift(ops, shift, scope, previous)).toThrow('otra sesión');
    ops = saveServiceShift(ops, { ...ops.serviceShifts[0]!, enabled: true }, scope, ops.serviceShifts[0]);
    const snapshot = structuredClone(ops.serviceShifts);
    ops = changeServiceScheduling(ops, true, false); ops = changeServiceScheduling(ops, false, true); ops = changeServiceScheduling(ops, true, false);
    expect(ops.serviceShifts).toEqual(snapshot);
    expect(() => changeServiceScheduling(ops, false, false)).toThrow('cambió');
  });
  it.each([{ weekdays: [] }, { endTime: '07:00' }, { startTime: '22:00', endTime: '06:00' }, { menuId: 'missing' }])('rejects invalid proposed shift %j', patch => {
    const ops = saveCafeteriaMenu(empty(), [product], menu, ['p'], scope);
    expect(() => saveServiceShift(ops, { ...shift, ...patch }, scope)).toThrow();
  });
  it('retains inactive-menu schedules but resolver offers no products; product edits resolve through references', () => {
    let ops = saveCafeteriaMenu(empty(), [product], menu, ['p'], scope);
    ops = changeServiceScheduling(saveServiceShift(ops, shift, scope), true, false);
    const edited = editCatalogProduct([product], { ...product, priceMinor: 19500 });
    expect(resolveCafeteriaService({ operations: ops, products: edited, scope, now: '2026-09-28T08:00:00-04:00' }).products[0]?.priceMinor).toBe(19500);
    ops = saveCafeteriaMenu(ops, edited, { ...ops.menus[0]!, active: false }, ['p'], scope, { menu: ops.menus[0]!, productIds: ['p'] });
    expect(ops.serviceShifts[0]?.enabled).toBe(true);
    expect(resolveCafeteriaService({ operations: ops, products: edited, scope, now: '2026-09-28T08:00:00-04:00' }).status).toBe('inactive_menu');
  });
});
describe('bounded demo product images', () => {
  it('resolves gallery paths by stable identity, independent of stored filenames', () => {
    expect(resolveProductImageUrl({ imageAssetId: 'pikas-food-001', imageUrl: '/old-name.svg' })).toBe('/menu/pasta.svg');
    expect(resolveProductImageUrl({ imageUrl: null })).toBeNull();
  });
  const image = 'data:image/webp;base64,UklGRg==';
  it('accepts gallery identity, upload, replacement and removal while retaining unrelated metadata', () => {
    const asset = PRODUCT_IMAGE_GALLERY[0];
    let products = createCatalogProduct([], { ...product, imageUrl: asset.src, imageAssetId: asset.id });
    products = editCatalogProduct(products, { ...products[0]!, imageUrl: image, imageAssetId: null });
    products = editCatalogProduct(products, { ...products[0]!, name: 'Nuevo' });
    expect(products[0]).toMatchObject({ imageUrl: image, allergens: ['Gluten'] });
    products = editCatalogProduct(products, { ...products[0]!, imageUrl: null });
    expect(products[0]?.imageUrl).toBeNull();
  });
  it('rejects mismatched gallery IDs, unsafe image types and oversized uploads', () => {
    expect(() => createCatalogProduct([], { ...product, imageUrl: '/menu/pizza.svg', imageAssetId: 'pikas-food-001' })).toThrow('Referencia');
    expect(() => createCatalogProduct([], { ...product, imageUrl: 'data:image/svg+xml;base64,AAAA' })).toThrow();
    expect(() => createCatalogProduct([], { ...product, imageUrl: image + 'A'.repeat(MAX_PRODUCT_IMAGE_CHARS) })).toThrow();
  });
  it('enforces total image budget without modifying the existing catalog', () => {
    const src = 'data:image/webp;base64,' + 'A'.repeat(60_000);
    const existing = Array.from({ length: Math.floor(MAX_CATALOG_IMAGE_CHARS / src.length) }, (_, index) => ({ ...product, id: String(index), imageUrl: src }));
    const before = structuredClone(existing);
    expect(() => createCatalogProduct(existing, { ...product, imageUrl: src })).toThrow('límite');
    expect(existing).toEqual(before);
  });
});
