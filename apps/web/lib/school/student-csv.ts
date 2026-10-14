import { bulkPayloadLimit } from "./bulk-contracts";
export const csvColumns = ["first_name", "last_name", "student_code", "starts_on", "location_id", "grade", "class", "homeroom"] as const;
export type ImportRow = { source_row: number } & Record<typeof csvColumns[number], string | null>;
export const csvTemplate = `${csvColumns.join(",")}\r\n`;
// RFC 4180 state machine; source_row is the original physical line where a record starts.
export function parseStudentCsv(input: string): ImportRow[] {
 if (new TextEncoder().encode(input).length > bulkPayloadLimit) throw new Error("El archivo supera 1 MiB.");
 const text = input.replace(/^\uFEFF/, "");
 const records: { line: number; cells: string[] }[] = [];
 let cells: string[] = [], cell = "", quoted = false, closed = false, line = 1, start = 1;
 const finish = () => { cells.push(cell); records.push({ line: start, cells }); cells = []; cell = ""; closed = false; };
 for (let i = 0; i < text.length; i++) {
  const c = text[i];
  if (quoted) {
   if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
   else { cell += c; if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++; }
  } else if (c === '"') { if (cell || closed) throw new Error(`Comillas inválidas en línea ${line}.`); quoted = true; }
  else if (c === ",") { cells.push(cell); cell = ""; closed = false; }
  else if (c === "\r" || c === "\n") { finish(); if (c === "\r" && text[i + 1] === "\n") i++; line++; start = line; }
  else { if (closed) throw new Error(`Texto después de comillas en línea ${line}.`); cell += c; }
 }
 if (quoted) throw new Error("Campo entre comillas sin cerrar.");
 if (cell || cells.length || closed) finish();
 const header = records.shift()?.cells.map(v => v.trim());
 if (!header || new Set(header).size !== header.length || header.some(v => !csvColumns.includes(v as typeof csvColumns[number])) || csvColumns.slice(0, 4).some(v => !header.includes(v))) throw new Error("Columnas inválidas. Usa la plantilla CSV; las cuatro primeras columnas son obligatorias.");
 if (!records.length || records.length > 200) throw new Error("El archivo debe contener entre 1 y 200 filas de estudiantes.");
 return records.map(record => {
  if (record.cells.length !== header.length) throw new Error(`Cantidad de columnas inválida en línea ${record.line}.`);
  const row = { source_row: record.line } as ImportRow;
  for (const key of csvColumns) { const index = header.indexOf(key); const value = index < 0 ? "" : record.cells[index].trim(); row[key] = csvColumns.indexOf(key) < 4 ? value : value || null; }
  return row;
 });
}
