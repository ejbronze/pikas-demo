import { describe, expect, it } from 'vitest';
import { createCatalogProduct, editCatalogProduct } from './products';
import { preparePosPurchase, validateGeneralCashPurchase, type PosMenuItemRecord } from './pos';
import { quickAccess } from './financial';
const product: PosMenuItemRecord = { id: 'p', name: 'Pasta', description: '', category: 'Almuerzo', priceMinor: 18000, available: true, active: true, imageUrl: null, ingredients: ['Trigo'], allergens: ['Gluten'], restrictionTags: ['Vegetariano'] };
describe('product management', () => {
  it('creates a zero-price product and rejects duplicate IDs', () => {
    const created = createCatalogProduct([], { ...product, priceMinor: 0 });
    expect(created[0]?.priceMinor).toBe(0);
    expect(validateGeneralCashPurchase(created, [{ itemId: 'p', quantity: 1 }]).ok).toBe(true);
    expect(() => createCatalogProduct(created, product)).toThrow('ya existe');
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid price %s', priceMinor => {
    expect(() => createCatalogProduct([], { ...product, priceMinor })).toThrow('Precio');
    expect(() => editCatalogProduct([product], { ...product, priceMinor })).toThrow('Precio');
  });
  it('validates required fields and local images', () => {
    expect(() => createCatalogProduct([], { ...product, name: ' ' })).toThrow('Nombre');
    expect(() => createCatalogProduct([], { ...product, category: '' })).toThrow('Categoría');
    expect(() => createCatalogProduct([], { ...product, imageUrl: 'https://example.com/new.png' })).toThrow('imagen');
  });
  it('preserves metadata and permits removing an existing image', () => {
    const original = { ...product, imageUrl: '/menu/pasta.svg' };
    const edited = editCatalogProduct([original], { ...original, priceMinor: 19500, imageUrl: null }, original)[0]!;
    expect(edited).toEqual({ ...original, priceMinor: 19500, imageUrl: null });
    expect(original.priceMinor).toBe(18000);
  });
  it('does not mistake normalization property order for a stale edit', () => {
    const reordered = Object.fromEntries(Object.entries(product).reverse()) as PosMenuItemRecord;
    expect(editCatalogProduct([reordered], { ...product, imageAssetId: 'pikas-food-001', imageUrl: '/menu/pasta.svg' }, product)[0]?.imageAssetId).toBe('pikas-food-001');
  });
  it('rejects stale editors', () => {
    expect(() => editCatalogProduct([{ ...product, priceMinor: 19500 }], { ...product, name: 'Otra pasta' }, product)).toThrow('otra sesión');
  });
  it.each([{ active: false }, { available: false }])('prevents new sales independently for %j', change => {
    const catalog = editCatalogProduct([product], { ...product, ...change });
    expect(validateGeneralCashPurchase(catalog, [{ itemId: 'p', quantity: 1 }])).toMatchObject({ ok: false, reason: 'item_unavailable' });
    expect(quickAccess(catalog, [], undefined, 'cafeteria-demo', 'principal', '2026-09-25T12:00:00Z').cafeteria).toEqual([]);
  });
  it('keeps completed purchase snapshots after product editing', () => {
    const sale = preparePosPurchase({ menu: [product], cart: [{ itemId: 'p', quantity: 1 }], idempotencyKey: 'key', purchases: [], employeeLabel: 'Caja', now: '2026-09-25T12:00:00Z', purchaseId: 'sale', paymentMethod: 'cash', studentAssociation: 'general_sale', cashReceivedMinor: 18000 });
    expect(sale.ok).toBe(true);
    if (!sale.ok) throw new Error('Expected purchase');
    const before = structuredClone(sale.purchase);
    const edited = editCatalogProduct([product], { ...product, name: 'Pasta nueva', priceMinor: 19500 });
    expect(validateGeneralCashPurchase(edited, [{ itemId: 'p', quantity: 1 }])).toMatchObject({ ok: true, totalMinor: 19500 });
    expect(sale.purchase).toEqual(before);
    expect(sale.purchase.items[0]?.unitPriceMinor).toBe(18000);
    expect(quickAccess([{ ...product, active: false }], [sale.purchase], undefined, 'cafeteria-demo', 'principal', '2026-09-25T12:01:00Z').cafeteria).toEqual([]);
  });
});
