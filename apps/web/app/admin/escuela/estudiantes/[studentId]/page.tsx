import { redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { resolveSchoolAccess } from "../../../../../lib/auth/school-access";
import { readSchoolWalletAccess } from "../../../../../lib/wallet/access";
import { readSchema, type SchoolStudent } from "../../../../../lib/school/contracts";
import { customerRowsSchema, restrictionRowsSchema, studentService, uuidPredecessor, walletReadSchema, walletState, type WorkspaceInputs } from "../../../../../lib/school/student-workspace";
import { ConnectedSchoolShell } from "../../../../../components/connected-school-shell";
import { StudentWorkspace } from "../../../../../components/student-workspace";
import { ErrorState } from "../../../../../components/state-panels";

// PIKAS UX 6: one student's workspace. Every read is an existing School read under its own guard;
// results are verified against this school and actor and reduced before reaching the page.
export default async function Page({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<{ school?: string }> }) {
  const client = await createSupabaseServerClient();
  const access = await resolveSchoolAccess(client);
  if (access.status === "unauthenticated") redirect("/login?next=%2Fadmin%2Fescuela%2Festudiantes");
  if (access.status !== "authorized") redirect("/login?error=school_authority");
  const { studentId } = await params, { school } = await searchParams;
  const after = z.guid().safeParse(studentId).success ? uuidPredecessor(studentId) : null;
  if (!after || !school || !access.context.schools.some(s => s.school_id === school)) redirect("/admin/escuela/estudiantes");
  const roster = `/admin/escuela/estudiantes?school=${school}`;
  const own = (r: { data: unknown; error: unknown }) => { const p = readSchema.safeParse(r.data); return !r.error && p.success && p.data.scope.school_id === school && p.data.scope.actor_id === access.context.person_id ? p.data : null; };

  const read = own(await client.rpc("school_student_roster", { p_school_id: school, p_query: "", p_status: "", p_after: after, p_limit: 1, p_location_id: null, p_grade: null }));
  const student = (read?.rows ?? []).find((r): r is SchoolStudent => "student_code" in r && r.id === studentId);
  const walletRead = !access.context.pov && (await readSchoolWalletAccess(client, school)).read;
  if (!read || !student) return <ConnectedSchoolShell context={access.context} schoolId={school} walletNav={walletRead}>
    <ErrorState title="No encontramos este estudiante en este colegio." retry={<Link className="btn-secondary" href={roster}>Volver a Estudiantes</Link>} /></ConnectedSchoolShell>;

  const [wallet, customers, cafes, restrictions] = await Promise.all([
    walletRead ? client.rpc("school_wallet_read", { p_school_id: school, p_student_id: studentId }).then(r => { const p = walletReadSchema.safeParse(r.data);
      return !r.error && p.success && p.data.school_id === school && p.data.student_id === studentId ? walletState(p.data) : undefined; }, () => undefined) : Promise.resolve(undefined),
    client.from("cafeteria_customers").select("cafeteria_id,status").eq("school_id", school).eq("student_id", studentId).eq("status", "active")
      .then(r => { const p = customerRowsSchema.safeParse(r.data); return !r.error && p.success ? p.data.map(c => c.cafeteria_id) : null; }, () => null),
    client.rpc("school_admin_read", { p_school_id: school, p_section: "cafeterias", p_query: "", p_status: "", p_after: null, p_limit: 50 }).then(own, () => null),
    // Restrictions are readable by the School Admin role (school:restrictions:read); others see no section.
    read.scope.role === "school_admin" ? client.from("student_dietary_restrictions").select("restriction_type,display_label,starts_on,ends_on").eq("school_id", school).eq("student_id", studentId).eq("status", "active").order("display_label")
      .then(r => { const p = restrictionRowsSchema.safeParse(r.data); return !r.error && p.success ? p.data.map(x => ({ kind: x.restriction_type, label: x.display_label, until: x.ends_on })) : null; }, () => null) : Promise.resolve(null),
  ]);
  const cafeteriaRows = cafes ? (cafes.rows ?? []).filter((r): r is Extract<NonNullable<typeof cafes.rows>[number], { sharing_status: unknown }> => "sharing_status" in r) : null;
  const inputs: WorkspaceInputs = { student, wallet: walletRead ? wallet : undefined,
    service: customers && cafeteriaRows ? studentService(customers, cafeteriaRows) : null, restrictions };
  const actorId = access.context.pov ? `${access.context.pov.operator_person_id}:${access.context.person_id}` : read.scope.actor_id;
  // The page's data: scope and campuses for the existing tasks; the reduced student inputs; nothing else.
  return <ConnectedSchoolShell context={access.context} schoolId={school} role={read.scope.role} walletNav={walletRead}>
    <StudentWorkspace data={{ scope: read.scope, locations: read.locations }} inputs={inputs} walletRead={walletRead} actorId={actorId} />
  </ConnectedSchoolShell>;
}
