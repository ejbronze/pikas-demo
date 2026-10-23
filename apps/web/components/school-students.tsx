"use client";
import { PikasMascot } from "@pikas/ui/mascot";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "./state-panels";
import { StudentExportControls } from "./student-export-controls";
import { StudentImportWorkflow } from "./student-import-workflow";
import { CommandTask } from "./command-task";
import { useSchoolCommand } from "./school-command-task";
import { TaskActions, TaskSummary, TaskWindow } from "./task-window";
import { useSessionDraft } from "../lib/session-draft";
import { loadCommand, recoveryKey } from "../lib/school/command";
import type { SchoolRead, SchoolStudent } from "../lib/school/contracts";

export const statusLabel = (status: string) => ({ active: "Activo", suspended: "Suspendido", inactive: "Inactivo" })[status] ?? "No disponible";
const today = () => new Date().toISOString().slice(0, 10);
type Names = { first_name: string; last_name: string; student_code: string };
type Place = { location_id: string; starts_on: string; grade: string; class: string; homeroom: string };
type Task = { kind: "create"; n: number } | { kind: "profile" | "info" | "placement" | "withdraw" | "status"; id: string };
export const studentDraftKey = (actor: string, school: string, student: string | null) => `pikas:student-draft:${actor}:${school}:${student ?? "new"}`;

function Field({ label, value, onChange, type = "text", required = true, maxLength = 80, autoFocus = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; maxLength?: number; autoFocus?: boolean }) {
  return <label className="block font-bold">{label}{required ? " *" : ""}<input className="field mt-1 w-full" type={type} required={required} maxLength={maxLength} value={value} data-autofocus={autoFocus || undefined} onChange={e => onChange(e.target.value)} /></label>;
}
const optional = (value: string) => value.trim() || null;
const namesPayload = (v: Names) => ({ first_name: v.first_name.trim(), last_name: v.last_name.trim(), student_code: v.student_code.trim() });
const placePayload = (v: Place) => ({ location_id: v.location_id || null, starts_on: v.starts_on, grade: optional(v.grade), class: optional(v.class), homeroom: optional(v.homeroom) });
export function placeName(data: SchoolRead, id: string | null | undefined) { return data.locations.find(l => l.id === id)?.name ?? "Sin campus asignado"; }
function placementRows(data: SchoolRead, p: { location_id: string | null; starts_on: string; grade: string | null; class: string | null; homeroom: string | null }): [string, React.ReactNode][] {
  return [["Campus", placeName(data, p.location_id)], ["Fecha efectiva", p.starts_on], ["Grado", p.grade || "Sin grado"], ["Sección", p.class || "Sin sección"], ["Aula / grupo", p.homeroom || "Sin asignar"]];
}
function pendingFor(actor: string, school: string, form: string) { try { return loadCommand(sessionStorage, recoveryKey(actor, school, form)) !== null; } catch { return true; } }

