import Link from "next/link";
import { schoolReportPage } from "../../../../../lib/school/report-access";
import { generatedAt, reportHref, type SearchParams } from "../../../../../lib/reports/filters";
import { loadStudentsReport, parseStudentFilters, studentStatusLabel } from "../../../../../lib/school/reports";
import { studentExportLimit } from "../../../../../lib/school/student-export";
import { ConnectedSchoolShell } from "../../../../../components/connected-school-shell";
import { ReportHeader } from "../../../../../components/report-frame";
import { StudentsReportBody, schoolReportPath } from "../../../../../components/school-reports";
import { ErrorState } from "../../../../../components/state-panels";

// Reportes / Estudiantes: the school's student population, filtered by URL (status, location, grade).
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { client, context, params, schoolId, school, walletRead } = await schoolReportPage(searchParams);
  const shell = (children: React.ReactNode) => <ConnectedSchoolShell context={context} schoolId={schoolId} walletNav={walletRead}><div className="rpt">{children}</div></ConnectedSchoolShell>;
  const path = schoolReportPath("estudiantes"), filters = parseStudentFilters(params);
  if (!filters.success) return shell(<ErrorState title="Los filtros no son válidos." description="Vuelve al reporte sin filtros." retry={<Link className="btn-secondary" href={`${path}?school=${schoolId}`}>Limpiar filtros</Link>} />);
  const f = filters.data, loaded = await loadStudentsReport(client, schoolId, context.person_id, f);
  const place = loaded.status === "ok" ? loaded.value.locations.find(l => l.id === f.location)?.name : undefined;
  const header = <ReportHeader back={{ href: `${schoolReportPath()}?school=${schoolId}`, label: "Reportes" }} title="Estudiantes" scope={school.school_name}
    purpose="Población estudiantil del colegio por estado, campus y grado."
    filters={[{ label: "Estado", value: f.status ? studentStatusLabel[f.status] : "Todos" }, { label: "Campus", value: f.location ? place ?? "Campus seleccionado" : "Todos" }, { label: "Grado", value: f.grade ?? "Todos" }]}
    generated={generatedAt()} csvHref={loaded.status === "ok" ? reportHref(`${path}/csv`, { school: schoolId, status: f.status, location: f.location, grade: f.grade }) : undefined} />;
  if (loaded.status === "too_many") return shell(<>{header}<p className="sch-attention text-sm" role="alert">Más de {studentExportLimit.toLocaleString("es-DO")} estudiantes coinciden. Aplica un filtro de estado, campus o grado.</p></>);
  if (loaded.status === "error") return shell(<>{header}<ErrorState title="No pudimos cargar el reporte de estudiantes." description="Puede ser un problema temporal o un cambio en tus permisos." /></>);
  return shell(<>{header}<StudentsReportBody schoolId={schoolId} filters={f} report={loaded.value} /></>);
}
