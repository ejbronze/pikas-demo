// PIKAS report CSV output (UX 8). One spreadsheet-safe format for every role's report: UTF-8 BOM,
// CRLF, quoted cells, formula-prefix protection. Callers pass only rows the report already shows.
export function csvCell(value: string | null): string {
 const cell = value ?? "";
 // Protect spreadsheet interpretation, including whitespace/control-prefixed formulas.
 const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(cell) || /^[\t\r\n]/u.test(cell) ? "'" + cell : cell;
 return '"' + safe.replaceAll('"', '""') + '"';
}
// An amount built from integer minor units: written as a plain signed decimal ("-15.00") so spreadsheets
// read it as a number. Only csvAmount creates one, so it can never carry a formula.
export type CsvNumber = { readonly csvNumber: string };
export function csvAmount(minor: string): CsvNumber { const n = BigInt(minor), abs = n < 0n ? -n : n; return { csvNumber: `${n < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}` }; }
const cell = (v: string | null | CsvNumber) => v !== null && typeof v === "object" ? `"${v.csvNumber}"` : csvCell(v);
export const csvDocument = (headers: string[], rows: (string | null | CsvNumber)[][]) => "﻿" + [headers, ...rows].map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";
import { businessDate } from "../business-date";
export { businessDate };
export const csvFilename = (report: string, date = new Date()) => `${report}-${businessDate(date)}.csv`;
export const csvResponse = (body: string, filename: string, rows: number) => new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8",
  "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Pikas-Export-Rows": String(rows) } });
// A CSV download is a same-site navigation; a cross-site request is refused before any read.
export const crossSite = (request: Request) => { const site = request.headers.get("sec-fetch-site"); return site !== null && site !== "same-origin" && site !== "none"; };
