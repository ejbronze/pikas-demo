import { describe, expect, it } from "vitest";
import { csvCell, studentExportCsv, studentExportFilename, visibleExportRows } from "./student-export";
import type { SchoolStudent } from "./contracts";
const id='4d700000-0000-4000-8000-000000000001';
const student:SchoolStudent={id,first_name:'Ana, María',last_name:'Peña "A"',display_name:'Ana\nPeña',student_code:'=1+1',status:'active',enrollment:{id,starts_on:'2026-10-01',location_id:id,grade:'4',class:'A',homeroom:'Aula 1'}};
describe('student export CSV',()=>{
 it('projects exactly visible students in current order without IDs or extra fields',()=>{const rows=visibleExportRows([student,{...student,student_code:'SECOND'}],[{id,name:'Sede principal'}]);expect(rows).toHaveLength(2);expect(rows.map(r=>r.student_code)).toEqual(['=1+1','SECOND']);const csv=studentExportCsv(rows);expect(csv).not.toContain(id);expect(csv).not.toContain('starts_on');expect(csv).toContain('Sede principal');});
 it('quotes commas, escapes quotes, preserves multiline Spanish and BOM/CRLF',()=>{const csv=studentExportCsv(visibleExportRows([student],[]));expect(csv.charCodeAt(0)).toBe(0xfeff);expect(csv).toContain('"Ana, María"');expect(csv).toContain('"Peña ""A"""');expect(csv).toContain('"Ana\nPeña"');expect(csv).toContain('"Código estudiantil"');expect(csv).toContain('"Activo"');expect(csv.endsWith('\r\n')).toBe(true);expect(new TextDecoder().decode(new TextEncoder().encode(csv))).toContain('María');});
 it.each(['=SUM(1,1)','+1','-1','@SUM(A1)','  =1','\t=1','\r+1','\n@1'])('neutralizes %j',value=>expect(csvCell(value)).toBe('"\''+value.replaceAll('"','""')+'"'));
 it('keeps ordinary UTF8 text and empty cells',()=>{expect(csvCell('José Peña')).toBe('"José Peña"');expect(csvCell(null)).toBe('""');expect(csvCell('A-B')).toBe('"A-B"');});
 it('exports empty result as header only',()=>expect(studentExportCsv([]).split('\r\n')).toHaveLength(2));
 it('uses deterministic date and distinct scope filenames',()=>{const date=new Date('2026-10-14T12:00:00Z');expect(studentExportFilename('pagina-visible',date)).toBe('estudiantes-pagina-visible-2026-10-14.csv');expect(studentExportFilename('resultados-filtrados',date)).toBe('estudiantes-resultados-filtrados-2026-10-14.csv');});
});
