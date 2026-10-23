import Link from "next/link";
import { LaunchChecklist } from "./cockpit";
import { EmptyState, ErrorState } from "../state-panels";
import { studentServiceCopy, type StudentServiceStatus } from "../../lib/cafeteria/student-service";
import { launchStatus, nextStep, readinessSteps, type CustomerReadiness } from "../../lib/platform/readiness";
import { structureSummary, workspaceHref } from "../../lib/platform/workspace";
import { cafeteriaHref } from "./customer-operations";
import type { CustomerOverview } from "../../lib/platform/customer-contracts";

// Resumen: the customer setup map. Platform-owned steps come from the readiness facts (Puesta en
// marcha); the School-owned student service comes from the cafetería support read's aggregate
// status (UX 13B) — counts and states only, never a student. Each block says who owns the next
// action and whether Platform can do it; Platform never performs School or Cafetería steps.
export type CafeteriaService = { id: string; name: string; location: string; school: string; status: StudentServiceStatus | null; read: "ready" | "unavailable" };

export function SetupMap({ customer, launch, readinessFailed, services }: { customer: CustomerOverview; launch: CustomerReadiness | null; readinessFailed: boolean; services: CafeteriaService[] | null }) {
  const counts = { school_count: customer.schools.length, location_count: customer.schools.reduce((n, s) => n + s.locations.length, 0), cafeteria_count: customer.schools.reduce((n, s) => n + s.locations.reduce((m, l) => m + l.cafeterias.length, 0), 0) };
  const steps = launch ? readinessSteps(launch) : null, next = steps ? nextStep(steps) : null, status = launch ? launchStatus(launch, steps!) : null;
  return <div className="space-y-5">
    <section aria-labelledby="resumen-next" className="card p-5">
      <h2 id="resumen-next" className="text-lg font-bold">Dónde está este cliente</h2>
      <p className="mt-1 text-sm text-slate-600">{structureSummary(counts)} · {customer.administrators.length === 1 ? "1 administrador con acceso" : `${customer.administrators.length} administradores con acceso`}</p>
      {customer.account.status !== "active" ? <p className="mt-3 text-sm"><span className="font-bold">La puesta en marcha queda en pausa.</span> El cliente no está activo; su estado se administra en <Link className="font-bold underline" href={workspaceHref(customer.account.id, "estado")}>Estado</Link>.</p>
        : status === "operating" ? <p className="mt-3 text-sm"><span className="font-bold">Operando.</span> La puesta en marcha está completa y ya hubo ventas reales.</p>
        : next ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <div className="min-w-0 flex-1 basis-60"><p className="text-xs font-bold uppercase tracking-wider text-amber-950">Siguiente paso · lo completa {next.owner === "PIKAS" ? "PIKAS" : "la cafetería"}</p><p className="font-bold">{next.label}</p><p className="text-sm text-slate-700">{next.detail}</p>
              <p className="text-xs text-slate-600">{next.owner === "PIKAS" ? "La Plataforma puede completarlo desde este cliente." : "La Plataforma solo lo consulta; el administrador de la cafetería lo completa."}</p></div>
            {next.action && <Link className="btn" href={next.action.href}>{next.action.label}</Link>}
          </div>
        : status === "ready" ? <p className="mt-3 text-sm"><span className="font-bold">Listo para operar.</span> Falta la primera venta real en el POS.</p> : null}
    </section>
    {launch ? <LaunchChecklist customer={launch} /> : readinessFailed ? <ErrorState title="No pudimos cargar la puesta en marcha de este cliente." description="Actualiza la página para intentarlo de nuevo. El resto del cliente se muestra con normalidad." /> : null}
    {services && <StudentServiceMap accountId={customer.account.id} services={services} />}
  </div>;
}

export function StudentServiceMap({ accountId, services }: { accountId: string; services: CafeteriaService[] }) {
  return <section id="servicio-estudiantes" aria-labelledby="service-title" className="card scroll-mt-24 space-y-3 p-5">
    <div><h2 id="service-title" className="text-lg font-bold">Servicio a estudiantes · lo administra el colegio</h2>
      <p className="text-sm text-slate-600">Los estudiantes que cada POS puede atender los comparte y habilita el colegio, no la cafetería ni PIKAS. Aquí solo se ve el estado; si falta algo, pide al administrador del colegio que comparta la cafetería y habilite estudiantes.</p></div>
    {services.length === 0 ? <EmptyState title="Este cliente aún no tiene cafeterías activas." description="El servicio a estudiantes aparece por cafetería cuando la estructura tenga una cafetería activa." />
      : <ul className="divide-y rounded-xl border" aria-label="Servicio a estudiantes por cafetería">{services.map(s => {
        const copy = s.status ? studentServiceCopy(s.status, s.school, s.name) : null;
        return <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
          <div className="min-w-0 flex-1 basis-56"><p className="font-bold">{s.name} <span className="font-normal text-slate-600">· {s.location}</span></p>
            <p className="text-sm text-slate-700">{copy ? copy.detail : s.read === "unavailable" ? "No pudimos consultar el estado de esta cafetería ahora." : "Esta cafetería todavía no informa el estado del servicio a estudiantes."}</p></div>
          <div className="flex flex-wrap items-center gap-2">{copy && <span className="hoy-pill" data-state={copy.tone === "ready" ? "open" : copy.tone === "off" ? "stale" : "closed"}>{copy.label}</span>}
            <Link className="btn-tertiary" href={cafeteriaHref(accountId, s.id)}>Ver operación<span className="sr-only"> de {s.name}</span></Link></div>
        </li>; })}</ul>}
    <p className="text-xs text-slate-500">Propietario del siguiente paso: el colegio. La Plataforma no comparte ni habilita estudiantes y no ve la lista de estudiantes.</p>
  </section>;
}
