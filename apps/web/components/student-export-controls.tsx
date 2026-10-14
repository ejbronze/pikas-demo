"use client";
import { useRef, useState } from "react";
import type { SchoolStudent } from "../lib/school/contracts";
import { sessionFetch } from "../lib/auth/session-fetch";
import { studentExportCsv, studentExportFilename, studentExportLimit, visibleExportRows, type ExportFilters } from "../lib/school/student-export";
function download(blob: Blob, filename: string) {
 const url = URL.createObjectURL(blob), anchor = document.createElement("a");
 anchor.href = url; anchor.download = filename; document.body.appendChild(anchor);
 try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url),1000); }
}
export function StudentExportControls({ students, locations, filters }: { students: SchoolStudent[]; locations: { id: string; name: string }[]; filters: ExportFilters }) {
 const [busy,setBusy] = useState(false), [message,setMessage] = useState(""); const inFlight = useRef(false);
 return <section className="card min-w-0 space-y-3 p-4" aria-label="Exportar estudiantes">
 <p className="text-sm text-slate-600">Página visible: solo los {students.length} estudiantes cargados. Todos los resultados: búsqueda y filtros aplicados, hasta {studentExportLimit.toLocaleString("es-DO")} estudiantes. Para aplicar cambios a los filtros, pulsa Buscar.</p>
 <div className="flex min-w-0 flex-wrap gap-3"><button type="button" className="btn-secondary max-w-full whitespace-normal text-left" disabled={busy} onClick={() => {
  if (!students.length) { setMessage("No hay estudiantes en la página visible para exportar."); return; }
  try { download(new Blob([studentExportCsv(visibleExportRows(students,locations))],{type:"text/csv;charset=utf-8"}),studentExportFilename("pagina-visible")); setMessage(`Descarga preparada: ${students.length} estudiantes de la página visible.`); } catch { setMessage("No se pudo preparar la descarga. Reintenta."); }
 }}>Exportar página visible</button>
 <button type="button" className="btn-secondary max-w-full whitespace-normal text-left" disabled={busy} onClick={async () => {
  if (inFlight.current) return; inFlight.current = true; setBusy(true); setMessage("");
  try {
   const response = await sessionFetch("/api/school/students/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(filters),signal:AbortSignal.timeout(30000)});
   if (!response.ok) { setMessage(response.status === 413 ? `La exportación supera el límite de ${studentExportLimit.toLocaleString("es-DO")} estudiantes. Reduce los resultados con los filtros; no se ha descargado un archivo parcial.` : [401,403].includes(response.status) ? "Tu sesión o permisos no permiten exportar. Recupera el acceso y reintenta." : response.status === 400 ? "Los filtros no son válidos. Revisa la búsqueda y vuelve a aplicar los filtros." : "No se pudo exportar con el servicio actual. Reintenta."); return; }
   const count = Number(response.headers.get("X-Pikas-Export-Rows"));
   if (!response.headers.has("X-Pikas-Export-Rows") || !Number.isInteger(count) || count<0 || count>studentExportLimit || !response.headers.get("Content-Type")?.startsWith("text/csv")) throw new Error("Invalid export response");
   if (!count) { setMessage("No hay estudiantes que coincidan con los filtros aplicados."); return; }
   const blob = await response.blob(); if (!blob.size) throw new Error("Empty export response");
   download(blob,studentExportFilename("resultados-filtrados")); setMessage(`Descarga preparada: ${count} estudiantes de todos los resultados filtrados.`);
  } catch { setMessage("No se pudo completar la descarga. Reintenta; la exportación no modifica estudiantes."); }
  finally { inFlight.current = false; setBusy(false); }
 }}>{busy ? "Preparando todos los resultados…" : "Exportar todos los resultados filtrados"}</button></div>
 {message && <p role="status" className="break-words text-sm text-slate-600">{message}</p>}
 </section>;
}
