import Link from "next/link";
import { z } from "zod";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { ReadFailure } from "./console-views";

const auditSchema = z.array(z.object({ id: z.uuid(), occurred_at: z.string(), action: z.string() }));
const activityLabels: Record<string, string> = {
  tenant_provisioned: "Cliente creado", customer_admin_intent_prepared: "Administrador preparado",
  customer_admin_identity_linked: "Identidad de administrador vinculada", customer_admin_membership_granted: "Acceso de administrador otorgado",
  school_location_added: "Ubicación agregada", sandbox_pov_entered: "Demostración iniciada", sandbox_pov_exited: "Demostración finalizada",
};
export default async function PlatformHomePage() {
  const session = await requirePlatform();
  const activity = session.capabilities.includes("platform:audit:read")
    ? await readPlatform(session, "platform:audit:read", "platform_read_audit", { p_limit: 5 }, auditSchema) : null;
  return <><h1 className="text-3xl font-bold">PIKAS Platform</h1><p>Hola, {session.identity.person.displayName}. Administra clientes y sus accesos desde aquí.</p>
    <div className="grid gap-4 sm:grid-cols-3">
      {session.capabilities.includes("platform:tenant:lifecycle:read") && <Link className="card p-5" href="/platform/clientes"><h2 className="font-bold">Clientes</h2><p>Consulta cuentas y su estructura.</p></Link>}
      {session.capabilities.includes("platform:tenant:provision") && session.capabilities.includes("platform:customer_admin:provision") && <Link className="card p-5" href="/platform/clientes/nuevo"><h2 className="font-bold">Nuevo cliente</h2><p>Crea la estructura inicial y prepara su administrador.</p></Link>}
      {session.capabilities.includes("platform:sandbox:pov:enter") && <Link className="card p-5" href="/platform/demostracion"><h2 className="font-bold">Demostración</h2><p>Accede al sandbox separado de los clientes.</p></Link>}
    </div>
    {activity && <section className="card p-5"><h2 className="text-lg font-bold">Actividad reciente</h2>
      {activity.kind !== "ready" ? <ReadFailure kind={activity.kind} /> : activity.value.length === 0 ? <p className="mt-3">Todavía no hay actividad registrada.</p> : <ul className="mt-3 space-y-3">{activity.value.map((event) => <li key={event.id}>{activityLabels[event.action] ?? "Actividad de plataforma"}<span className="ml-2 text-sm text-slate-600">{new Date(event.occurred_at).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}</span></li>)}</ul>}
    </section>}
  </>;
}
