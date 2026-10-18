import { describe, expect, it } from 'vitest';
import { parseProductCsv, productCsvTemplate } from './product-csv';

const catalog = { categories: ['Bebidas', 'Almuerzos'], productNames: ['Agua ficticia'] };
let n = 0; const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
// Pads unquoted short rows to the 9-column header (quoted cells may contain commas, so rows with quotes are given whole).
const pad = (row: string) => row === '' || row.includes('"') ? row : row + ','.repeat(Math.max(0, 8 - (row.match(/,/g)?.length ?? 0)));
const csv = (...rows: string[]) => ['nombre,categoria,precio,unidad,descripcion,disponible,activo,ingredientes,alergenos', ...rows.map(pad)].join('\r\n');

describe('product CSV import (parse + validate only)', () => {
  it('template exposes exactly the supported columns', () => {
    expect(productCsvTemplate).toBe('﻿nombre,categoria,precio,unidad,descripcion,disponible,activo,ingredientes,alergenos\r\n');
  });
  it('accepts valid rows, normalizes category spelling and applies defaults and lists', () => {
    const r = parseProductCsv('﻿' + csv('Jugo de china,bebidas,75,Vaso,"Natural, sin azúcar",sí,,naranja|agua,', 'Pollo guisado,ALMUERZOS,195.50,,,no,no,,'), catalog, id);
    expect(r.problems).toEqual([]);
    expect(r.valid.map(v => [v.line, v.item.name, v.item.category, v.item.priceMinor, v.item.unit, v.item.available, v.item.active])).toEqual([[2, 'Jugo de china', 'Bebidas', 7500, 'Vaso', true, true], [3, 'Pollo guisado', 'Almuerzos', 19550, 'Unidad', false, false]]);
    expect(r.valid[0].item.description).toBe('Natural, sin azúcar'); expect(r.valid[0].item.ingredients).toEqual(['naranja', 'agua']);
  });
  it('only the three required columns are needed; column order is free', () => {
    const r = parseProductCsv('precio,nombre,categoria\n10.00,Galleta,Bebidas', catalog, id);
    expect(r.valid).toHaveLength(1); expect(r.valid[0].item.available).toBe(true);
  });
  it.each([
    ['missing name', ',Bebidas,10', 'Falta el nombre.'],
    ['missing price', 'Té,Bebidas,', 'Falta el precio.'],
    ['invalid price', 'Té,Bebidas,10.505', 'Precio no válido'],
    ['extra unquoted comma', 'Té,Bebidas,10,5,,,,,,', 'columnas'],
    ['comma decimal', 'Té,Bebidas,"10,50",,,,,,', 'Precio no válido'],
    ['negative price', 'Té,Bebidas,-5', 'Precio no válido'],
    ['unknown category', 'Té,Postres,10', 'Categoría desconocida: «Postres»'],
    ['bad status', 'Té,Bebidas,10,,,quizás', 'Valor de «disponible» no válido'],
    ['existing product', 'agua FICTICIA,Bebidas,10', 'Ya existe un producto con este nombre'],
    ['too long name', `${'x'.repeat(121)},Bebidas,10`, 'Nombre: revisa el campo.'],
  ])('flags %s with a readable reason and never coerces it', (_label, row, reason) => {
    const r = parseProductCsv(csv(row), catalog, id);
    expect(r.valid).toEqual([]); expect(r.problems[0].problems.join(' ')).toContain(reason);
  });
  it('duplicates inside the file: the first is valid, the later one is flagged with the original line', () => {
    const r = parseProductCsv(csv('Té frío,Bebidas,10', 'te frio,Bebidas,12'), catalog, id);
    expect(r.valid.map(v => v.line)).toEqual([2]); expect(r.problems).toEqual([{ line: 3, name: 'te frio', problems: ['Nombre repetido en el archivo (también en la línea 2).'] }]);
  });
  it('row with the wrong number of columns is a row problem; blank lines are ignored', () => {
    const r = parseProductCsv(['nombre,categoria,precio', 'Té,Bebidas', '', 'Café,Bebidas,40'].join('\n'), catalog, id);
    expect(r.problems[0].problems[0]).toContain('columnas'); expect(r.valid.map(v => v.item.name)).toEqual(['Café']);
  });
  it.each([
    ['unknown column', 'nombre,categoria,precio,stock\nTé,Bebidas,10,4', 'Columnas inválidas'],
    ['missing required column', 'nombre,precio\nTé,10', 'Columnas inválidas'],
    ['no data rows', 'nombre,categoria,precio\n', 'no tiene productos'],
    ['unterminated quote', 'nombre,categoria,precio\n"Té,Bebidas,10', 'comillas'],
    ['too many rows', ['nombre,categoria,precio', ...Array.from({ length: 201 }, (_, i) => `P${i},Bebidas,1`)].join('\n'), 'máximo por importación es 200'],
  ])('file-level problem: %s', (_label, text, message) => {
    expect(() => parseProductCsv(text, catalog, id)).toThrow(new RegExp(message, 'i'));
  });
});
