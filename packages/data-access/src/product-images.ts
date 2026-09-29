/** Stable catalog identities; filenames and labels may change without changing product identity. */
export const PRODUCT_IMAGE_CATEGORIES = ['Desayuno', 'Almuerzo', 'Sándwiches', 'Pizza', 'Frutas', 'Bebidas', 'Snacks', 'Postres'] as const;
export const PRODUCT_IMAGE_GALLERY = [
  { id: 'pikas-food-001', src: '/menu/pasta.svg', name: 'Pasta con pollo', category: 'Almuerzo' },
  { id: 'pikas-food-002', src: '/menu/sandwich.svg', name: 'Sándwich integral', category: 'Sándwiches' },
  { id: 'pikas-food-003', src: '/menu/pizza.svg', name: 'Pizza', category: 'Pizza' },
  { id: 'pikas-food-004', src: '/menu/drink.svg', name: 'Bebida', category: 'Bebidas' },
] as const;
export const MAX_PRODUCT_IMAGE_CHARS = 65_536;
export const MAX_CATALOG_IMAGE_CHARS = 524_288;
export const isDemoUploadedImage = (src: string) => src.length <= MAX_PRODUCT_IMAGE_CHARS && /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);

/** Gallery identity owns the path; imageUrl remains compatible with existing image consumers. */
export function resolveProductImageUrl(product: { imageAssetId?: string | null; imageUrl?: string | null }): string | null | undefined {
  return PRODUCT_IMAGE_GALLERY.find(asset => asset.id === product.imageAssetId)?.src ?? product.imageUrl;
}
