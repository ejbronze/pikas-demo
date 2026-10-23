import Link from "next/link";
import { redirectDemoDenial } from "../lib/platform/demo-recovery";
import "server-only";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { resolveSchoolAccess } from "../lib/auth/school-access";
import { readSchema, type SchoolSection, type SchoolStudent } from "../lib/school/contracts";
import { ConnectedSchoolShell } from "./connected-school-shell";
import { ConnectedSchoolPages } from "./connected-school-pages";
import { readSchoolWalletAccess } from "../lib/wallet/access";
import { ErrorState, LoadFailure } from "./state-panels";
import { classifyError } from "../lib/ux/state-classes";
import { walletReportSchema } from "../lib/school/wallet-report";
import { serviceRows, walletSummary, type OverviewInputs, type SharingRows } from "../lib/school/overview";
// UX 13: never-shared vs revoked comes from the School's own share rows (the sharing read coalesces both to "revoked").
const shareRowsSchema = z.array(z.object({ cafeteria_id: z.uuid(), status: z.enum(["active", "revoked"]) }));
type CafeteriaReadRow = Extract<NonNullable<import("../lib/school/contracts").SchoolRead["rows"]>[number], { sharing_status: unknown }>;
const sectionPath: Record<SchoolSection, string> = { summary: "", students: "/estudiantes", administrators: "/administradores", cafeterias: "/cafeterias", activity: "/actividad" };
export type SchoolSearchParams = Promise<Record<string, string | string[] | undefined>>;
export async function SchoolScreen({ section, searchParams }: { section: SchoolSection; searchParams: SchoolSearchParams }) {
  const client = await createSupabaseServerClient();
  const access = await resolveSchoolAccess(client);
  if (access.status === "unauthenticated") redirect("/login?next=%2Fadmin%2Fescuela");
  if (access.status !== "authorized") return redirectDemoDenial(client, "/login?error=school_authority");
  const params = await searchParams;
  const schoolId = params.school === undefined ? access.context.schools[0].school_id : params.school;
  if (typeof schoolId !== "string" || !access.context.schools.some(s => s.school_id === schoolId)) return redirectDemoDenial(client, "/login?error=school_authority");
  const query = z.string().max(80).safeParse(params.q ?? "");
  const status = z.enum(["", "active", "suspended", "inactive"]).safeParse(params.status ?? "");
  const cursor = z.uuid().nullable().safeParse(params.after ?? null);
  const location = z.uuid().nullable().safeParse(params.location || null);
  const grade = z.string().min(1).max(80).nullable().safeParse(params.grade || null);
  if (!query.success || !status.success || !cursor.success || !location.success || !grade.success) return <ConnectedSchoolShell context={access.context} schoolId={schoolId}><ErrorState kind="validation" title="Los filtros no son válidos." description="La dirección trae filtros que no existen. Restablécelos para volver a la sección." action={<Link className="btn-secondary" href={`/admin/escuela${sectionPath[section]}?school=${schoolId}`}>Restablecer filtros</Link>} /></ConnectedSchoolShell>;
  const response = await client.rpc(section === "students" ? "school_student_roster" : "school_admin_read", { p_school_id: schoolId, ...(section === "students" ? { p_location_id: location.data, p_grade: grade.data } : { p_section: section }), p_query: query.data, p_status: status.data, p_after: cursor.data, p_limit: 50 });
  const parsed = readSchema.safeParse(response.data);
  // UX 14: the read's own answer decides the state. A refusal is a permission state (the access the
  // layout resolved no longer holds), a missing school is not found, an unreadable or out-of-scope
  // response is named as such; only a failed call is a plain temporary failure. All but the refusals retry.
  if (response.error || !parsed.success || parsed.data.scope.school_id !== schoolId || parsed.data.scope.actor_id !== access.context.person_id) {
    const kind = response.error ? classifyError(response.error) : "temporary";
    const href = `/admin/escuela${sectionPath[section]}?school=${schoolId}`;
    return <ConnectedSchoolShell context={access.context} schoolId={schoolId}>{kind === "permission"
      ? <ErrorState kind="permission" title="Ya no tienes acceso a esta sección del colegio." description="Tu rol o tu acceso cambiaron después de entrar. Vuelve a iniciar sesión; si el problema continúa, pídelo al administrador de la cuenta." action={<Link className="btn-secondary" href="/login?next=%2Fadmin%2Fescuela">Volver a iniciar sesión</Link>} />
      : kind === "not_found" ? <ErrorState kind="not_found" title="No encontramos este colegio." description="Puede haber sido desactivado o la dirección ya no es válida." action={<Link className="btn-secondary" href="/admin/escuela">Ir a mi colegio</Link>} />
      : <LoadFailure kind={kind} what="esta sección" invalidResponse={!response.error} retryHref={href} />}</ConnectedSchoolShell>;
  }
  let students: SchoolStudent[] = section === "students" ? (parsed.data.rows ?? []).filter((row): row is SchoolStudent => "student_code" in row) : [];
  if (section === "cafeterias") {
    const roster = await client.rpc("school_admin_read", { p_school_id: schoolId, p_section: "students", p_query: query.data, p_limit: 100 });
    const result = readSchema.safeParse(roster.data);
    if (!roster.error && result.success && result.data.scope.school_id === schoolId && result.data.scope.actor_id === access.context.person_id) students = (result.data.rows ?? []).filter((row): row is SchoolStudent => "student_code" in row);
  }
  const walletRead = (await readSchoolWalletAccess(client, schoolId)).read;
  const own = (r: { data: unknown; error: unknown }) => { const p = readSchema.safeParse(r.data); return !r.error && p.success && p.data.scope.school_id === schoolId && p.data.scope.actor_id === access.context.person_id ? p.data : null; };
  // Estudiantes: the school's own status totals for the roster chips (school:read summary).
  const studentCounts = section === "students" ? await client.rpc("school_admin_read", { p_school_id: schoolId, p_section: "summary", p_query: "", p_status: "", p_after: null, p_limit: 50 }).then(r => own(r)?.counts, () => undefined) : undefined;
  // UX 13: the School's own sharing rows (RLS school:sharing:read). Unavailable → null (neutral wording, never "revocada").
  const shares: SharingRows = section === "summary" || section === "cafeterias"
    ? await client.from("school_cafeteria_shares").select("cafeteria_id,status").eq("school_id", schoolId)
        .then(r => { const p = shareRowsSchema.safeParse(r.data); return !r.error && p.success ? Object.fromEntries(p.data.map(x => [x.cafeteria_id, x.status])) : null; }, () => null)
    : null;
  // School Overview: extra reads with the School's own authority; each one fails on its own.
  let overview: OverviewInputs | undefined;
  if (section === "summary" && parsed.data.counts) {
    const [cafes, admins, report] = await Promise.all([
      client.rpc("school_admin_read", { p_school_id: schoolId, p_section: "cafeterias", p_query: "", p_status: "", p_after: null, p_limit: 50 }).then(own, () => null),
      client.rpc("school_admin_read", { p_school_id: schoolId, p_section: "administrators", p_query: "", p_status: "", p_after: null, p_limit: 50 }).then(own, () => null),
      walletRead ? client.rpc("school_wallet_report", { p_school_id: schoolId, p_period: "last_7_days", p_from: null, p_to: null }).then(r => { const p = walletReportSchema.safeParse(r.data); return !r.error && p.success && p.data.school_id === schoolId ? p.data : null; }, () => null) : Promise.resolve(null),
    ]);
    // Only counts and wallet aggregates leave the server: no student names, no per-cafetería spending.
    overview = { counts: parsed.data.counts, cafeterias: cafes ? serviceRows((cafes.rows ?? []).filter((r): r is CafeteriaReadRow => "sharing_status" in r), shares) : null,
      invitations: admins ? (admins.invitations ?? []).map(v => ({ status: v.status })) : null, wallet: report ? walletSummary(report) : null };
  }
  return <ConnectedSchoolShell context={access.context} schoolId={schoolId} role={parsed.data.scope.role} walletNav={walletRead}><ConnectedSchoolPages overview={overview} sharing={shares} studentCounts={studentCounts} walletRead={section === "students" && walletRead} key={`${schoolId}:${section}:${query.data}:${status.data}:${cursor.data}:${location.data}:${grade.data}`} recoveryActorId={access.context.pov ? `${access.context.pov.operator_person_id}:${access.context.person_id}` : undefined} section={section} paged={cursor.data !== null} data={parsed.data} students={students} query={query.data} status={status.data} location={location.data ?? ""} grade={grade.data ?? ""} /></ConnectedSchoolShell>;
}
