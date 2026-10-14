import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { resolveSchoolAccess } from "../../../../../lib/auth/school-access";
import { exportFiltersSchema, exportResultSchema, studentExportCsv, studentExportFilename } from "../../../../../lib/school/student-export";
export async function POST(request: NextRequest) {
 const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
 if (request.headers.get("origin") !== request.nextUrl.origin) return fail("same_origin_required",403);
 const reader = request.body?.getReader(); if (!reader) return fail("invalid_filters",400);
 let body: unknown, size = 0; const chunks: Uint8Array[] = [];
 try { for (;;) { const { done,value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) { await reader.cancel(); return fail("invalid_filters",400); } chunks.push(value); } body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return fail("invalid_filters",400); }
 const filters = exportFiltersSchema.safeParse(body); if (!filters.success) return fail("invalid_filters",400);
 try {
  const client = await createSupabaseServerClient(), access = await resolveSchoolAccess(client);
  if (access.status === "unauthenticated") return fail("authentication_required",401);
  if (access.status === "unavailable") return fail("authorization_unavailable",503);
  if (access.status !== "authorized" || !access.context.schools.some(s => s.school_id === filters.data.schoolId)) return fail("school_authority_required",403);
  const f = filters.data;
  const response = await client.rpc("school_student_export", { p_school_id: f.schoolId, p_query: f.query, p_status: f.status, p_location_id: f.location, p_grade: f.grade });
  if (response.error) {
   if (response.error.code === "54000" && response.error.message === "student_export_limit") return fail("student_export_limit",413);
   if (response.error.code === "42501") return fail("school_authority_required",403);
   if (response.error.code === "22023") return fail("invalid_filters",400);
   return fail("export_unavailable",502);
  }
  const result = exportResultSchema.safeParse(response.data);
  if (!result.success || result.data.school_id !== f.schoolId || result.data.actor_id !== access.context.person_id) return fail("export_unavailable",502);
  return new NextResponse(studentExportCsv(result.data.rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${studentExportFilename("resultados-filtrados")}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Pikas-Export-Rows": String(result.data.rows.length) } });
 } catch { return fail("export_unavailable",502); }
}
