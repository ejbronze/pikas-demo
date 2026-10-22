import Link from "next/link";
import { ChevronRight, Utensils, Users, WalletCards } from "lucide-react";
import { BarList, ReportSummary, ReportTable } from "./report-frame";
import { reportHref } from "../lib/reports/filters";
import { enabledText, studentStatusLabel, type ServiceReportRow, type StudentFilters, type StudentsReport } from "../lib/school/reports";

// PIKAS UX 8 School Reportes. Presentation of data each page already read and reduced on the server.
export const schoolReportPath = (report = "") => `/admin/escuela/reportes${report && `/${report}`}`;
const n = (k: number, one: string, many: string) => `${k.toLocaleString("es-DO")} ${k === 1 ? one : many}`;

// Landing: what do you want to understand or document? Only reports this role can open are listed.
export function SchoolReportsIndex({ schoolId, schoolName, walletRead }: { schoolId: string; schoolName: string; walletRead: boolean }) {
  const reports = [
    { report: "estudiantes", icon: Users, name: "Estudiantes", purpose: "Población estudiantil por estado, campus y grado." },
    ...(walletRead ? [{ report: "pikas-cash", icon: WalletCards, name: "PIKAS Cash", purpose: "Recargas, compras, reembolsos y correcciones de los monederos en un período." }] : []),
    { report: "cafeterias", icon: Utensils, name: "Cafeterías conectadas", purpose: "Cafeterías que atienden al colegio, información compartida y estudiantes habilitados." },
  ];
  return <div className="space-y-5">
    <header className="min-w-0"><h1 className="font-display text-3xl font-black text-[var(--primary)]">Reportes</h1>
      <p className="break-words text-slate-600">{schoolName} · ¿qué quieres entender o documentar?</p></header>
    <ul className="rpt-index" aria-label="Reportes del colegio">{reports.map(r => <li key={r.report}>
      <Link href={`${schoolReportPath(r.report)}?school=${schoolId}`}><r.icon aria-hidden size={22} className="rpt-index-icon" />
        <span className="min-w-0 flex-1"><span className="rpt-index-name">{r.name}</span><span className="rpt-index-purpose">{r.purpose}</span></span>
        <ChevronRight aria-hidden size={20} className="shrink-0 text-slate-400" /></Link></li>)}</ul>
    <p className="text-sm text-slate-600">Cada reporte muestra solo información de este colegio, se puede imprimir y exportar en CSV con los filtros aplicados.</p>
  </div>;
}

