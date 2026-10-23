import { AdminStatus } from "../admin-interactions";
import { statusLabel, type CustomerOverview } from "../../lib/platform/customer-contracts";
import type { CustomerActivationStatus } from "../../lib/platform/customer-activation";
import { CustomerActivationAction } from "../../app/platform/clientes/[accountId]/activation-action";
import { AdministratorAction } from "../../app/platform/clientes/[accountId]/administrator-action";

// Administrador inicial. Once the customer has an administrator with access, the preparation
// workflow is over: the block states who completed it and keeps any leftover request visible as
// history, without activation or completion controls (no accidental second initial administrator).
// While a request is live, its status and recovery actions are the whole block; the preparation
// form appears only when nothing exists yet.
type Intent = CustomerOverview["administrator_intents"][number];
export function InitialAdministrator({ customer, intents, activation, actor, canPrepare, canComplete }: {
  customer: CustomerOverview; intents: Intent[]; activation: (CustomerActivationStatus | null)[]; actor: string; canPrepare: boolean; canComplete: boolean;
}) {
  const completed = customer.administrators.length > 0, live = intents.filter(i => ["pending", "linked"].includes(i.status)), granted = intents.some(i => i.status === "granted");
  const settled = intents.filter(i => !["pending", "linked"].includes(i.status));
  const settledLabel: Record<string, string> = { granted: "Acceso completado", expired: "Solicitud vencida", revoked: "Solicitud revocada" };
  const inactive = customer.tenant_kind === "customer" && customer.account.status !== "active";
  return <section id="administrador-inicial" className="card scroll-mt-24 space-y-3 p-5" aria-labelledby="administrador-inicial-title">
    <div><h2 id="administrador-inicial-title" className="font-bold">Administrador inicial{completed ? " · completado" : ""}</h2>
      <p className="text-sm text-slate-600">{completed ? "El primer acceso del colegio ya está completo. Los demás accesos se dan desde Personas y accesos." : "Primer acceso del colegio: se prepara, se activa con un enlace privado y se completa aquí."}</p></div>
    {customer.administrators.map((admin, index) => <p key={index}>{admin.display_name} · Acceso completado · {statusLabel[admin.status]} · Persona {statusLabel[admin.person_status]?.toLowerCase()}</p>)}
    {completed && live.length > 0 && <details className="text-sm"><summary className="flex min-h-11 cursor-pointer items-center font-bold">Solicitudes anteriores sin usar ({live.length})</summary>
      <ul className="mt-2 space-y-2">{live.map(i => <li key={i.id} className="rounded-lg bg-slate-50 p-3"><p className="break-all font-semibold">{i.display_name ?? i.email}</p><p className="text-slate-600">{statusLabel[i.status]} · vence el {new Date(i.expires_at).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}. Ya existe un administrador: esta solicitud no es necesaria y no se completa.</p></li>)}</ul></details>}
    {!completed && live.map(intent => { const index = intents.indexOf(intent); return <article className="rounded-lg border p-4" key={intent.id}>
      <p className="font-semibold">{intent.display_name ?? intent.email}</p><p className="break-all">{intent.email}</p>
      <div className="mt-2 flex flex-wrap gap-2">{intent.status === "pending" && <AdminStatus label="Acceso preparado" />}<AdminStatus label={intent.status === "pending" ? activation[index]?.identity_state === "ready" ? "Listo para completar" : "Activación pendiente" : "Listo para completar"} /></div>
      <p className="mt-2 text-sm text-slate-600">Genera un enlace privado para que la persona active su identidad y guarde su contraseña. El enlace vence en una hora: entrégalo cuando la persona pueda usarlo. No se envía correo. Después completa este mismo acceso preparado. La solicitud vence el {new Date(intent.expires_at).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}.</p>
      {canComplete && !granted && <CustomerActivationAction intentId={intent.id} status={activation[index]} />}
      {canComplete && !granted && <AdministratorAction actor={actor} accountId={customer.account.id} intentId={intent.id} identityReady={activation[index]?.identity_state === "ready"} intendedName={intent.intended_display_name} />}
    </article>; })}
    {settled.map(i => <p key={i.id} className="text-sm text-slate-700"><span className="font-semibold">{i.display_name ?? i.email}</span> · {settledLabel[i.status] ?? statusLabel[i.status]}</p>)}
    {!completed && live.length === 0 && !granted && (canPrepare ? <><p className="text-sm">Prepara el correo del primer administrador. Después genera su enlace privado de activación. Preparar no concede acceso.</p><AdministratorAction actor={actor} accountId={customer.account.id} /></>
      : <p className="text-sm text-slate-600">{inactive ? "Mientras el cliente no esté activo no se preparan nuevos accesos." : "No hay solicitudes de administrador inicial visibles."}</p>)}
    {inactive && (completed || live.length > 0) && <p className="text-sm text-slate-600">Mientras el cliente no esté activo no se preparan nuevos accesos.</p>}
  </section>;
}
