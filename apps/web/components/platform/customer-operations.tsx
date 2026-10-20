import Link from "next/link";
import type { OperationsOverview, SupportCafeteriaRead } from "../../lib/platform/customer-operations";
import { lifecycleNotice } from "../../lib/platform/customer-operations";
import { DataList } from "../data-list";
import { MetricCard } from "../metric-card";
import { MoneyValue } from "../money-value";
import { EmptyState } from "../state-panels";
import { LifecycleBadge } from "../../app/platform/console-views";

// Backoffice Customer Management (M1). Read-only presentation of a customer's cafeteria operations
// for PIKAS support. No edit, command, money or access controls are rendered here, and none of the
// endpoints this workspace uses can mutate anything.
const statusLabel = (s: string) => ({ active: "Activo", inactive: "Inactivo", suspended: "Suspendido", archived: "Archivado", pending: "Pendiente", accepted: "Completado", expired: "Vencido", revoked: "Revocado", closed: "Cerrado" })[s] ?? s;
const roleLabel = (r: string) => r === "pos_supervisor" ? "Supervisor" : "Cajero";
const weekday = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const managementHref = (accountId: string) => `/platform/clientes/${accountId}/gestion`;
export const cafeteriaHref = (accountId: string, cafeteriaId: string, section?: string) => `${managementHref(accountId)}/cafeterias/${cafeteriaId}${section && section !== "resumen" ? `?seccion=${section}` : ""}`;

export function SupportContext({ accountId, accountName, accountStatus, cafeteriaName }: { accountId: string; accountName: string; accountStatus: string; cafeteriaName?: string }) {
  return <section aria-label="Contexto de soporte" className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="min-w-0 flex-1 basis-60"><span className="block text-sm font-bold">Gestionando</span><span className="block break-words text-xl font-black">{accountName}</span>
        {cafeteriaName && <span className="block break-words font-bold">{cafeteriaName}</span>}</p>
      <LifecycleBadge status={accountStatus} />
    </div>
    <p className="text-sm">Estás viendo la operación como personal de PIKAS. Solo consulta: no se realizan cambios desde aquí.</p>
    {lifecycleNotice[accountStatus] && <p className="text-sm font-bold">{lifecycleNotice[accountStatus]}</p>}
    <div className="flex flex-wrap gap-2">
      {cafeteriaName && <Link href={managementHref(accountId)} className="btn-secondary bg-white">Todas las cafeterías</Link>}
      <Link href={`/platform/clientes/${accountId}`} className="btn-secondary bg-white">Volver al cliente</Link>
    </div>
  </section>;
}

export function CustomerStructure({ overview }: { overview: OperationsOverview }) {
  const a = overview.account, cafeterias = overview.schools.flatMap(s => s.locations.flatMap(l => l.cafeterias));
  return <section aria-labelledby="ops-structure" className="space-y-4">
    <h2 id="ops-structure" className="text-lg font-black">Cafeterías</h2>
    {!cafeterias.length ? <EmptyState title="Este cliente aún no tiene cafeterías." /> : overview.schools.map(s => <article key={s.id} className="card space-y-3 p-4 sm:p-5">
      <h3 className="font-black">{s.name} <span className="text-sm font-normal text-slate-600">· {statusLabel(s.status)}</span></h3>
      {s.locations.map(l => <div key={l.id} className="space-y-2 border-l-2 border-slate-200 pl-4">
        <h4 className="font-bold">{l.name} <span className="text-sm font-normal text-slate-600">· {statusLabel(l.status)}</span></h4>
        {l.cafeterias.length === 0 ? <p className="text-sm text-slate-600">Sin cafeterías.</p> : <ul className="space-y-2">{l.cafeterias.map(c => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
          <span className="min-w-0"><span className="block break-words font-bold">{c.name}</span><span className="text-sm text-slate-600">{c.code} · {statusLabel(c.status)}</span></span>
          <Link className="btn" href={cafeteriaHref(a.id, c.id)}>Ver operación<span className="sr-only"> de {c.name}</span></Link></li>)}</ul>}
      </div>)}
    </article>)}
  </section>;
}

