import { MAX_PRODUCT_IMAGE_CHARS } from '@pikas/data-access';

/** Replace this adapter with an object-storage uploader later; callers receive an image reference. */
export async function prepareDemoProductImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Usa una imagen JPG, PNG o WebP.');
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('La imagen debe pesar como máximo 5 MB.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('No se pudo leer la imagen. Selecciona otro archivo.'); }
  try {
    if (bitmap.width * bitmap.height > 16_000_000) throw new Error('Usa una imagen de hasta 16 megapíxeles.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la imagen.');
    for (const size of [640, 480, 320]) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.65, 0.45]) {
        const data = canvas.toDataURL('image/webp', quality);
        if (data.length <= MAX_PRODUCT_IMAGE_CHARS) return data;
      }
    }
    throw new Error('La imagen sigue siendo demasiado grande. Usa una imagen más sencilla.');
  } finally { bitmap.close(); }
}