// UX 5 roster (Wave D.3 workflows unchanged): search and status chips first, campus/grade under
// «Más filtros», one row per student whose name opens the student workspace (UX 6). Wave D.3 Estudiantes workspace. Search and filters stay server-side (school_student_roster:
// texto, estado, campus, grado; 50 per page); nothing is filtered locally over a partial page.
export function SchoolStudents({ data, students, query, status, location, grade, paged, walletRead, actorId, counts }: { data: SchoolRead; students: SchoolStudent[]; query: string; status: string; location: string; grade: string; paged: boolean; walletRead: boolean; actorId: string; counts?: NonNullable<SchoolRead["counts"]> }) {
  const router = useRouter();
  const school = data.scope.school_id;
  const base = `/admin/escuela/estudiantes?school=${school}`;
  const [task, setTask] = useState<Task | null>(null), [importing, setImporting] = useState(false), [notice, setNotice] = useState("");
  const [pendingCreate, setPendingCreate] = useState(false);
  useEffect(() => { queueMicrotask(() => setPendingCreate(pendingFor(actorId, school, "student-create"))); }, [actorId, school]);
  const filtered = !!(query || status || location || grade);
  const student = task && task.kind !== "create" ? students.find(s => s.id === task.id) : undefined;
  const filterParams = (extra: Record<string, string> = {}) => `${base}&${new URLSearchParams({ q: query, status, location, grade, ...extra })}`;
  const back = (id: string) => () => setTask({ kind: "profile", id });
  const autoSubmit = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  const multiCampus = data.locations.length > 1, gradeList = data.grades ?? [];
  const create = () => setTask({ kind: "create", n: 0 }), openProfile = (id: string) => () => { setNotice(""); setTask({ kind: "profile", id }); };
  // Status chips keep the other filters; counts are the school's totals from the summary read.
  const chip = (value: string, label: string, count?: number) => <Link key={value} className="stu-chip" aria-current={status === value ? "page" : undefined}
    href={`${base}&${new URLSearchParams({ q: query, status: value, location, grade })}`}>{label}{count !== undefined && <span className="stu-chip-count">{count.toLocaleString("es-DO")}</span>}</Link>;
  const noStudents = counts ? counts.students === 0 : students.length === 0 && !filtered && !paged;
  return <>
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><h1 className="font-display text-3xl font-black text-[var(--primary)]">Estudiantes</h1>
        <p className="break-words text-slate-600">{data.scope.school_name}{counts && counts.students > 0 ? ` · ${counts.active.toLocaleString("es-DO")} ${counts.active === 1 ? "activo" : "activos"} de ${counts.students.toLocaleString("es-DO")}` : ""}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={() => setImporting(true)}>Importar CSV</button><button type="button" className="btn" onClick={create}>Crear estudiante</button></div>
    </header>
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 font-bold text-emerald-900">{notice}</p>}
    {pendingCreate && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="flex-1 basis-60 text-sm"><strong>Hay una creación de estudiante pendiente de confirmar.</strong> Revísala antes de crear otro.</p><button type="button" className="btn-secondary" onClick={create}>Revisar solicitud pendiente</button></div>}
    {noStudents ? <div className="stu-empty"><PikasMascot id="EMP-02" size={120} className="sch-mascot" />
        <div className="min-w-0 flex-1"><p className="font-bold">Aún no hay estudiantes en este colegio.</p><p className="text-sm text-slate-600">Créalos uno por uno o importa varios desde un archivo CSV. Cada estudiante necesita nombre, apellido y código estudiantil.</p>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn" onClick={create}>Crear estudiante</button><button type="button" className="btn-secondary" onClick={() => setImporting(true)}>Importar CSV</button></div></div></div>
    : <>
    <section aria-label="Buscar y filtrar" className="stu-tools">
      <form method="get" action="/admin/escuela/estudiantes" className="stu-search" role="search" aria-label="Filtros de estudiantes">
        <input name="school" type="hidden" value={school} />{status && <input name="status" type="hidden" value={status} />}
        <label className="sr-only" htmlFor="stu-q">Buscar estudiantes</label>
        <input id="stu-q" className="field min-w-0 flex-1" type="search" name="q" placeholder="Buscar por nombre o código" maxLength={80} defaultValue={query} />
        <button className="btn-secondary">Buscar</button>
        {(multiCampus || gradeList.length > 0) && <details className="stu-more" open={!!(location || grade) || undefined}><summary>Más filtros{location || grade ? " · activos" : ""}</summary>
          <div className="stu-more-fields">
            {multiCampus && <label className="font-bold">Campus<select className="field mt-1 w-full" name="location" defaultValue={location} onChange={autoSubmit}><option value="">Todos los campus</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
            {gradeList.length > 0 && <label className="font-bold">Grado<select className="field mt-1 w-full" name="grade" defaultValue={grade} onChange={autoSubmit}><option value="">Todos los grados</option>{gradeList.map(g => <option key={g} value={g}>{g}</option>)}</select></label>}
          </div></details>}
      </form>
      <nav aria-label="Estado de los estudiantes" className="stu-chips">
        {chip("", "Todos", counts?.students)}{chip("active", "Activos", counts?.active)}
        {(!counts || counts.suspended > 0 || status === "suspended") && chip("suspended", "Suspendidos", counts?.suspended)}
        {(!counts || counts.inactive > 0 || status === "inactive") && chip("inactive", "Inactivos", counts?.inactive)}
      </nav>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <p role="status">{students.length} {students.length === 1 ? "estudiante" : "estudiantes"}{filtered ? " con estos filtros" : ""}{data.next_cursor || paged ? " en esta página" : ""}</p>
      {filtered && <Link className="inline-flex min-h-11 items-center font-bold text-teal-800 underline" href={base}>Limpiar filtros</Link>}
    </div>
    {students.length === 0
      ? <EmptyState title="No encontramos estudiantes con estos filtros." description="Prueba con otro nombre o código, o limpia los filtros." action={<Link className="btn-secondary" href={base}>Limpiar filtros</Link>} />
      : <ul aria-label="Estudiantes" className="stu-list">{students.map(s => <li key={s.id} data-status={s.status}>
          <div className="stu-who"><Link className="stu-name" href={`/admin/escuela/estudiantes/${s.id}?school=${school}`}>{s.display_name}</Link><span className="stu-meta">Código {s.student_code}</span></div>
          <p className="stu-place">{s.enrollment ? <>{s.enrollment.grade || "Sin grado"}{s.enrollment.class ? ` · ${s.enrollment.class}` : ""}{multiCampus ? ` · ${placeName(data, s.enrollment.location_id)}` : ""}</> : <span className="stu-missing">Sin matrícula activa</span>}</p>
          <span className="stu-pill" data-status={s.status}>{statusLabel(s.status)}</span>
          <div className="stu-actions">{walletRead && <Link className="btn-tertiary" href={`/admin/escuela/estudiantes/${s.id}/pikas-cash?school=${school}`}>PIKAS Cash<span className="sr-only"> de {s.display_name}</span></Link>}
            <button type="button" className="btn-tertiary" aria-label={`Ver perfil de ${s.display_name}`} onClick={openProfile(s.id)}>Ver perfil</button></div>
        </li>)}</ul>}
    </>}
    <div className="flex flex-wrap gap-3">{paged && <Link className="btn-secondary" href={filterParams()}>Primera página</Link>}{data.next_cursor && <Link className="btn-secondary" href={filterParams({ after: data.next_cursor })}>Siguiente página</Link>}</div>
    {!noStudents && <details className="card p-4"><summary className="flex min-h-11 cursor-pointer items-center font-bold">Exportar estudiantes</summary><div className="mt-3"><StudentExportControls students={students} locations={data.locations} filters={{ schoolId: school, query, status: status as "" | "active" | "suspended" | "inactive", location: location || null, grade: grade || null }} /></div></details>}
    {importing && <StudentImportWorkflow data={data} actorId={actorId} onClose={() => setImporting(false)} />}
    {task?.kind === "create" && <StudentCreateTask key={task.n} data={data} actorId={actorId}
      onClose={(code) => { setTask(null); setPendingCreate(pendingFor(actorId, school, "student-create")); if (code) { setNotice("Estudiante creado."); router.push(`${base}&q=${encodeURIComponent(code)}`); } }}
      reopen={() => { setPendingCreate(false); setTask({ kind: "create", n: task.n + 1 }); }} />}
    {task && task.kind !== "create" && student && <>
      {task.kind === "profile" && <StudentProfileTask data={data} student={student} actorId={actorId} walletRead={walletRead} open={kind => setTask({ kind, id: student.id })} onClose={() => setTask(null)} />}
      {task.kind === "info" && <StudentInfoTask data={data} student={student} actorId={actorId} onClose={back(student.id)} />}
      {task.kind === "placement" && <StudentPlacementTask data={data} student={student} actorId={actorId} onClose={back(student.id)} />}
      {task.kind === "withdraw" && <StudentWithdrawTask data={data} student={student} actorId={actorId} onClose={back(student.id)} />}
      {task.kind === "status" && <StudentStatusTask data={data} student={student} actorId={actorId} onClose={back(student.id)} />}
    </>}
  </>;
}

// Read-only profile; each change opens its own focused task and returns here.
function StudentProfileTask({ data, student, actorId, walletRead, open, onClose }: { data: SchoolRead; student: SchoolStudent; actorId: string; walletRead: boolean; open: (kind: "info" | "placement" | "withdraw" | "status") => void; onClose: () => void }) {
  const school = data.scope.school_id;
  const [pending] = useState(() => ({ info: pendingFor(actorId, school, `student-update:${student.id}`), placement: pendingFor(actorId, school, `placement:${student.id}`), withdraw: pendingFor(actorId, school, `withdraw:${student.id}`), status: pendingFor(actorId, school, `status:${student.id}`) }));
  const action = (kind: keyof typeof pending, label: string) => <button type="button" className="btn-secondary justify-start text-left" onClick={() => open(kind)}>{pending[kind] ? `${label} · solicitud pendiente` : label}</button>;
  const e = student.enrollment;
  return <TaskWindow title={student.display_name} context={`Código ${student.student_code} · ${statusLabel(student.status)}`} onClose={onClose} footer={<TaskActions><button type="button" className="btn" data-autofocus onClick={onClose}>Cerrar</button></TaskActions>}>
    <section className="space-y-2"><h3 className="font-black">Matrícula actual</h3><p className="text-sm text-slate-600">{data.scope.account_name} · {data.scope.school_name}</p>
      {e ? <TaskSummary rows={[["Campus", placeName(data, e.location_id)], ["Grado", e.grade ?? "Sin grado"], ["Sección", e.class ?? "Sin sección"], ["Aula / grupo", e.homeroom ?? "Sin asignar"], ["Inicio de matrícula", e.starts_on]]} /> : <p className="rounded-xl border p-3">Sin matrícula activa.</p>}</section>
    <section className="space-y-2"><h3 className="font-black">Acciones</h3><div className="grid gap-2">
      {action("info", "Editar información")}
      {action("placement", e ? "Cambiar matrícula o campus" : "Matricular")}
      {e && action("withdraw", "Retirar matrícula")}
      {action("status", "Cambiar estado")}
      {walletRead && <Link className="btn-secondary justify-start" href={`/admin/escuela/estudiantes/${student.id}/pikas-cash?school=${school}`}>Ver PIKAS Cash</Link>}
      <Link className="btn-secondary justify-start" href={`/admin/escuela/estudiantes/${student.id}?school=${school}`}>Abrir ficha del estudiante</Link>
    </div></section>
  </TaskWindow>;
}

function StudentCreateTask({ data, actorId, onClose, reopen }: { data: SchoolRead; actorId: string; onClose: (createdCode?: string) => void; reopen: () => void }) {
  const school = data.scope.school_id;
  const command = useSchoolCommand(actorId, school, "student-create", "student_create");
  const key = studentDraftKey(actorId, school, null);
  const initial: Names & Place = { first_name: "", last_name: "", student_code: "", location_id: "", starts_on: today(), grade: "", class: "", homeroom: "" };
  const { values: v, set, restored, drop, discard } = useSessionDraft(key, null, initial, "");
  const [created, setCreated] = useState("");
  if (!command.loaded) return null;
  const payload = () => ({ ...namesPayload(v), ...placePayload(v) });
  const rows = (p: ReturnType<typeof payload>): [string, React.ReactNode][] => [["Nombre", `${p.first_name} ${p.last_name}`], ["Código estudiantil", p.student_code], ["Escuela", data.scope.school_name], ...placementRows(data, p)];
  const stored = command.pending?.command.operation === "student_create" ? command.pending.command.payload : null;
  return <CommandTask title="Crear estudiante" context={data.scope.school_name}
    pages={[
      { label: "Estudiante", content: <>{restored?.recovered && <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p className="flex-1 basis-56">{restored.note}</p><button type="button" className="btn-secondary" onClick={discard}>Descartar borrador</button></div>}
        <Field label="Nombre" value={v.first_name} onChange={x => set("first_name", x)} autoFocus /><Field label="Apellido" value={v.last_name} onChange={x => set("last_name", x)} /><Field label="Código estudiantil" value={v.student_code} maxLength={64} onChange={x => set("student_code", x)} /></> },
      { label: "Matrícula", content: <PlacementFields data={data} values={v} set={set} /> },
    ]}
    validate={index => index === 1 && !payload().starts_on ? "Indica la fecha efectiva." : null}
    review={<><TaskSummary rows={rows(payload())} /><p className="text-sm text-slate-600">Se crea el estudiante y su matrícula en una sola operación. No se crea una cuenta de acceso ni se modifica PIKAS Cash.</p></>}
    recovery={stored && <TaskSummary rows={rows(stored as ReturnType<typeof payload>)} />}
    finalLabel="Crear estudiante" sendingLabel="Creando estudiante…" blocked={command.blocked}
    submit={async () => { const result = await command.submit(payload); if (result.kind === "success") setCreated((stored?.student_code as string | undefined) ?? payload().student_code); return result; }}
    dirty={JSON.stringify(v) !== JSON.stringify(initial)} onKeepDraft={() => onClose()} onDiscard={drop} onSucceeded={drop}
    success={{ title: "Estudiante creado", body: <p>El estudiante quedó creado y matriculado en {data.scope.school_name}.</p>, actions: <button type="button" className="btn-secondary" onClick={reopen}>Crear otro estudiante</button> }}
    onClose={() => onClose(created || undefined)} />;
}

function PlacementFields<V extends Place>({ data, values, set }: { data: SchoolRead; values: V; set: <K extends keyof V>(field: K, value: V[K]) => void }) {
  const s = set as unknown as (field: keyof Place, value: string) => void;
  return <><label className="block font-bold">Campus<select className="field mt-1 w-full" value={values.location_id} onChange={e => s("location_id", e.target.value)}><option value="">Sin campus asignado</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
    <Field label="Fecha efectiva" type="date" value={values.starts_on} onChange={x => s("starts_on", x)} />
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Grado" required={false} value={values.grade} onChange={x => s("grade", x)} /><Field label="Sección" required={false} value={values.class} onChange={x => s("class", x)} /></div>
    <Field label="Aula / grupo" required={false} value={values.homeroom} onChange={x => s("homeroom", x)} /></>;
}

export function StudentInfoTask({ data, student, actorId, onClose }: { data: SchoolRead; student: SchoolStudent; actorId: string; onClose: () => void }) {
  const school = data.scope.school_id;
  const command = useSchoolCommand(actorId, school, `student-update:${student.id}`, "student_update");
  const initial: Names = { first_name: student.first_name, last_name: student.last_name, student_code: student.student_code };
  const { values: v, set, restored, drop, discard } = useSessionDraft(studentDraftKey(actorId, school, student.id), initial, initial, "La información del estudiante cambió desde tu borrador; empezamos con los datos guardados.");
  if (!command.loaded) return null;
  const rows = (p: Names): [string, React.ReactNode][] => [["Nombre", p.first_name], ["Apellido", p.last_name], ["Código estudiantil", p.student_code]];
  const stored = command.pending?.command.operation === "student_update" ? command.pending.command.payload : null;
  return <CommandTask title="Editar información" context={student.display_name}
    pages={[{ label: "Información", content: <>{restored && <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p className="flex-1 basis-56">{restored.note}</p>{restored.recovered && <button type="button" className="btn-secondary" onClick={discard}>Descartar borrador</button>}</div>}
      <Field label="Nombre" value={v.first_name} onChange={x => set("first_name", x)} autoFocus /><Field label="Apellido" value={v.last_name} onChange={x => set("last_name", x)} /><Field label="Código estudiantil" maxLength={64} value={v.student_code} onChange={x => set("student_code", x)} /></> }]}
    validate={() => JSON.stringify(namesPayload(v)) === JSON.stringify(initial) ? "No hay cambios para guardar." : null}
    review={<TaskSummary rows={rows(namesPayload(v))} />} recovery={stored && <TaskSummary rows={rows(stored)} />}
    finalLabel="Guardar cambios" blocked={command.blocked} submit={() => command.submit(() => ({ student_id: student.id, ...namesPayload(v) }))}
    dirty={JSON.stringify(v) !== JSON.stringify(initial)} onKeepDraft={onClose} onDiscard={drop} onSucceeded={drop}
    success={{ title: "Información actualizada" }} onClose={onClose} />;
}

export function StudentPlacementTask({ data, student, actorId, onClose }: { data: SchoolRead; student: SchoolStudent; actorId: string; onClose: () => void }) {
  const school = data.scope.school_id, operation = student.enrollment ? "student_transfer" : "student_enroll";
  const command = useSchoolCommand(actorId, school, `placement:${student.id}`, operation);
  const e = student.enrollment;
  const initial: Place = { location_id: e?.location_id ?? "", starts_on: today(), grade: e?.grade ?? "", class: e?.class ?? "", homeroom: e?.homeroom ?? "" };
  const [v, setV] = useState(initial);
  if (!command.loaded) return null;
  const stored = command.pending && (command.pending.command.operation === "student_enroll" || command.pending.command.operation === "student_transfer") ? command.pending.command.payload : null;
  return <CommandTask title={e ? "Cambiar matrícula o campus" : "Matricular"} context={student.display_name}
    pages={[{ label: "Matrícula", content: <PlacementFields data={data} values={v} set={(field, value) => setV(c => ({ ...c, [field]: value }))} /> }]}
    review={<><TaskSummary rows={placementRows(data, placePayload(v))} />{e && <p className="text-sm text-slate-600">Actualiza la colocación de la matrícula activa a partir de la fecha efectiva.</p>}</>}
    recovery={stored && <TaskSummary rows={placementRows(data, stored)} />}
    finalLabel={e ? "Actualizar matrícula" : "Matricular estudiante"} blocked={command.blocked} submit={() => command.submit(() => ({ student_id: student.id, ...placePayload(v) }))}
    dirty={JSON.stringify(v) !== JSON.stringify(initial)} success={{ title: e ? "Matrícula actualizada" : "Estudiante matriculado" }} onClose={onClose} />;
}

export function StudentWithdrawTask({ data, student, actorId, onClose }: { data: SchoolRead; student: SchoolStudent; actorId: string; onClose: () => void }) {
  const command = useSchoolCommand(actorId, data.scope.school_id, `withdraw:${student.id}`, "student_withdraw");
  const [endsOn, setEndsOn] = useState("");
  if (!command.loaded) return null;
  const stored = command.pending?.command.operation === "student_withdraw" ? command.pending.command.payload : null;
  return <CommandTask title="Retirar matrícula" context={student.display_name}
    pages={[{ label: "Fecha", content: <><Field label="Fecha de retiro" type="date" value={endsOn} onChange={setEndsOn} autoFocus /><p className="text-sm text-slate-600">La fecha debe ser posterior al inicio de la matrícula ({student.enrollment?.starts_on}).</p></> }]}
    review={<><TaskSummary rows={[["Estudiante", student.display_name], ["Matrícula desde", student.enrollment?.starts_on ?? "—"], ["Fecha de retiro", endsOn]]} /><ul className="list-disc space-y-1 pl-5 text-sm text-slate-700"><li>Retirar la matrícula termina la relación de matrícula en esa fecha; no es una eliminación.</li><li>El estudiante, su expediente, su PIKAS Cash y su historial de compras se conservan.</li><li>Sin matrícula activa no puede ser atendido en el POS; si regresa, puede matricularse de nuevo.</li></ul></>}
    recovery={stored && <TaskSummary rows={[["Fecha de retiro", stored.ends_on]]} />}
    finalLabel="Retirar matrícula" destructive blocked={command.blocked} submit={() => command.submit(() => ({ student_id: student.id, ends_on: endsOn }))}
    dirty={!!endsOn} success={{ title: "Matrícula retirada" }} onClose={onClose} />;
}

export function StudentStatusTask({ data, student, actorId, onClose }: { data: SchoolRead; student: SchoolStudent; actorId: string; onClose: () => void }) {
  const command = useSchoolCommand(actorId, data.scope.school_id, `status:${student.id}`, "student_status");
  const [status, setStatus] = useState<string>(student.status);
  if (!command.loaded) return null;
  const stored = command.pending?.command.operation === "student_status" ? command.pending.command.payload : null;
  return <CommandTask title="Cambiar estado" context={student.display_name}
    pages={[{ label: "Estado", content: <><label className="block font-bold">Estado<select className="field mt-1 w-full" data-autofocus value={status} onChange={e => setStatus(e.target.value)}>{["active", "suspended", "inactive"].map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label><ul className="list-disc space-y-1 pl-5 text-sm text-slate-700"><li><strong>Suspendido</strong>: temporal y reversible; el estudiante no puede ser atendido en el POS ni usar su PIKAS Cash mientras dure. Su matrícula y su historial no cambian.</li><li><strong>Inactivo</strong>: el estudiante queda fuera de operación; su expediente, su matrícula anterior y su historial se conservan. Para pasar a inactivo, retira primero su matrícula activa.</li><li>Ningún estado elimina al estudiante ni su historial.</li></ul></> }]}
    validate={() => status === student.status ? "Elige un estado distinto del actual." : null}
    review={<TaskSummary rows={[["Estado actual", statusLabel(student.status)], ["Nuevo estado", statusLabel(status)]]} />}
    recovery={stored && <TaskSummary rows={[["Nuevo estado", statusLabel(stored.status)]]} />}
    finalLabel={`Cambiar a ${statusLabel(status).toLowerCase()}`} destructive={status !== "active"} blocked={command.blocked} submit={() => command.submit(() => ({ student_id: student.id, status }))}
    dirty={status !== student.status} success={{ title: "Estado actualizado" }} onClose={onClose} />;
}
