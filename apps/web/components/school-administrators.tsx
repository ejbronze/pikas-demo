"use client";
import { useState } from "react";
import { AppPageHeader } from "./app-page-header";
import { CommandTask } from "./command-task";
import { EmptyState } from "./state-panels";
import { SchoolCommandForm } from "./school-command-form";
import { useSchoolCommand } from "./school-command-task";
import { Input } from "./student-fields";
import { TaskSummary } from "./task-window";
import type { SchoolRead } from "../lib/school/contracts";

const statusLabel = (status: string) => ({ active: "Activo", suspended: "Suspendido", inactive: "Inactivo", pending: "Pendiente", accepted: "Completado", expired: "Vencido", revoked: "Revocado" })[status] ?? "No disponible";
const value = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

// School administrators (school scope only). Preparing access is a focused task; completing and
// suspending keep their existing commands. Role and grant authority stay server-side.
export function SchoolAdministrators({ data, actorId }: { data: SchoolRead; actorId: string }) {
  const [preparing, setPreparing] = useState(0), [notice, setNotice] = useState("");
  const props = { actorId, schoolId: data.scope.school_id };
  return <>
    <AppPageHeader title="Administradores" description="Personas con acceso de administración en esta escuela." action={<button type="button" className="btn" onClick={() => { setNotice(""); setPreparing(n => n + 1); }}>Preparar administrador</button>} />
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 font-bold text-emerald-900">{notice}</p>}
    <section className="space-y-3" aria-label="Administradores actuales">{data.memberships?.map(member => <article className="card p-4" key={member.id}><h2 className="font-bold">{member.display_name}{member.self ? " · Tú" : ""}</h2><p className="my-2 text-sm text-slate-500">{member.role === "account_admin" ? "Administrador de cuenta · Solo lectura aquí" : "Administrador de escuela"} · {statusLabel(member.status)}</p>{member.manageable && <SchoolCommandForm {...props} formId={`admin-status:${member.id}`} operation="admin_status" label={member.status === "active" ? "Suspender acceso" : "Activar acceso"} confirmation="¿Confirmar el cambio de acceso a esta escuela?" makePayload={() => ({ membership_id: member.id, status: member.status === "active" ? "suspended" : "active" })} />}</article>)}
      {!data.memberships?.length && <EmptyState title="No hay administradores visibles." />}</section>
    <h2 className="text-lg font-bold">Accesos preparados</h2><p className="text-sm text-slate-600">Preparar no concede acceso. No se envía un correo ni se crean contraseñas: la persona debe tener su correo confirmado antes de completar el acceso.</p>
    {data.invitations?.map(invite => <article className="card space-y-3 p-4" key={invite.id}><p className="break-all font-semibold">{invite.email}</p><p className="text-sm text-slate-500">{statusLabel(invite.status)} · Vence {new Date(invite.expires_at).toLocaleDateString("es-DO", { timeZone: "UTC" })}</p>{invite.status === "pending" && <SchoolCommandForm {...props} formId={`admin-complete:${invite.id}`} operation="admin_complete" label="Confirmar identidad y conceder acceso" confirmation="¿Conceder administración exclusivamente de esta escuela a la identidad confirmada de este correo?" makePayload={d => ({ invitation_id: invite.id, display_name: value(d, "display_name") })}><Input label="Nombre completo" name="display_name" maxLength={200} /></SchoolCommandForm>}</article>)}
    {!data.invitations?.length && <EmptyState title="No hay accesos preparados." description="Prepara el acceso de un administrador de esta escuela con su correo." />}
    {preparing > 0 && <PrepareAdministratorTask key={preparing} data={data} actorId={actorId} onClose={message => { setPreparing(0); if (message) setNotice(message); }} />}
  </>;
}

function PrepareAdministratorTask({ data, actorId, onClose }: { data: SchoolRead; actorId: string; onClose: (message?: string) => void }) {
  const command = useSchoolCommand(actorId, data.scope.school_id, "admin-prepare", "admin_prepare");
  const [email, setEmail] = useState("");
  if (!command.loaded) return null;
  const stored = command.pending?.command.operation === "admin_prepare" ? command.pending.command.payload : null;
  const rows = (address: string): [string, React.ReactNode][] => [["Correo", address], ["Acceso", "Administrador de escuela"], ["Escuela", data.scope.school_name]];
  return <CommandTask title="Preparar administrador" context={data.scope.school_name}
    pages={[{ label: "Correo", content: <><label className="block font-bold">Correo del administrador *<input className="field mt-1 w-full" type="email" required maxLength={254} data-autofocus value={email} onChange={e => setEmail(e.target.value)} /></label><p className="text-sm text-slate-600">Se prepara acceso exclusivamente a esta escuela. No se envía un correo ni se crean contraseñas.</p></> }]}
    review={<><TaskSummary rows={rows(email.trim())} /><p className="text-sm text-slate-600">Preparar no concede acceso. La persona debe tener su correo confirmado; después completas el acceso en Accesos preparados.</p></>}
    recovery={stored && <TaskSummary rows={rows(stored.email)} />}
    finalLabel="Preparar acceso" sendingLabel="Preparando acceso…" blocked={command.blocked} submit={() => command.submit(() => ({ email: email.trim() }))}
    dirty={!!email} success={{ title: "Acceso preparado", body: <p>No se envió correo ni se concedió autoridad.</p>, closeMessage: "Acceso de administrador preparado." }} onClose={onClose} />;
}
