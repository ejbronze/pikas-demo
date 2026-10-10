import Link from "next/link";
import { statusLabel, type CustomerOverview } from "../../lib/platform/customer-contracts";

export function ReadFailure({ kind }: { kind: string }) {
  return <div role="alert" className="card p-5">{kind === "forbidden" ? "No tienes permiso para consultar clientes." : kind === "missing" ? "No encontramos este cliente." : "No pudimos cargar la información. Actualiza la página para volver a intentarlo."}</div>;
}
export function CustomerHeading({ name, code, status, kind }: { name: string; code: string; status: string; kind: string }) {
  return <div><h1 className="text-2xl font-bold">{name}</h1><p className="mt-2 text-slate-600">{code} · {statusLabel[status]}</p>
    <span className={`chip mt-2 ${kind === "sandbox" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{kind === "sandbox" ? "Sandbox · Demostración" : "Cliente"}</span></div>;
}
export function CustomerHierarchy({ customer }: { customer: CustomerOverview }) {
  return <section aria-label="Estructura del cliente" className="space-y-4"><h2 className="text-lg font-semibold">Estructura del cliente</h2>
    {customer.schools.length === 0 && <p>No hay escuelas registradas.</p>}
    {customer.schools.map((school) => <article key={school.id} className="card space-y-3 p-5">
      <h3 className="font-bold">{school.name}</h3><p className="text-sm text-slate-600">{school.code} · {statusLabel[school.status]} · {school.business_timezone}</p>
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
  return <Link className="font-semibold text-emerald-700 underline" href={`/platform/clientes/${id}`}>{name}</Link>;
}
