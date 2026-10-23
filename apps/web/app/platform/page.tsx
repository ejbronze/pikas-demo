import Link from "next/link";
import { z } from "zod";
import { redirect } from "next/navigation";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { DEMO_HOME } from "../../lib/platform/demo-mode";
import { ReadFailure } from "./console-views";
import { AppPageHeader } from "../../components/app-page-header";
import { PlatformCockpit, type ActivityItem } from "../../components/platform/cockpit";
import { READINESS_CAPABILITY, readinessSchema } from "../../lib/platform/readiness";
import { activityLabel, recentCustomers } from "../../lib/platform/workspace";

const auditSchema = z.array(z.object({ id: z.uuid(), occurred_at: z.string(), action: z.string(), target_account_id: z.uuid().nullish() }));
// Each card appears only with the capability its destination requires, so none leads to a 403.
const destinations = [
  { href: "/platform/clientes", title: "Clientes", text: "Consulta cuentas, su estructura y sus administradores.", allowed: (c: string[]) => c.includes("platform:tenant:lifecycle:read") },
  { href: "/platform/clientes/nuevo", title: "Agregar colegio", text: "Registra un colegio y prepara a su administrador.", allowed: (c: string[]) => c.includes("platform:tenant:provision") && c.includes("platform:customer_admin:provision") },
  { href: "/platform/finanzas", title: "Finanzas", text: "Verifica transferencias bancarias de PIKAS Cash y revisa decisiones recientes.", allowed: (c: string[]) => c.includes("platform:finance:read") },
  { href: "/platform/equipo", title: "Equipo", text: "Operadores internos de PIKAS y sus accesos.", allowed: (c: string[]) => c.includes("platform:team:manage") },
  { href: "/platform/demostracion", title: "Demo", text: "Explora PIKAS en el entorno de demostración, separado de los clientes.", allowed: (c: string[]) => c.includes("platform:sandbox:pov:enter") },
];
export default async function PlatformHomePage() {
  // UX 11: in Demo mode the home of the Platform is the Demo workspace, never the real cockpit.
  const session = await requirePlatform({ demo: "allow" });
  if (session.demo) redirect(DEMO_HOME);
  const activity = session.capabilities.includes("platform:audit:read")
    ? await readPlatform(session, "platform:audit:read", "platform_read_audit", { p_limit: 50 }, auditSchema) : null;
  const when = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
  // The cockpit needs the customer-operations read; without it the destination cards remain.
  if (session.capabilities.includes(READINESS_CAPABILITY)) {
    const readiness = await readPlatform(session, READINESS_CAPABILITY, "platform_customer_readiness", { p_account_id: null }, readinessSchema);
    if (readiness.kind === "ready") {
      const names = new Map(readiness.value.customers.map(c => [c.account_id, c.name] as const));
      const items: ActivityItem[] | null = activity?.kind === "ready" ? activity.value.map(e => ({ id: e.id, label: activityLabel(e.action),
        customer: e.target_account_id ? names.get(e.target_account_id) ?? null : null, when: when(e.occurred_at) })) : null;
      // "Recent customers" = customers with recent Platform activity (audit), not a page-view history.
      const recent = activity?.kind === "ready" ? recentCustomers(activity.value).filter(r => names.has(r.account_id)).map(r => ({ account_id: r.account_id, name: names.get(r.account_id)!, label: activityLabel(r.last.action), when: when(r.last.occurred_at) })) : null;
      return <PlatformCockpit data={readiness.value} activity={items} recent={recent} canAdd={destinations[1].allowed(session.capabilities)}
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
      {activity.kind !== "ready" ? <ReadFailure kind={activity.kind} /> : activity.value.length === 0 ? <p className="mt-3">Todavía no hay actividad registrada.</p> : <ul className="mt-3 space-y-3">{activity.value.map((event) => <li key={event.id}>{activityLabel(event.action)}<span className="ml-2 text-sm text-slate-600">{new Date(event.occurred_at).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" })}</span></li>)}</ul>}
    </section>}
  </>;
}
