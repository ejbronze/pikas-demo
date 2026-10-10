import "server-only";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { resolveSchoolAccess } from "../lib/auth/school-access";
import { readSchema, type SchoolSection, type SchoolStudent } from "../lib/school/contracts";
import { ConnectedSchoolShell } from "./connected-school-shell";
import { ConnectedSchoolPages } from "./connected-school-pages";
export type SchoolSearchParams = Promise<Record<string, string | string[] | undefined>>;
export async function SchoolScreen({ section, searchParams }: { section: SchoolSection; searchParams: SchoolSearchParams }) {
  const client = await createSupabaseServerClient();
  const access = await resolveSchoolAccess(client);
  if (access.status === "unauthenticated") redirect("/login?next=%2Fadmin%2Fescuela");
  if (access.status !== "authorized") redirect("/login?error=school_authority");
  const params = await searchParams;
  const schoolId = params.school === undefined ? access.context.schools[0].school_id : params.school;
  if (typeof schoolId !== "string" || !access.context.schools.some(s => s.school_id === schoolId)) redirect("/login?error=school_authority");
  const query = z.string().max(80).safeParse(params.q ?? "");
  const status = z.enum(["", "active", "suspended", "inactive"]).safeParse(params.status ?? "");
  const cursor = z.uuid().nullable().safeParse(params.after ?? null);
  if (!query.success || !status.success || !cursor.success) return <ConnectedSchoolShell context={access.context} schoolId={schoolId}><p role="alert" className="card p-5">Filtros inválidos. Regresa a la sección para repetir la búsqueda.</p></ConnectedSchoolShell>;
  const response = await client.rpc("school_admin_read", { p_school_id: schoolId, p_section: section, p_query: query.data, p_status: status.data, p_after: cursor.data, p_limit: 50 });
  const parsed = readSchema.safeParse(response.data);
  if (response.error || !parsed.success || parsed.data.scope.school_id !== schoolId || parsed.data.scope.actor_id !== access.context.person_id) return <ConnectedSchoolShell context={access.context} schoolId={schoolId}><p role="alert" className="card p-5">No se pudo cargar la información con tus permisos actuales. Recarga para reintentar.</p></ConnectedSchoolShell>;
  let students: SchoolStudent[] = section === "students" ? (parsed.data.rows ?? []).filter((row): row is SchoolStudent => "student_code" in row) : [];
  if (section === "cafeterias") {
    const roster = await client.rpc("school_admin_read", { p_school_id: schoolId, p_section: "students", p_query: query.data, p_limit: 100 });
    const result = readSchema.safeParse(roster.data);
    if (!roster.error && result.success && result.data.scope.school_id === schoolId && result.data.scope.actor_id === access.context.person_id) students = (result.data.rows ?? []).filter((row): row is SchoolStudent => "student_code" in row);
  }
  return <ConnectedSchoolShell context={access.context} schoolId={schoolId}><ConnectedSchoolPages key={`${schoolId}:${section}:${query.data}:${status.data}:${cursor.data}`} section={section} data={parsed.data} students={students} query={query.data} status={status.data} /></ConnectedSchoolShell>;
}
