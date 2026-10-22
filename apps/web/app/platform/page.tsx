import Link from "next/link";
import { z } from "zod";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { ReadFailure } from "./console-views";
import { AppPageHeader } from "../../components/app-page-header";
import { PlatformCockpit, type ActivityItem } from "../../components/platform/cockpit";
import { READINESS_CAPABILITY, readinessSchema } from "../../lib/platform/readiness";

const auditSchema = z.array(z.object({ id: z.uuid(), occurred_at: z.string(), action: z.string(), target_account_id: z.uuid().nullish() }));
const activityLabels: Record<string, string> = {
  tenant_provisioned: "Cliente creado", customer_admin_intent_prepared: "Administrador preparado",
  customer_admin_identity_linked: "Identidad de administrador vinculada", customer_admin_membership_granted: "Acceso de administrador otorgado",
  school_location_added: "Ubicación agregada", sandbox_pov_entered: "Demostración iniciada", sandbox_pov_exited: "Demostración finalizada",
  customer_profile_updated: "Perfil del cliente actualizado", customer_structure_renamed: "Sede o cafetería renombrada", customer_person_renamed: "Nombre de persona corregido",
  cafeteria_admin_granted: "Administrador de cafetería asignado",
  school_onboarded: "Colegio agregado", customer_suspended: "Cliente suspendido", customer_reactivated: "Cliente reactivado", customer_closed: "Cliente cerrado", customer_reopened: "Cliente reabierto",
};
// Each card appears only with the capability its destination requires, so none leads to a 403.
const destinations = [
  { href: "/platform/clientes", title: "Clientes", text: "Consulta cuentas, su estructura y sus administradores.", allowed: (c: string[]) => c.includes("platform:tenant:lifecycle:read") },
  { href: "/platform/clientes/nuevo", title: "Agregar colegio", text: "Registra un colegio y prepara a su administrador.", allowed: (c: string[]) => c.includes("platform:tenant:provision") && c.includes("platform:customer_admin:provision") },
  { href: "/platform/finanzas", title: "Finanzas", text: "Verifica transferencias bancarias de PIKAS Cash y revisa decisiones recientes.", allowed: (c: string[]) => c.includes("platform:finance:read") },
  { href: "/platform/equipo", title: "Equipo", text: "Operadores internos de PIKAS y sus accesos.", allowed: (c: string[]) => c.includes("platform:team:manage") },
  { href: "/platform/demostracion", title: "Demo", text: "Explora PIKAS en el entorno de demostración, separado de los clientes.", allowed: (c: string[]) => c.includes("platform:sandbox:pov:enter") },
];
export default async function PlatformHomePage() {
  const session = await requirePlatform();
  const activity = session.capabilities.includes("platform:audit:read")
    ? await readPlatform(session, "platform:audit:read", "platform_read_audit", { p_limit: 5 }, auditSchema) : null;
  const when = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
  // The cockpit needs the customer-operations read; without it the destination cards remain.
  if (session.capabilities.includes(READINESS_CAPABILITY)) {
    const readiness = await readPlatform(session, READINESS_CAPABILITY, "platform_customer_readiness", { p_account_id: null }, readinessSchema);
    if (readiness.kind === "ready") {
      const names = new Map(readiness.value.customers.map(c => [c.account_id, c.name] as const));
      const items: ActivityItem[] | null = activity?.kind === "ready" ? activity.value.map(e => ({ id: e.id, label: activityLabels[e.action] ?? "Actividad de plataforma",
        customer: e.target_account_id ? names.get(e.target_account_id) ?? null : null, when: when(e.occurred_at) })) : null;
      return <PlatformCockpit data={readiness.value} activity={items} canAdd={destinations[1].allowed(session.capabilities)}
        demoHref={session.capabilities.includes("platform:sandbox:pov:enter") ? "/platform/demostracion" : null} />;
    }
  }
  const available = destinations.filter((d) => d.allowed(session.capabilities));
  const administers = available.some((d) => d.href !== "/platform/demostracion" && d.href !== "/platform/finanzas");
  const finance = available.some((d) => d.href === "/platform/finanzas");
  return <><AppPageHeader title="PIKAS Admin" description={<>Hola, {session.identity.person.displayName}. {administers ? "Administra clientes y sus accesos desde aquí." : finance ? "Tu acceso incluye las operaciones financieras de PIKAS Cash." : available.length ? "Tu acceso de PIKAS Admin incluye Demo." : "Tu acceso no incluye destinos administrativos."}</>} />
    {available.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {available.map((d) => <Link key={d.href} className="card p-5" href={d.href}><h2 className="font-bold">{d.title}</h2><p>{d.text}</p></Link>)}
    </div>}
    {activity && <section className="card p-5"><h2 className="text-lg font-bold">Actividad reciente</h2>
      {activity.kind !== "ready" ? <ReadFailure kind={activity.kind} /> : activity.value.length === 0 ? <p className="mt-3">Todavía no hay actividad registrada.</p> : <ul className="mt-3 space-y-3">{activity.value.map((event) => <li key={event.id}>{activityLabels[event.action] ?? "Actividad de plataforma"}<span className="ml-2 text-sm text-slate-600">{new Date(event.occurred_at).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" })}</span></li>)}</ul>}
    </section>}
  </>;
}
