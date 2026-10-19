"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminDialog } from "./admin-interactions";
import { csvColumns, csvTemplate, parseStudentCsv, type ImportRow } from "../lib/school/student-csv";
import { bulkRecoveryKey, loadBulk, prepareBulk, sendBulk, validateSelection, type BulkValidation, type PendingBulk } from "../lib/school/bulk-client";
import type { SchoolRead } from "../lib/school/contracts";
const labels = { first_name: "Nombre", last_name: "Apellido", student_code: "Código estudiantil", starts_on: "Fecha efectiva", location_id: "Campus / sede", grade: "Grado", class: "Sección", homeroom: "Aula / grupo" };
const errors: Record<string, string> = { unknown_field: "Columna no reconocida", first_name_invalid: "Nombre obligatorio, máximo 80 caracteres", last_name_invalid: "Apellido obligatorio, máximo 80 caracteres", student_code_invalid: "Código obligatorio, máximo 64 caracteres", starts_on_invalid: "Fecha inválida o futura; usa AAAA-MM-DD", location_invalid: "Campus inválido o fuera de esta escuela", duplicate_code: "Código duplicado en el archivo", existing_code: "Código ya existente en esta escuela", grade_invalid: "Grado inválido, máximo 80 caracteres", class_invalid: "Sección inválida, máximo 80 caracteres", homeroom_invalid: "Aula / grupo inválido, máximo 80 caracteres" };
export function StudentImportWorkflow({ data, actorId, onClose }: { data: SchoolRead; actorId: string; onClose: () => void }) {
 const school = data.scope.school_id, key = bulkRecoveryKey(actorId, school), router = useRouter();
 const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [rows, setRows] = useState<ImportRow[]>([]), [validation, setValidation] = useState<BulkValidation | null>(null), [included, setIncluded] = useState<number[]>([]), [pending, setPending] = useState<PendingBulk | null>(null), [message, setMessage] = useState("");
 const inFlight = useRef(false);
 const [asking, setAsking] = useState(false);
 useEffect(() => { let alive = true; queueMicrotask(() => { if (!alive) return; try { const stored = loadBulk(sessionStorage, key, school); setPending(stored); if (stored) setMessage("Solicitud pendiente: recupera el acceso y confirma la misma solicitud antes de editar."); setReady(true); } catch { setMessage("No se pudo recuperar la solicitud. Importación bloqueada."); } }); return () => { alive = false; }; }, [key, school]);
 const locked = !ready || busy || pending !== null;
 const canCommit = validation !== null && included.length > 0 && included.every(id => validation.rows.some(r => r.source_row === id && r.errors.length === 0));
 const check = async (next: ImportRow[], selection = included) => { const result = await validateSelection(school, next, selection); setValidation(result); setRows(result.rows.map(r => r.row as ImportRow)); return result; };
 const mutate = (id: number, field: typeof csvColumns[number], value: string) => { setRows(old => old.map(r => r.source_row === id ? { ...r, [field]: value || (csvColumns.indexOf(field) < 4 ? "" : null) } : r)); setValidation(null); };
 return <AdminDialog title="Importar estudiantes desde CSV" onClose={() => { if (!busy) onClose(); }}><div className="space-y-4">
 <p className="text-sm">Crear y matricular únicamente. Máximo 200 estudiantes y 1 MiB. No se reemplazan estudiantes existentes.</p>
 <p className="text-sm">Columnas obligatorias: nombre, apellido, código y fecha efectiva (AAAA-MM-DD, no futura). Campus opcional: usa el identificador de una sede de esta escuela. Grado, sección y aula / grupo son opcionales.</p>
 <a className="btn-secondary inline-flex" download="plantilla-estudiantes.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvTemplate)}`}>Descargar plantilla CSV</a>
 <details><summary className="cursor-pointer font-semibold">Identificadores de campus para el CSV</summary>{data.locations.map(l => <p className="break-all text-sm" key={l.id}>{l.name}: {l.id}</p>)}</details>
 <fieldset disabled={locked} className="min-w-0 space-y-4"><label className="block text-sm font-semibold">Seleccionar o reemplazar archivo CSV<input className="field mt-2 w-full" type="file" accept=".csv,text/csv" onChange={async e => {
 const file = e.target.files?.[0]; e.target.value = ""; if (!file || inFlight.current) return;
 inFlight.current = true; setBusy(true); setMessage(""); setValidation(null); setRows([]); setIncluded([]);
 try { if (file.size > 1048576) throw new Error("El archivo supera 1 MiB."); const parsed = parseStudentCsv(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())); setRows(parsed); setIncluded(parsed.map(r => r.source_row)); await check(parsed, parsed.map(r => r.source_row)); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo leer el CSV."); } finally { inFlight.current = false; setBusy(false); }
 }} /></label>
 {rows.length > 0 && <><p className="text-sm">{rows.length} filas · {included.length} incluidas. Las filas inválidas requieren corrección o exclusión explícita.</p><div className="max-h-[45dvh] space-y-3 overflow-y-auto overscroll-contain rounded-xl border p-2" aria-label="Vista previa de todas las filas">{rows.map(row => { const issues = validation?.rows.find(r => r.source_row === row.source_row)?.errors; return <article key={row.source_row} className="space-y-3 rounded-lg border bg-white p-3"><label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={included.includes(row.source_row)} onChange={e => { setIncluded(old => e.target.checked ? [...old, row.source_row] : old.filter(id => id !== row.source_row)); setValidation(null); }} />Incluir fila {row.source_row}</label><p className="text-sm">{issues ? issues.length ? issues.map(code => errors[code] ?? "Dato inválido").join(" · ") : "Válida" : "Pendiente de revalidación"}</p><div className="grid min-w-0 gap-3 sm:grid-cols-2">{csvColumns.map(field => <label key={field} className="min-w-0 text-sm">{labels[field]} · fila {row.source_row}{field === "location_id" ? <select className="field mt-1 w-full" value={row[field] ?? ""} onChange={e => mutate(row.source_row, field, e.target.value)}><option value="">Sin campus</option>{row[field] && !data.locations.some(l => l.id === row[field]) && <option value={row[field]!}>Campus inválido: {row[field]}</option>}{data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select> : <input className="field mt-1 w-full" type={field === "starts_on" ? "date" : "text"} value={row[field] ?? ""} onChange={e => mutate(row.source_row, field, e.target.value)} />}</label>)}</div></article>; })}</div><button className="btn-secondary" type="button" onClick={async () => { if (inFlight.current) return; inFlight.current = true; setBusy(true); setMessage(""); try { await check(rows); } catch (error) { setValidation(null); setMessage(error instanceof Error ? error.message : "Validación no disponible."); } finally { inFlight.current = false; setBusy(false); } }}>Revalidar todas las filas</button></>}
 </fieldset>
 {asking && !pending && <div role="alertdialog" aria-label="Confirmar importación" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="font-bold">¿Crear y matricular {included.length} estudiantes? Las filas excluidas no se importarán.</p><button type="button" className="btn-secondary" onClick={() => setAsking(false)}>Seguir revisando</button></div>}
 <div className="sticky bottom-0 flex flex-wrap gap-3 border-t bg-white py-3"><button className="btn" type="button" disabled={!ready || busy || (!pending && !canCommit)} onClick={async () => {
 // In-app confirmation (Wave D.3) replaces window.confirm: the first press asks, the second commits.
 if (inFlight.current) return;
 if (!pending && !asking) { setAsking(true); return; }
 setAsking(false);
 inFlight.current = true; setBusy(true); setMessage("");
 try { const recovery = pending ?? loadBulk(sessionStorage, key, school); const request = recovery ?? prepareBulk(sessionStorage, key, { action: "commit", schoolId: school, rows, included_rows: included, confirmed: true }); setPending(request); const result = await sendBulk(request);
 if (result.status === "uncertain" || (recovery && result.status !== "committed")) { setMessage("Resultado pendiente de confirmar. Conservamos la misma clave y datos. Recupera el acceso y reintenta explícitamente; no crees otra solicitud."); return; }
 sessionStorage.removeItem(key); setPending(null);
 if (result.status === "committed") { setRows([]); setValidation(null); setIncluded([]); setMessage(`${result.created.length} estudiantes creados y matriculados.`); router.refresh(); }
 else { setValidation(result); setMessage("El estado cambió. Revisa las filas inválidas antes de confirmar nuevamente."); }
 } catch { setMessage("No se pudo preparar o confirmar la solicitud. Si existe una solicitud pendiente, permanece conservada."); }
 finally { inFlight.current = false; setBusy(false); }
 }}>{busy ? "Procesando…" : pending ? "Confirmar solicitud pendiente" : asking ? `Crear y matricular ${included.length} estudiantes` : "Confirmar importación"}</button><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>{pending ? "Cerrar y conservar solicitud" : "Cancelar"}</button></div>
 {message && <p className="break-words text-sm" role="status">{message}</p>}
 </div></AdminDialog>;
}
