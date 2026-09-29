import type { PosMenuItemRecord } from './pos';
import { PRODUCT_IMAGE_GALLERY, MAX_CATALOG_IMAGE_CHARS, isDemoUploadedImage } from './product-images';

export const DEMO_PRODUCT_IMAGES = PRODUCT_IMAGE_GALLERY.map(image => image.src);

export function validateProduct(input: PosMenuItemRecord, previous?: PosMenuItemRecord): PosMenuItemRecord {
  const text = (value: string, label: string, max: number, required = false) => {
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new Error(`${label}: revisa el campo.`);
    return value.trim();
  };
  const list = (values: string[], label: string) => {
    if (!Array.isArray(values) || values.length > 30) throw new Error(`${label}: usa hasta 30 entradas.`);
    return values.map(value => text(value, label, 80, true));
  };
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 0) throw new Error('Precio no válido. Usa un importe mayor o igual a RD$0, con hasta dos decimales.');
  if (typeof input.available !== 'boolean' || (input.active !== undefined && typeof input.active !== 'boolean')) throw new Error('Estado del producto no válido.');
  if (input.imageAssetId && !PRODUCT_IMAGE_GALLERY.some(image => image.id === input.imageAssetId && image.src === input.imageUrl)) throw new Error('Referencia de galería no válida.');
  if (input.imageUrl?.startsWith('data:') && !isDemoUploadedImage(input.imageUrl)) throw new Error('La imagen supera el tamaño permitido o no es válida.');
  if (input.imageUrl !== null && !isDemoUploadedImage(input.imageUrl) && !(DEMO_PRODUCT_IMAGES as readonly string[]).includes(input.imageUrl) && input.imageUrl !== previous?.imageUrl) throw new Error('Selecciona una imagen disponible.');
  return { ...input, id: text(input.id, 'Identificador', 120, true), name: text(input.name, 'Nombre', 120, true), description: text(input.description, 'Descripción', 500), category: text(input.category, 'Categoría', 80, true), ingredients: list(input.ingredients, 'Ingredientes'), allergens: list(input.allergens, 'Alérgenos'), restrictionTags: list(input.restrictionTags, 'Etiquetas alimentarias'), active: input.active ?? previous?.active ?? true };
}

export function createCatalogProduct(products: PosMenuItemRecord[], input: PosMenuItemRecord): PosMenuItemRecord[] {
  const product = validateProduct(input);
  if (products.some(item => item.id === product.id)) throw new Error('El producto ya existe.');
  return enforceImageBudget([...products, product]);
}

export function editCatalogProduct(products: PosMenuItemRecord[], input: PosMenuItemRecord, expected?: PosMenuItemRecord): PosMenuItemRecord[] {
  const previous = products.find(item => item.id === input.id);
  if (!previous) throw new Error('Producto no encontrado.');
  const snapshot = (item: PosMenuItemRecord) => JSON.stringify(Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))));
  if (expected && snapshot(previous) !== snapshot(expected)) throw new Error('Este producto cambió en otra sesión. Cancela y vuelve a abrirlo para revisar los cambios.');
  const product = validateProduct(input, previous);
  return enforceImageBudget(products.map(item => item.id === product.id ? product : item));
}

function enforceImageBudget(products: PosMenuItemRecord[]) {
  if (products.reduce((sum, item) => sum + (item.imageUrl?.startsWith('data:') ? item.imageUrl.length : 0), 0) > MAX_CATALOG_IMAGE_CHARS) throw new Error('Se alcanzó el límite de imágenes subidas del demo. Quita una imagen o usa Galería PIKAS.');
  return products;
}