export function CafeteriaSwitcher({ overview, accountId, selected, section }: { overview: OperationsOverview; accountId: string; selected: string; section: string }) {
  const options = overview.schools.flatMap(s => s.locations.flatMap(l => l.cafeterias.map(c => ({ ...c, place: l.name }))));
  if (options.length < 2) return null;
  return <nav aria-label="Cambiar cafetería" className="overflow-x-auto pb-1"><ul className="flex w-max gap-2">{options.map(c => {
    const current = c.id === selected;
    return <li key={c.id}><Link href={cafeteriaHref(accountId, c.id, section)} aria-current={current ? "true" : undefined}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-bold ${current ? "border-indigo-900 bg-indigo-900 text-white" : "border-slate-300 bg-white text-slate-800"}`}>
      {current && <span aria-hidden>✓</span>}{c.name}<span className="font-normal opacity-80">· {c.place}</span>{current && <span className="sr-only"> (seleccionada)</span>}</Link></li>;
  })}</ul></nav>;
}

export const sections = [["resumen", "Resumen"], ["productos", "Productos"], ["cajas", "Cajas"], ["personal", "Personal"], ["transacciones", "Transacciones"], ["reportes", "Reportes"]] as const;
export type Section = typeof sections[number][0];
export function SectionNav({ accountId, cafeteriaId, current }: { accountId: string; cafeteriaId: string; current: Section }) {
  return <nav aria-label="Secciones de la cafetería" className="overflow-x-auto"><ul className="flex w-max gap-1 rounded-2xl bg-slate-100 p-1">{sections.map(([key, label]) =>
    <li key={key}><Link href={cafeteriaHref(accountId, cafeteriaId, key)} aria-current={key === current ? "page" : undefined}
      className={`flex min-h-11 items-center rounded-xl px-4 text-sm font-bold ${key === current ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}>{label}</Link></li>)}</ul></nav>;
}

export function SupportSummary({ data }: { data: SupportCafeteriaRead }) {
  const products = data.products, registers = data.registers, staff = data.staff;
  const service = data.service;
  return <section className="space-y-4">
    <h1 className="text-2xl font-black sm:text-3xl">Resumen</h1>
    <p className="text-sm text-slate-600">{data.scope.school_name} · {data.scope.location_name} · Estado de la cafetería: {statusLabel(data.scope.cafeteria_status)}</p>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="Productos" help={`${products.filter(p => p.active && p.available).length} disponibles para vender`}>{products.length}</MetricCard>
      <MetricCard label="Categorías" help={`${data.categories.filter(c => c.status === "active").length} activas`}>{data.categories.length}</MetricCard>
      <MetricCard label="Cajas" help={`${registers.filter(r => r.open).length} con sesión abierta`}>{registers.length}</MetricCard>
      <MetricCard label="Personal POS" help={`${staff.filter(s => s.status === "active").length} activos`}>{staff.length}</MetricCard>
    </dl>
    <div className="card space-y-1 p-4 text-sm">
      <p><span className="font-bold">Venta por horario:</span> {data.settings.scheduling_enabled ? "Activada (menús y turnos)" : "Desactivada: se venden todos los productos activos y disponibles."}</p>
      {service && <p><span className="font-bold">Ahora:</span> {service.status === "active" ? `Turno ${service.service_shift_name ?? ""} · Menú ${service.menu_name ?? ""}` : service.status === "manual" ? "Venta sin horario" : service.status === "no_active_service" ? "Sin turno activo" : "Configuración de horario incompleta"} · {service.business_timezone}</p>}
      <p><span className="font-bold">Accesos POS pendientes:</span> {data.invitations.filter(i => i.status === "pending").length}</p>
    </div>
  </section>;
}

export function SupportProducts({ data }: { data: SupportCafeteriaRead }) {
  const byCategory = new Map(data.categories.map(c => [c.id, c]));
  const groups = [...data.categories, { id: null, name: "Sin categoría", status: "active" as const }].map(c => ({ category: c, products: data.products.filter(p => p.category_id === c.id) })).filter(g => g.products.length);
  return <section className="space-y-4">
    <h1 className="text-2xl font-black sm:text-3xl">Productos</h1>
    <p className="text-sm text-slate-600">Solo consulta. Los cambios del catálogo se hacen desde la cafetería.</p>
    {!data.products.length ? <EmptyState title="Esta cafetería aún no tiene productos." /> : groups.map(g => <section key={g.category.id ?? "none"} aria-labelledby={`cat-${g.category.id ?? "none"}`} className="space-y-2">
      <h2 id={`cat-${g.category.id ?? "none"}`} className="text-lg font-black">{g.category.name}{g.category.id && byCategory.get(g.category.id)?.status === "archived" ? " (archivada)" : ""}</h2>
      <DataList label={`Productos de ${g.category.name}`} rows={g.products} rowKey={p => p.id} columns={[
        { header: "Producto", primary: true, cell: p => <><span className="break-words">{p.name}</span>{p.description && p.description !== p.name && <span className="block text-sm font-normal text-slate-600">{p.description}</span>}</> },
        { header: "Precio", align: "end", cell: p => <MoneyValue minor={String(p.price_minor)} intent="amount" className="font-bold" /> },
        { header: "Unidad", cell: p => p.unit },
        { header: "Estado", cell: p => <span className="flex flex-wrap gap-1"><span className="chip">{p.active ? "Activo" : "Inactivo"}</span><span className="chip">{p.available ? "Disponible" : "Agotado"}</span></span> },
        { header: "Ingredientes", cell: p => p.ingredients.length ? p.ingredients.join(", ") : "—" },
      ]} />
    </section>)}
    {(data.menus.length > 0 || data.shifts.length > 0) && <section aria-labelledby="ops-menus" className="space-y-2">
      <h2 id="ops-menus" className="text-lg font-black">Menús y turnos</h2>
      <ul className="space-y-2">{data.menus.map(m => <li key={m.id} className="card p-3"><p className="font-bold">{m.name} <span className="font-normal text-slate-600">· {m.active ? "Activo" : "Archivado"} · {m.product_ids.length} productos</span></p>
        {data.shifts.filter(s => s.menu_id === m.id).map(s => <p key={s.id} className="text-sm text-slate-600">{s.name}: {s.start_time}–{s.end_time} · {s.weekdays.map(d => weekday[d]).join(", ")}{s.enabled ? "" : " · Desactivado"}</p>)}</li>)}</ul>
    </section>}
  </section>;
}

export function SupportRegisters({ data }: { data: SupportCafeteriaRead }) {
  const names = new Map(data.staff.map(s => [s.id, s.name]));
  return <section className="space-y-4">
    <h1 className="text-2xl font-black sm:text-3xl">Cajas</h1>
    <p className="text-sm text-slate-600">Solo consulta. Las cajas y asignaciones se configuran desde la cafetería; los cierres se hacen en el POS.</p>
    {!data.registers.length ? <EmptyState title="Esta cafetería aún no tiene cajas." /> : <DataList label="Cajas" rows={data.registers} rowKey={r => r.id} columns={[
      { header: "Caja", primary: true, cell: r => <>{r.name}<span className="block text-sm font-normal text-slate-600">{r.code}</span></> },
      { header: "Estado", cell: r => <span className="chip">{statusLabel(r.status)}</span> },
      { header: "Sesión", cell: r => r.open ? "Sesión abierta" : r.has_history ? "Sin sesión abierta" : "Nunca usada" },
      { header: "Personal asignado", cell: r => data.assignments.filter(a => a.register_id === r.id && a.status === "active").map(a => names.get(a.membership_id) ?? "—").join(", ") || "Sin asignación" },
    ]} />}
  </section>;
}

export function SupportStaff({ data }: { data: SupportCafeteriaRead }) {
  const registers = new Map(data.registers.map(r => [r.id, r.name]));
  return <section className="space-y-4">
    <h1 className="text-2xl font-black sm:text-3xl">Personal</h1>
    <p className="text-sm text-slate-600">Solo consulta. Los accesos del personal se gestionan desde la cafetería.</p>
    {!data.staff.length ? <EmptyState title="Esta cafetería aún no tiene personal POS." /> : <DataList label="Personal POS" rows={data.staff} rowKey={s => s.id} columns={[
      { header: "Empleado", primary: true, cell: s => s.name },
      { header: "Rol", cell: s => roleLabel(s.role) },
      { header: "Estado", cell: s => <span className="chip">{statusLabel(s.status)}</span> },
      { header: "Cajas", cell: s => data.assignments.filter(a => a.membership_id === s.id && a.status === "active").map(a => registers.get(a.register_id)).join(", ") || "Sin asignación" },
      { header: "Sesión", cell: s => s.open ? "Sesión abierta" : "Sin sesión abierta" },
    ]} />}
    <section aria-labelledby="ops-invitations" className="space-y-2">
      <h2 id="ops-invitations" className="text-lg font-black">Accesos preparados</h2>
      {!data.invitations.length ? <EmptyState title="No hay accesos preparados." /> : <ul className="space-y-2">{data.invitations.map(i => <li key={i.id} className="card p-3">
        <p className="break-all font-bold">{i.email}</p><p className="text-sm text-slate-600">{roleLabel(i.role)} · {statusLabel(i.status)} · Vence {new Date(i.expires_at).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}</p></li>)}</ul>}
    </section>
  </section>;
}
