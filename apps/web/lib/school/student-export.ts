import { z } from "zod";
import type { SchoolStudent } from "./contracts";
export const studentExportLimit = 1000;
export const exportFiltersSchema = z.object({ schoolId: z.uuid(), query: z.string().max(80), status: z.enum(["", "active", "suspended", "inactive"]), location: z.uuid().nullable(), grade: z.string().min(1).max(80).nullable() }).strict();
export type ExportFilters = z.infer<typeof exportFiltersSchema>;
const text = z.string();
export const exportRowSchema = z.object({ student_code: text, first_name: text, last_name: text, display_name: text, status: z.enum(["active", "suspended", "inactive"]), campus: text.nullable(), grade: text.nullable(), class: text.nullable(), homeroom: text.nullable() }).strict();
export type ExportStudent = z.infer<typeof exportRowSchema>;
export const exportResultSchema = z.object({ school_id: z.uuid(), actor_id: z.uuid(), rows: z.array(exportRowSchema).max(studentExportLimit) }).strict();
export function visibleExportRows(students: SchoolStudent[], locations: { id: string; name: string }[]): ExportStudent[] {
 return students.map(s => ({ student_code: s.student_code, first_name: s.first_name, last_name: s.last_name, display_name: s.display_name, status: s.status, campus: locations.find(l => l.id === s.enrollment?.location_id)?.name ?? null, grade: s.enrollment?.grade ?? null, class: s.enrollment?.class ?? null, homeroom: s.enrollment?.homeroom ?? null }));
}
export function csvCell(value: string | null): string {
 const cell = value ?? "";
 // Protect spreadsheet interpretation, including whitespace/control-prefixed formulas.
 const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(cell) || /^[\t\r\n]/u.test(cell) ? "'" + cell : cell;
 return '"' + safe.replaceAll('"', '""') + '"';
}
export function studentExportCsv(rows: ExportStudent[]): string {
 const headers = ["Código estudiantil", "Nombre", "Apellido", "Nombre completo", "Estado", "Campus / sede", "Grado", "Sección", "Aula / grupo"];
 const status = { active: "Activo", suspended: "Suspendido", inactive: "Inactivo" };
 return "\uFEFF" + [headers.map(csvCell).join(","), ...rows.map(r => [r.student_code, r.first_name, r.last_name, r.display_name, status[r.status], r.campus, r.grade, r.class, r.homeroom].map(csvCell).join(","))].join("\r\n") + "\r\n";
}
export function studentExportFilename(scope: "pagina-visible" | "resultados-filtrados", date = new Date()): string {
 return `estudiantes-${scope}-${date.toISOString().slice(0,10)}.csv`;
}