// Estudiantes: the full filtered population. Summary, grade chart and table all come from the same rows.
export function StudentsReportBody({ schoolId, filters, report: r }: { schoolId: string; filters: StudentFilters; report: StudentsReport }) {
  const path = schoolReportPath("estudiantes"), keep = { school: schoolId, status: filters.status, location: filters.location, grade: filters.grade };
  const filtered = !!(filters.status || filters.location || filters.grade);
  return <div className="space-y-5">
    <form method="get" action={path} className="rpt-filter-form" data-print="hide" aria-label="Filtrar estudiantes">
      <input type="hidden" name="school" value={schoolId} />
      <label>Estado<select className="field" name="status" defaultValue={filters.status}><option value="">Todos</option>
        {(["active", "suspended", "inactive"] as const).map(s => <option key={s} value={s}>{studentStatusLabel[s]}</option>)}</select></label>
      {r.locations.length > 1 || filters.location ? <label>Campus<select className="field" name="location" defaultValue={filters.location ?? ""}><option value="">Todos</option>
        {r.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label> : null}
      {r.grades.length > 0 || filters.grade ? <label>Grado<select className="field" name="grade" defaultValue={filters.grade ?? ""}><option value="">Todos</option>
        {[...new Set([...r.grades, ...(filters.grade ? [filters.grade] : [])])].map(g => <option key={g} value={g}>{g}</option>)}</select></label> : null}
      <button className="btn-secondary">Aplicar</button>
      {filtered && <Link className="inline-flex min-h-11 items-center font-bold text-teal-800 underline" href={`${path}?school=${schoolId}`}>Limpiar filtros</Link>}
    </form>
    {r.counts.total === 0 ? <p className="sch-panel text-sm text-slate-600">{filtered ? "Ningún estudiante coincide con estos filtros." : "Aún no hay estudiantes en este colegio."}</p> : <>
      <ReportSummary label="Resumen de estudiantes" items={[
        { label: "Estudiantes", value: r.counts.total.toLocaleString("es-DO"), help: filtered ? "con los filtros aplicados" : "todos los registros del colegio" },
        { label: "Activos", value: r.counts.active.toLocaleString("es-DO") },
        { label: "Suspendidos", value: r.counts.suspended.toLocaleString("es-DO") },
        { label: "Inactivos", value: r.counts.inactive.toLocaleString("es-DO") },
      ]} />
      {r.byGrade.length > 1 && <section aria-labelledby="rpt-grades" className="sch-panel space-y-3">
        <h2 id="rpt-grades" className="sch-h2">Estudiantes por grado</h2>
        <p className="rpt-help">Grado de la matrícula activa. Elige un grado para ver solo esos estudiantes.</p>
        <BarList label="Estudiantes por grado" unit={["estudiante", "estudiantes"]} items={r.byGrade.map(g => ({ key: g.grade ?? "", label: g.grade ?? "Sin grado asignado", count: g.count,
          href: g.grade ? reportHref(path, { ...keep, grade: g.grade }) : undefined }))} />
      </section>}
      <section aria-labelledby="rpt-students" className="space-y-3">
        <h2 id="rpt-students" className="sch-h2">{n(r.counts.total, "estudiante", "estudiantes")}</h2>
        <ReportTable label="Estudiantes del reporte" rows={r.rows} rowKey={s => s.student_code} columns={[
          { header: "Estudiante", primary: true, cell: s => <Link className="rpt-record" href={reportHref("/admin/escuela/estudiantes", { school: schoolId, q: s.student_code })}>{s.display_name}</Link> },
          { header: "Código", cell: s => s.student_code },
          { header: "Estado", cell: s => studentStatusLabel[s.status] },
          { header: "Campus", cell: s => s.campus ?? "—" },
          { header: "Grado", cell: s => s.grade ?? "—" },
          { header: "Sección", cell: s => s.class ?? "—" },
          { header: "Aula", cell: s => s.homeroom ?? "—" },
        ]} />
      </section></>}
  </div>;
}

// Cafeterías conectadas: the school's service relationships. Not a cafetería business report.
export function ServiceReportBody({ rows }: { rows: ServiceReportRow[] }) {
  if (rows.length === 0) return <p className="sch-panel text-sm text-slate-600">Ninguna cafetería atiende todavía a este colegio.</p>;
  return <div className="space-y-5">
    <ReportSummary label="Resumen de cafeterías" items={[
      { label: "Cafeterías", value: rows.length.toLocaleString("es-DO"), help: n(rows.filter(r => r.active).length, "activa", "activas") },
      { label: "Comparten con el colegio", value: rows.filter(r => r.sharing).length.toLocaleString("es-DO"), help: "compartición activa" },
    ]} />
    <ReportTable label="Cafeterías conectadas" rows={rows} rowKey={r => `${r.name}·${r.location}`} columns={[
      { header: "Cafetería", primary: true, cell: r => r.name },
      { header: "Sede", cell: r => r.location },
      { header: "Estado", cell: r => r.active ? "Activa" : "Inactiva" },
      { header: "Compartición", cell: r => r.sharing ? "Activa" : "Sin compartición" },
      { header: "Información compartida", cell: r => r.shared.length ? r.shared.join(", ") : "—" },
      { header: "Estudiantes habilitados", align: "end", cell: r => enabledText(r) },
    ]} />
    <p className="rpt-help">Estudiantes habilitados: estudiantes de este colegio con servicio activo en esa cafetería. No incluye ventas ni consumo.</p>
  </div>;
}
