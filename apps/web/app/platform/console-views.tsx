import Link from "next/link";
import { AppPageHeader } from "../../components/app-page-header";
import { ErrorState } from "../../components/state-panels";
import { statusLabel, type CustomerOverview } from "../../lib/platform/customer-contracts";

export function ReadFailure({ kind }: { kind: string }) {
  if (kind === "forbidden") return <ErrorState title="No tienes permiso para consultar clientes." description="Este destino requiere acceso de administración de clientes." />;
  if (kind === "missing") return <ErrorState title="No encontramos este cliente." retry={<Link className="btn-secondary" href="/platform/clientes">Ver clientes</Link>} />;
  return <ErrorState title="No pudimos cargar la información." description="Puede ser un problema temporal. Vuelve a intentarlo." retryHref="/platform/clientes" />;
}
const badgeTone: Record<string, string> = { active: "bg-emerald-100 text-emerald-900", suspended: "bg-amber-100 text-amber-950", closed: "bg-slate-200 text-slate-900", inactive: "bg-slate-200 text-slate-900" };
export function LifecycleBadge({ status }: { status: string }) {
  return <span className={`chip ${badgeTone[status] ?? "bg-slate-100"}`}>{statusLabel[status] ?? status}</span>;
}
export function CustomerHeading({ name, code, status, kind }: { name: string; code: string; status: string; kind: string }) {
  return <AppPageHeader back={{ href: "/platform/clientes", label: "Clientes" }} title={name}
    meta={<span className="flex flex-wrap items-center gap-2">{code}<LifecycleBadge status={status} /><span className={`chip ${kind === "sandbox" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{kind === "sandbox" ? "Sandbox · Demostración" : "Cliente"}</span></span>} />;
}
export function CustomerHierarchy({ customer, schoolAction }: { customer: CustomerOverview; schoolAction?: (school: CustomerOverview["schools"][number]) => React.ReactNode }) {
  return <section aria-label="Estructura del cliente" className="space-y-4"><h2 className="text-lg font-semibold">Estructura del cliente</h2>
    {customer.schools.length === 0 && <p>No hay escuelas registradas.</p>}
    {customer.schools.map((school) => <article key={school.id} className="card space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">{school.name}</h3><p className="text-sm text-slate-600">{school.code} · {statusLabel[school.status]} · {school.business_timezone}</p></div>{schoolAction?.(school)}</div>
      {school.locations.length === 0 && <p>Sin ubicaciones.</p>}
      {school.locations.map((location) => <div key={location.id} className="border-l-2 border-slate-200 pl-4">
        <h4 className="font-semibold">{location.name}</h4><p className="text-sm text-slate-600">{location.code} · {statusLabel[location.status]}</p>
        {location.cafeterias.length === 0 && <p>Sin cafeterías.</p>}
        {location.cafeterias.map((cafeteria) => <p key={cafeteria.id} className="mt-2">{cafeteria.name} <span className="text-sm text-slate-600">· {cafeteria.code} · {statusLabel[cafeteria.status]}</span></p>)}
      </div>)}
    </article>)}
  </section>;
}
export function CustomerLink({ id, name }: { id: string; name: string }) {
  return <Link className="inline-flex min-h-11 items-center font-semibold text-emerald-700 underline" href={`/platform/clientes/${id}`}>{name}</Link>;
}
