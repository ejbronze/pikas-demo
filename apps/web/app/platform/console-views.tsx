import Link from "next/link";
import { AppPageHeader } from "../../components/app-page-header";
import { ErrorState } from "../../components/state-panels";
import { invalidResponseCopy } from "../../lib/ux/state-classes";
import { statusLabel, type CustomerOverview } from "../../lib/platform/customer-contracts";
import { countryName } from "../../lib/platform/dominican-provinces";

// UX 14: a failed Platform read says what happened. Permission and not-found never offer Reintentar;
// a suspended/closed customer is named as such; only a real failure is an alert with a retry.
export function ReadFailure({ kind, failure, reason, retryHref }: { kind: string; failure?: string; reason?: string; retryHref?: string }) {
  if (kind === "forbidden") return failure === "lifecycle"
    ? <ErrorState kind="lifecycle" title="Este cliente no está disponible en su estado actual." description="Está suspendido o cerrado. Solo la gestión de clientes de PIKAS puede restaurarlo." action={<Link className="btn-secondary" href="/platform/clientes">Ver clientes</Link>} />
    : <ErrorState kind="permission" title="No tienes permiso para consultar clientes." description="Lo administra un administrador de la plataforma de PIKAS; pídele el acceso si lo necesitas." />;
  if (kind === "missing") return <ErrorState kind="not_found" title="No encontramos este cliente." description="Puede haber sido cerrado o la dirección ya no es válida." action={<Link className="btn-secondary" href="/platform/clientes">Ver clientes</Link>} />;
  if (reason === "invalid_response") return <ErrorState title={invalidResponseCopy.title} description={invalidResponseCopy.description} retryHref={retryHref ?? "/platform/clientes"} />;
  return <ErrorState title="No pudimos cargar la información." description="Inténtalo de nuevo. Si continúa, vuelve a esta sección más tarde." retryHref={retryHref ?? "/platform/clientes"} />;
}
const badgeTone: Record<string, string> = { active: "bg-emerald-100 text-emerald-900", suspended: "bg-amber-100 text-amber-950", closed: "bg-slate-200 text-slate-900", inactive: "bg-slate-200 text-slate-900" };
export function LifecycleBadge({ status }: { status: string }) {
  return <span className={`chip ${badgeTone[status] ?? "bg-slate-100"}`}>{statusLabel[status] ?? status}</span>;
}
export function CustomerHeading({ name, code, status, kind, launch }: { name: string; code: string; status: string; kind: string; launch?: React.ReactNode }) {
  return <AppPageHeader back={{ href: "/platform/clientes", label: "Clientes" }} title={name}
    meta={<span className="flex flex-wrap items-center gap-2"><LifecycleBadge status={status} /><span className={`chip ${kind === "sandbox" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{kind === "sandbox" ? "Sandbox · Demostración" : "Cliente"}</span>{launch}<span className="text-xs text-slate-500">Código interno {code}</span></span>} />;
}
// Read-only colegio profile captured by Agregar colegio. Missing values are never inferred.
export function ColegioProfile({ customer, action }: { customer: CustomerOverview; action?: (school: CustomerOverview["schools"][number]) => React.ReactNode }) {
  if (customer.schools.length === 0) return null;
  const single = customer.schools.length === 1;
  return <section aria-labelledby="colegio-profile" className="card space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="colegio-profile" className="text-lg font-bold">{single ? "Información del colegio" : "Información de los colegios"}</h2>{single && action?.(customer.schools[0])}</div>
    {customer.schools.map((school) => <div key={school.id} className="space-y-2">{!single && <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold break-words">{school.name}</h3>{action?.(school)}</div>}
      <dl className="divide-y rounded-xl border px-4" aria-label={`Información de ${school.name}`}>
      {([["Nombre", school.name], ["RNC", school.rnc], ["Dirección", school.address], ["País", countryName(school.country)], ["Provincia", school.province_name ?? null], ["Código del colegio", school.code]] as const).map(([label, value]) =>
        <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"><dt className="text-sm text-slate-600">{label}</dt><dd className={`min-w-0 break-words text-right font-bold ${value ? "" : "text-slate-500"}`}>{value || "No registrado"}</dd></div>)}
    </dl></div>)}
  </section>;
}
type Location = CustomerOverview["schools"][number]["locations"][number];
export function CustomerHierarchy({ customer, schoolAction, locationAction, cafeteriaAction, cafeteriaLink }: { customer: CustomerOverview; schoolAction?: (school: CustomerOverview["schools"][number]) => React.ReactNode;
  locationAction?: (location: Location) => React.ReactNode; cafeteriaAction?: (cafeteria: Location["cafeterias"][number]) => React.ReactNode; cafeteriaLink?: (cafeteria: Location["cafeterias"][number]) => React.ReactNode }) {
  const meta = (code: string, status: string) => <span className="ws-meta">{statusLabel[status] ?? status} · {code}</span>;
  return <section aria-label="Estructura del cliente" className="card space-y-4 p-5" id="estructura"><h2 className="text-lg font-bold">Estructura</h2>
    {customer.schools.length === 0 && <p>No hay escuelas registradas.</p>}
    {customer.schools.map((school) => <article key={school.id} className="ws-tree">
      <div className="ws-node"><div className="min-w-0"><h3 className="font-bold break-words">{school.name}</h3><p>{meta(school.code, school.status)}</p></div>{schoolAction?.(school)}</div>
      {school.locations.length === 0 && <p className="ws-branch text-sm text-slate-600">Sin sedes.</p>}
      {school.locations.map((location) => <div key={location.id} className="ws-branch">
        <div className="ws-node"><div className="min-w-0"><h4 className="font-semibold break-words"><span className="ws-kind">Sede</span> {location.name}</h4><p>{meta(location.code, location.status)}</p></div>{locationAction?.(location)}</div>
        {location.cafeterias.length === 0 && <p className="ws-branch text-sm text-slate-600">Sin cafeterías.</p>}
        {location.cafeterias.map((cafeteria) => <div key={cafeteria.id} className="ws-branch ws-node">
          <div className="min-w-0"><p className="font-semibold break-words"><span className="ws-kind">Cafetería</span> {cafeteria.name}</p><p>{meta(cafeteria.code, cafeteria.status)}</p></div>
          <div className="ws-links">{cafeteriaLink?.(cafeteria)}{cafeteriaAction?.(cafeteria)}</div></div>)}
      </div>)}
    </article>)}
  </section>;
}
export function CustomerLink({ id, name }: { id: string; name: string }) {
  return <Link className="inline-flex min-h-11 items-center font-semibold text-emerald-700 underline" href={`/platform/clientes/${id}`}>{name}</Link>;
}
