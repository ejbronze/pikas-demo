"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { money } from "../lib/cafeteria/operations";
import { restrictionKind, studentAttention, type WorkspaceInputs } from "../lib/school/student-workspace";
import type { SchoolRead } from "../lib/school/contracts";
import { placeName, statusLabel, StudentInfoTask, StudentPlacementTask, StudentStatusTask, StudentWithdrawTask } from "./school-students";

// PIKAS UX 6: one student's school-side workspace. Identity and enrollment first; PIKAS Cash only
// with wallet authority and only state + balance (history stays on its own page); service and
// restrictions read-only; the existing tasks for every change. No purchases or cafetería sales.
type Task = "info" | "placement" | "withdraw" | "status" | null;
export function StudentWorkspace({ data, inputs, walletRead, actorId }: { data: Pick<SchoolRead, "scope" | "locations">; inputs: WorkspaceInputs; walletRead: boolean; actorId: string }) {
  const [task, setTask] = useState<Task>(null);
  const { student } = inputs, e = student.enrollment, school = data.scope.school_id, full = data as SchoolRead;
  const attention = studentAttention(inputs), multiCampus = data.locations.length > 1;
  const close = () => setTask(null);
  const roster = `/admin/escuela/estudiantes?school=${school}`;
  const placement = e ? [e.grade || "Sin grado", e.class, multiCampus || !e.location_id ? placeName(full, e.location_id) : null].filter(Boolean).join(" · ") : "Sin matrícula activa";
  return <div className="stw space-y-5">
    <Link className="stw-back" href={roster}><ArrowLeft aria-hidden className="size-4" />Estudiantes</Link>
    <header className="stw-head">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-3xl font-black text-[var(--primary)] break-words">{student.display_name}</h1>
        <p className="stw-meta"><span className="stu-pill" data-status={student.status}>{statusLabel(student.status)}</span><span>Código {student.student_code}</span><span>{placement}</span></p>
      </div>
      <button type="button" className="btn" onClick={() => setTask("info")}>Editar información</button>
    </header>

    {attention.length > 0 && <section aria-labelledby="stw-attention" className="stw-attention"><h2 id="stw-attention" className="stw-h2">Requiere atención</h2>
      <ul>{attention.map(a => <li key={a.key}>{a.text}</li>)}</ul></section>}

    <div className="stw-grid">
      <section aria-labelledby="stw-enrollment" className="stw-card">
        <div className="stw-card-head"><h2 id="stw-enrollment" className="stw-h2">Matrícula</h2>
          <button type="button" className="btn-tertiary" onClick={() => setTask("placement")}>{e ? "Cambiar matrícula" : "Matricular"}</button></div>
        {e ? <dl className="stw-rows">
          <div><dt>Campus</dt><dd>{placeName(full, e.location_id)}</dd></div>
          <div><dt>Grado</dt><dd>{e.grade || <span className="stw-none">Sin grado</span>}</dd></div>
          <div><dt>Sección</dt><dd>{e.class || <span className="stw-none">Sin sección</span>}</dd></div>
          <div><dt>Aula / grupo</dt><dd>{e.homeroom || <span className="stw-none">Sin asignar</span>}</dd></div>
          <div><dt>Inicio de matrícula</dt><dd className="num">{e.starts_on.split("-").reverse().join("/")}</dd></div>
        </dl> : <p className="stw-empty">Sin matrícula activa. Matricúlalo para asignarle campus y grado.</p>}
      </section>

      {walletRead && <section aria-labelledby="stw-wallet" className="stw-card">
        <div className="stw-card-head"><h2 id="stw-wallet" className="stw-h2">PIKAS Cash</h2>
          <Link className="btn-tertiary" href={`/admin/escuela/estudiantes/${student.id}/pikas-cash?school=${school}&from=estudiante`}>Ver PIKAS Cash</Link></div>
        {inputs.wallet === undefined ? <p className="stw-empty" role="alert">No pudimos cargar PIKAS Cash. Ábrelo desde «Ver PIKAS Cash».</p>
          : inputs.wallet === null ? <p className="stw-empty">Este estudiante aún no tiene monedero de PIKAS Cash.</p>
          : <dl className="stw-rows">
            <div><dt>Estado</dt><dd><span className="stw-wallet" data-status={inputs.wallet.status}>{inputs.wallet.status === "active" ? "Activo" : "Congelado"}</span></dd></div>
            <div><dt>Saldo</dt><dd className="num-display stw-balance">{money(inputs.wallet.balance_minor)}</dd></div>
          </dl>}
        <p className="stw-note">Recargas y movimientos se consultan en «Ver PIKAS Cash».</p>
      </section>}

      {inputs.service && <section aria-labelledby="stw-service" className="stw-card">
        <div className="stw-card-head"><h2 id="stw-service" className="stw-h2">Cafeterías</h2><Link className="btn-tertiary" href={`/admin/escuela/cafeterias?school=${school}`}>Revisar cafeterías</Link></div>
        {inputs.service.length === 0 ? <p className="stw-empty">No está habilitado en ninguna cafetería del colegio.</p>
          : <ul className="stw-list">{inputs.service.map(s => <li key={`${s.name}:${s.location}`}><span className="min-w-0"><span className="font-semibold break-words">{s.name}</span><span className="stw-sub">{s.location}</span></span>
            <span className="sch-pill" data-state={s.serving ? "on" : "off"}>{s.serving ? "Habilitado" : "Sin compartición activa"}</span></li>)}</ul>}
      </section>}

      {inputs.restrictions && <section aria-labelledby="stw-restrictions" className="stw-card">
        <h2 id="stw-restrictions" className="stw-h2">Restricciones alimentarias</h2>
        {inputs.restrictions.length === 0 ? <p className="stw-empty">Sin restricciones registradas.</p>
          : <ul className="stw-list">{inputs.restrictions.map(r => <li key={`${r.kind}:${r.label}`}><span className="font-semibold break-words">{r.label}</span>
            <span className="stw-sub">{restrictionKind[r.kind]}{r.until ? ` · hasta ${r.until.split("-").reverse().join("/")}` : ""}</span></li>)}</ul>}
      </section>}
    </div>

    {/* State changes stay apart from routine edits; each opens its existing confirmation task. */}
    <section aria-labelledby="stw-admin" className="stw-zone">
      <div className="min-w-0 flex-1 basis-60"><h2 id="stw-admin" className="stw-h2">Estado y matrícula</h2><p className="text-sm text-slate-600">Cambios administrativos del estudiante. Cada uno se revisa y confirma antes de guardarse.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={() => setTask("status")}>Cambiar estado</button>
        {e && <button type="button" className="btn-secondary border-amber-300 text-amber-900 hover:bg-amber-50" onClick={() => setTask("withdraw")}>Retirar matrícula</button>}</div>
    </section>

    {task === "info" && <StudentInfoTask data={full} student={student} actorId={actorId} onClose={close} />}
    {task === "placement" && <StudentPlacementTask data={full} student={student} actorId={actorId} onClose={close} />}
    {task === "withdraw" && <StudentWithdrawTask data={full} student={student} actorId={actorId} onClose={close} />}
    {task === "status" && <StudentStatusTask data={full} student={student} actorId={actorId} onClose={close} />}
  </div>;
}
