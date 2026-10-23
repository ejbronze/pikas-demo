import Link from "next/link";
import { cafeteriaHref } from "./customer-operations";
import { EmptyState } from "../state-panels";

// Operación: the entry to the existing Platform support workspace (platform:customer:operations:read
// and, where granted, :manage). It explains the boundary: PIKAS staff act as themselves, never as a
// customer user, and nothing here grants the customer's own authority.
const stateWord: Record<string, string> = { suspended: "Suspendida", inactive: "Inactiva", location_inactive: "Sede inactiva" };
export function CustomerOperationsEntry({ accountId, cafeterias, canManage }: { accountId: string; cafeterias: { id: string; name: string; location: string; status?: string }[]; canManage: boolean }) {
  return <section id="operacion" aria-labelledby="operacion-title" className="card space-y-4 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-64"><h2 id="operacion-title" className="text-lg font-bold">Operación</h2>
        <p className="text-sm text-slate-600">{canManage ? "Consulta y configura sus cafeterías como personal de PIKAS: productos, menús, cajas y personal. Transacciones y reportes son de solo consulta."
          : "Consulta sus cafeterías como personal de PIKAS: productos, cajas, personal, transacciones y reportes."} Actúas con tu propia cuenta de PIKAS, no como usuario del cliente.</p></div>
    </div>
    {cafeterias.length === 0 ? <EmptyState title="Este cliente aún no tiene cafeterías activas." description="La operación se consulta por cafetería. Cuando la estructura tenga una cafetería activa, aparecerá aquí." />
      : <ul className="ws-rows" aria-label="Cafeterías del cliente">{cafeterias.map(c => <li key={c.id}>
      <div className="min-w-0"><p className="font-semibold break-words">{c.name}{c.status && c.status !== "active" && <span className="chip ml-2 bg-slate-200 text-slate-900">{stateWord[c.status] ?? c.status} · historial</span>}</p><p className="text-sm text-slate-600 break-words">{c.location}</p></div>
      <div className="ws-links"><Link className="btn-tertiary" href={cafeteriaHref(accountId, c.id)} aria-label={`Abrir ${c.name}`}>Abrir</Link>
        <Link className="btn-tertiary" href={cafeteriaHref(accountId, c.id, "cajas")} aria-label={`Cajas de ${c.name}`}>Cajas</Link>
        <Link className="btn-tertiary" href={cafeteriaHref(accountId, c.id, "productos")} aria-label={`Productos de ${c.name}`}>Productos</Link>
        <Link className="btn-tertiary" href={cafeteriaHref(accountId, c.id, "personal")} aria-label={`Personal de ${c.name}`}>Personal</Link></div>
    </li>)}</ul>}
  </section>;
}
