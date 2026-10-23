import Link from "next/link";
import { schoolReportPage } from "../../../../../lib/school/report-access";
import { generatedAt, reportHref, type SearchParams } from "../../../../../lib/reports/filters";
import { loadStudentsReport, parseStudentFilters, studentStatusLabel } from "../../../../../lib/school/reports";
import { studentExportLimit } from "../../../../../lib/school/student-export";
import { ConnectedSchoolShell } from "../../../../../components/connected-school-shell";
import { ReportFrame, ReportHeader } from "../../../../../components/report-frame";
import { StudentsReportBody, schoolReportPath, studentFilterDimensions } from "../../../../../components/school-reports";
import { ErrorState, LoadFailure } from "../../../../../components/state-panels";

// Reportes / Estudiantes: the school's student population, filtered by URL (status, location, grade).
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client, context, params, schoolId, school, walletRead } = await schoolReportPage(searchParams);
  const shell = (children: React.ReactNode) => <ConnectedSchoolShell context={context} schoolId={schoolId} walletNav={walletRead}><ReportFrame generated={generated}>{children}</ReportFrame></ConnectedSchoolShell>;
  const path = schoolReportPath("estudiantes"), filters = parseStudentFilters(params), generated = generatedAt();
  if (!filters.success) return shell(<ErrorState kind="validation" title="Los filtros no son válidos." description="La dirección trae filtros que no existen. Restablécelos para ver el reporte completo." action={<Link className="btn-secondary" href={`${path}?school=${schoolId}`}>Restablecer filtros</Link>} />);
  const f = filters.data, loaded = await loadStudentsReport(client, schoolId, context.person_id, f);
  const place = loaded.status === "ok" ? loaded.value.locations.find(l => l.id === f.location)?.name : undefined, offered = studentFilterDimensions(loaded.status === "ok" ? loaded.value : null, f);
  const header = <ReportHeader back={{ href: `${schoolReportPath()}?school=${schoolId}`, label: "Reportes" }} title="Estudiantes" scope={school.school_name}
    purpose="Población estudiantil del colegio por estado, campus y grado."
    filters={[{ label: "Estado", value: f.status ? studentStatusLabel[f.status] : "Todos" }, ...(offered.campus ? [{ label: "Campus", value: f.location ? place ?? "Campus seleccionado" : "Todos" }] : []),
      ...(offered.grade ? [{ label: "Grado", value: f.grade ?? "Todos" }] : [])]}
    generated={generated} csvHref={loaded.status === "ok" ? reportHref(`${path}/csv`, { school: schoolId, status: f.status, location: f.location, grade: f.grade }) : undefined} />;
  if (loaded.status === "too_many") return shell(<>{header}<p className="sch-attention text-sm" role="alert">Más de {studentExportLimit.toLocaleString("es-DO")} estudiantes coinciden. Aplica un filtro de estado, campus o grado.</p></>);
  if (loaded.status === "error") return shell(<>{header}<LoadFailure kind={loaded.kind} what="el reporte de estudiantes" retryHref={reportHref(path, { school: schoolId, status: f.status, location: f.location, grade: f.grade })} /></>);
  return shell(<>{header}<StudentsReportBody schoolId={schoolId} filters={f} report={loaded.value} /></>);
}
