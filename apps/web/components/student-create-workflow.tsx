"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminDialog } from "./admin-interactions";
import { SchoolCommandForm } from "./school-command-form";
import { Placement, StudentNames } from "./student-fields";
import { commandSchema, type SchoolRead } from "../lib/school/contracts";
import type { PendingCommand } from "../lib/school/command";
const stages = ["Información del estudiante", "Matrícula escolar", "Revisar y crear"];
export function StudentCreateWorkflow({ data, actorId, onClose, onCreated }: { data: SchoolRead; actorId: string; onClose: () => void; onCreated: (code: string) => void }) {
  const [stage, setStage] = useState(0);
  const [blocked, setBlocked] = useState(true);
  const [review, setReview] = useState<Record<string, string | null> | null>(null);
  const [error, setError] = useState("");
  const fields = useRef<HTMLDivElement>(null);
  const requestState = useCallback((pending: PendingCommand | null, locked: boolean) => {
    setBlocked(locked);
    if (pending?.command.operation === "student_create") {
      setReview(pending.command.payload);
      setStage(2);
    }
  }, []);
  useEffect(() => {
    fields.current?.querySelector<HTMLElement>(`[data-stage="${stage}"] h3, [data-review] h3`)?.focus();
  }, [stage]);
  function next() {
    const panel = fields.current?.querySelector(`[data-stage="${stage}"]`);
    if (!panel || ![...panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")].every(input => input.reportValidity())) return;
    if (stage === 1) {
      const form = fields.current?.closest("form");
      if (!form) return;
      const payload = payloadFrom(new FormData(form));
      const parsed = commandSchema.safeParse({ schoolId: data.scope.school_id, operation: "student_create", payload });
      if (!parsed.success) { setError("Revisa los campos antes de continuar."); return; }
      setReview(payload);
    }
    setError(""); setStage(stage + 1);
  }
  return <AdminDialog title="Crear estudiante" onClose={onClose}>
    <ol aria-label="Etapas de creación" className="mb-5 flex flex-wrap gap-3 text-sm">{stages.map((label, index) => <li key={label} aria-current={stage === index ? "step" : undefined} className={stage === index ? "font-bold text-indigo-700" : "text-slate-600"}>{index + 1}. {label}</li>)}</ol>
    <p className="mb-4 text-sm">{data.scope.school_name} · Los campos Nombre, Apellido, Código estudiantil y Fecha efectiva son obligatorios.</p>
    <SchoolCommandForm actorId={actorId} schoolId={data.scope.school_id} formId="student-create" operation="student_create" label="Crear y matricular" submitVisible={stage === 2} makePayload={payloadFrom} onRequestState={requestState} onSuccess={request => { if (request.command.operation === "student_create") onCreated(request.command.payload.student_code); }}>
      <div ref={fields}>
        <section data-stage="0" hidden={stage !== 0}><h3 tabIndex={-1} className="mb-3 text-lg font-bold">Información del estudiante</h3><StudentNames /></section>
        <section data-stage="1" hidden={stage !== 1}><h3 tabIndex={-1} className="mb-3 text-lg font-bold">Matrícula escolar</h3><Placement data={data} /></section>
        {stage === 2 && review && <section data-review><h3 tabIndex={-1} className="mb-3 text-lg font-bold">Revisar y crear</h3><dl className="grid gap-3 sm:grid-cols-2">{[["Nombre", `${review.first_name} ${review.last_name}`], ["Código estudiantil", review.student_code], ["Escuela", data.scope.school_name], ["Sede", data.locations.find(l => l.id === review.location_id)?.name ?? "Sin campus asignado"], ["Fecha efectiva", review.starts_on], ["Grado", review.grade || "Sin grado"], ["Sección", review.class || "Sin sección"], ["Aula / grupo", review.homeroom || "Sin asignar"]].map(([label, value]) => <div key={label}><dt className="text-sm text-slate-600">{label}</dt><dd className="break-words font-semibold">{value}</dd></div>)}</dl><p className="mt-4 text-sm">Se crea el estudiante y su matrícula en una sola operación. No se crea una cuenta de acceso ni se modifica un monedero.</p></section>}
      </div>
      <div className="flex flex-wrap gap-3 border-t pt-4">{stage > 0 && <button type="button" className="btn-secondary" disabled={blocked} onClick={() => setStage(stage - 1)}>Atrás</button>}<button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>{stage < 2 && <button type="button" className="btn" disabled={blocked} onClick={next}>Continuar</button>}</div>
    </SchoolCommandForm>
    {error && <p role="alert" className="mt-3 text-red-800">{error}</p>}
  </AdminDialog>;
}
function payloadFrom(data: FormData) {
  const value = (key: string) => String(data.get(key) ?? "").trim();
  return { first_name: value("first_name"), last_name: value("last_name"), student_code: value("student_code"), location_id: value("location_id") || null, starts_on: value("starts_on"), grade: value("grade") || null, class: value("class") || null, homeroom: value("homeroom") || null };
}
