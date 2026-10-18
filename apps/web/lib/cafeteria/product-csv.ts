import { parseMoney, validateProduct, type PosMenuItemRecord } from '@pikas/data-access';
import { parseCsvRecords } from '../csv-records';

// Wave D.2 product import: parse and validate only. Each valid row later becomes one ordinary
// product_save through the existing catalog command path (same authority, validation and journal).
export const productCsvColumns = ['nombre', 'categoria', 'precio', 'unidad', 'descripcion', 'disponible', 'activo', 'ingredientes', 'alergenos'] as const;
export const productCsvRequired = ['nombre', 'categoria', 'precio'] as const;
export const productCsvMaxRows = 200;
export const productCsvMaxBytes = 1024 * 1024;
export const productCsvTemplate = `﻿${productCsvColumns.join(',')}\r\n`;
type Column = typeof productCsvColumns[number];
export type ProductCsvValid = { line: number; item: PosMenuItemRecord };
export type ProductCsvProblem = { line: number; name: string; problems: string[] };
export type ProductCsvResult = { valid: ProductCsvValid[]; problems: ProductCsvProblem[] };

const key = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLocaleLowerCase('es');
const yesNo = (value: string): boolean | null | 'invalid' => {
  const v = key(value);
  if (!v) return null;
  if (['si', 'sí', 'true', '1'].includes(v)) return true;
  if (['no', 'false', '0'].includes(v)) return false;
  return 'invalid';
};
const list = (value: string) => value.split('|').map(v => v.trim()).filter(Boolean);

// Throws for file-level problems (encoding, size, columns, row count); returns row-level problems otherwise.
export function parseProductCsv(input: string, catalog: { categories: string[]; productNames: string[] }, newId: () => string = () => crypto.randomUUID()): ProductCsvResult {
  if (new TextEncoder().encode(input).length > productCsvMaxBytes) throw new Error('El archivo supera 1 MB.');
  const records = parseCsvRecords(input).filter(r => r.cells.some(c => c.trim()));
  const header = records.shift()?.cells.map(c => key(c));
  if (!header || new Set(header).size !== header.length || header.some(c => !productCsvColumns.includes(c as Column)) || productCsvRequired.some(c => !header.includes(c)))
    throw new Error(`Columnas inválidas. Usa la plantilla: ${productCsvColumns.join(', ')}. Obligatorias: ${productCsvRequired.join(', ')}.`);
  if (!records.length) throw new Error('El archivo no tiene productos.');
  if (records.length > productCsvMaxRows) throw new Error(`El archivo tiene ${records.length} productos; el máximo por importación es ${productCsvMaxRows}.`);
  const categories = new Map(catalog.categories.map(c => [key(c), c]));
  const existing = new Set(catalog.productNames.map(key));
  const seen = new Map<string, number>();
  const result: ProductCsvResult = { valid: [], problems: [] };
  for (const record of records) {
    const cell = (c: Column) => { const i = header.indexOf(c); return i < 0 ? '' : (record.cells[i] ?? '').trim(); };
    const problems: string[] = [];
    if (record.cells.length !== header.length) problems.push(`Tiene ${record.cells.length} columnas; se esperaban ${header.length}.`);
    const name = cell('nombre');
    if (!name) problems.push('Falta el nombre.');
    const category = categories.get(key(cell('categoria')));
    if (!cell('categoria')) problems.push('Falta la categoría.');
    else if (!category) problems.push(`Categoría desconocida: «${cell('categoria')}». Usa una categoría activa existente.`);
    const priceMinor = parseMoney(cell('precio'));
    if (!cell('precio')) problems.push('Falta el precio.');
    else if (priceMinor === null) problems.push(`Precio no válido: «${cell('precio')}». Usa números con punto decimal, por ejemplo 195.00.`);
    const available = yesNo(cell('disponible')), active = yesNo(cell('activo'));
    if (available === 'invalid') problems.push(`Valor de «disponible» no válido: «${cell('disponible')}». Usa sí o no.`);
    if (active === 'invalid') problems.push(`Valor de «activo» no válido: «${cell('activo')}». Usa sí o no.`);
    if (name) {
      const previous = seen.get(key(name));
      if (previous !== undefined) problems.push(`Nombre repetido en el archivo (también en la línea ${previous}).`);
      else seen.set(key(name), record.line);
      if (existing.has(key(name))) problems.push('Ya existe un producto con este nombre en el catálogo.');
    }
    let item: PosMenuItemRecord | null = null;
    if (!problems.length && category && priceMinor !== null) {
      try {
        item = validateProduct({ id: newId(), name, description: cell('descripcion'), category, unit: cell('unidad') || 'Unidad', priceMinor,
          available: available === null ? true : available as boolean, active: active === null ? true : active as boolean,
          ingredients: list(cell('ingredientes')), allergens: list(cell('alergenos')), restrictionTags: [], imageUrl: null, imageAssetId: null } as PosMenuItemRecord);
      } catch (cause) { problems.push(cause instanceof Error ? cause.message : 'Datos no válidos.'); }
    }
    if (problems.length || !item) result.problems.push({ line: record.line, name: name || '(sin nombre)', problems });
    else result.valid.push({ line: record.line, item });
  }
  return result;
}
