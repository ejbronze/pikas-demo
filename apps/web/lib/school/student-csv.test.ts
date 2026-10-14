import { describe, expect, it } from "vitest";
import { csvTemplate, parseStudentCsv } from "./student-csv";
describe("student CSV", () => {
 it("handles BOM, comma, escaped quote and multiline physical row numbers", () => {
 const rows=parseStudentCsv('\uFEFF'+csvTemplate+'"Ana, María","Peña ""A""",X,2026-10-01,,,,\r\n"Multi\nline",Test,Y,2026-10-01,,,,\r\nLast,Test,Z,2026-10-01,,,,');
 expect(rows[0]).toMatchObject({source_row:2,first_name:"Ana, María",last_name:'Peña "A"'});expect(rows[1].first_name).toBe("Multi\nline");expect(rows[2].source_row).toBe(5);
 });
 it("allows reordered headers and absent optional columns without inventing fields",()=>{expect(parseStudentCsv('starts_on,student_code,last_name,first_name\n2026-10-01,X,Test,Ana')[0]).toMatchObject({first_name:'Ana',grade:null,location_id:null});});
 it.each(['first_name,last_name,student_code,starts_on\n"Bad,Test,X,2026-10-01','first_name,last_name,student_code,starts_on\n"Bad"text,Test,X,2026-10-01','first_name,last_name,student_code,starts_on\nBad"quote,Test,X,2026-10-01','first_name,last_name,student_code,starts_on\nAna,Test,X','first_name,first_name,student_code,starts_on\nA,B,X,2026-10-01','first_name,last_name,student_code,starts_on,age\nA,B,X,2026-10-01,10'])("rejects malformed CSV %s",text=>expect(()=>parseStudentCsv(text)).toThrow());
 it("does not silently drop blank student records",()=>expect(()=>parseStudentCsv(csvTemplate+'\n')).toThrow());
 it("accepts 200 and rejects 201",()=>{const make=(n:number)=>csvTemplate+Array.from({length:n},(_,i)=>`A,B,C${i},2026-10-01,,,,`).join('\n');expect(parseStudentCsv(make(200))).toHaveLength(200);expect(()=>parseStudentCsv(make(201))).toThrow(/200/);});
 it("enforces UTF8 byte limit",()=>expect(()=>parseStudentCsv(csvTemplate+'é'.repeat(524288))).toThrow(/MiB/));
});
