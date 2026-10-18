// RFC 4180 state machine shared by CSV imports; `line` is the original physical line where a record starts.
export function parseCsvRecords(input: string): { line: number; cells: string[] }[] {
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
 return records;
}
