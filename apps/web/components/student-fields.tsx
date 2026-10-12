"use client";
import type { SchoolRead, SchoolStudent } from "../lib/school/contracts";
export function Input({ label, name, defaultValue = "", type = "text", required = true, maxLength = 80 }: { label: string; name: string; defaultValue?: string; type?: string; required?: boolean; maxLength?: number }) {
  return <label className="block text-sm font-semibold">{label}<input className="field mt-1 w-full" name={name} type={type} required={required} maxLength={maxLength} defaultValue={defaultValue} /></label>;
}
export function Placement({ data, student }: { data: SchoolRead; student?: SchoolStudent }) {
  return <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Campus<select name="location_id" className="field mt-1 w-full" defaultValue={student?.enrollment?.location_id ?? ""}><option value="">Sin campus asignado</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><Input label="Fecha efectiva" name="starts_on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /><Input label="Grado" name="grade" defaultValue={student?.enrollment?.grade ?? ""} required={false} /><Input label="Sección" name="class" defaultValue={student?.enrollment?.class ?? ""} required={false} /><Input label="Aula / grupo" name="homeroom" defaultValue={student?.enrollment?.homeroom ?? ""} required={false} /></div>;
}
export function StudentNames({ student }: { student?: SchoolStudent }) { return <div className="grid gap-3 sm:grid-cols-3"><Input label="Nombre" name="first_name" defaultValue={student?.first_name} /><Input label="Apellido" name="last_name" defaultValue={student?.last_name} /><Input label="Código estudiantil" name="student_code" maxLength={64} defaultValue={student?.student_code} /></div>; }
