import Link from "next/link";
import { Building2, ChevronRight, Landmark, Network } from "lucide-react";
import { BarList, ReportSummary, ReportTable } from "../report-frame";
import { LaunchPill, StepMeter } from "./cockpit";
import { customerHref, shortDate } from "../../lib/platform/readiness";
import { money } from "../../lib/cafeteria/operations";
import { launchCounts, launchText, lifecycleCounts, lifecycleLabel, networkTotals, readinessGap, stepLabel, studentServiceLabel,
  type CustomerFilters, type CustomerRow, type FinanceReport, type NetworkReport } from "../../lib/platform/reports";
import { reportHref } from "../../lib/reports/filters";

// PIKAS Platform Reportes (Reporting Consolidation). Presentation of reads the page already validated under its own authority.
export const platformReportPath = (report = "") => `/platform/reportes${report && `/${report}`}`;
const n = (k: number, one: string, many: string) => `${k.toLocaleString("es-DO")} ${k === 1 ? one : many}`;
const num = (k: number) => k.toLocaleString("es-DO");

export function PlatformReportsIndex({ network, finance }: { network: boolean; finance: boolean }) {
  const reports = [
    ...(network ? [{ report: "clientes", icon: Building2, name: "Clientes", purpose: "Cartera de clientes: ciclo de vida, presencia en la red y puesta en marcha de cada uno." },
      { report: "red", icon: Network, name: "Red y adopción", purpose: "Cafeterías en operación: preparación operativa, servicio a estudiantes y uso real en el período." }] : []),
    ...(finance ? [{ report: "finanzas", icon: Landmark, name: "Finanzas (resumen)", purpose: "Activación financiera, recargas, obligaciones y estado de las liquidaciones. Solo lectura." }] : []),
  ];
  return <div className="space-y-5">
    <header className="min-w-0"><h1 className="font-display text-3xl font-black text-[var(--primary)]">Reportes</h1>
      <p className="break-words text-slate-600">Red PIKAS · ¿qué quieres entender de la red?</p></header>
    <ul className="rpt-index" aria-label="Reportes de la plataforma">{reports.map(r => <li key={r.report}>
      <Link href={platformReportPath(r.report)}><r.icon aria-hidden size={22} className="rpt-index-icon" />
        <span className="min-w-0 flex-1"><span className="rpt-index-name">{r.name}</span><span className="rpt-index-purpose">{r.purpose}</span></span>
        <ChevronRight aria-hidden size={20} className="shrink-0 text-slate-400" /></Link></li>)}</ul>
    <p className="text-sm text-slate-600">Los reportes cuentan solo clientes reales; Colegio Horizonte y otras demostraciones se excluyen salvo que elijas «Incluir Demo». Cada reporte se puede imprimir y exportar en CSV con los filtros aplicados. Las operaciones se hacen en Clientes y Finanzas, no aquí.</p>
  </div>;
}

// Shown whenever Demo data is part of what the viewer is looking at (screen and print).
export function DemoIncluded() {
  return <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950">Incluye datos de demostración (Demo). Las filas marcadas «Demo» no son clientes reales y no se cuentan como puesta en marcha.</p>;
}
const DemoTag = () => <span className="chip ml-2 bg-amber-100 text-amber-950">Demo</span>;

const lifecycleOptions = [["", "Todos"], ["active", "Activo"], ["suspended", "Suspendido"], ["closed", "Cerrado"]] as const;
const readinessOptions = [["", "Todas"], ["configuring", "En configuración"], ["ready", "Listo para operar"], ["operating", "Operando"]] as const;

// Clientes: the customer portfolio. Summary, distribution and table all count the same filtered rows.
export function CustomersReportBody({ filters: f, all, rows, truncated }: { filters: CustomerFilters; all: CustomerRow[]; rows: CustomerRow[]; truncated: boolean }) {
  const path = platformReportPath("clientes"), c = launchCounts(rows), l = lifecycleCounts(rows), keep = { q: f.q, status: f.status, step: f.step, attention: f.attention, demo: f.demo };
  const filtered = !!(f.q || f.status || f.readiness || f.step || f.attention);
  const anyReal = all.some(r => !r.demo);
  return <div className="space-y-5">
    <form method="get" action={path} className="rpt-filter-form" data-print="hide" aria-label="Filtrar clientes">
      <label>Buscar<input className="field" type="search" name="q" defaultValue={f.q} maxLength={80} placeholder="Nombre o código" /></label>
      <label>Ciclo de vida<select className="field" name="status" defaultValue={f.status}>{lifecycleOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <label>Puesta en marcha<select className="field" name="readiness" defaultValue={f.readiness}>{readinessOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <label className="flex min-h-11 items-center gap-2 self-end"><input type="checkbox" name="demo" value="1" defaultChecked={f.demo === "1"} className="size-5" />Incluir Demo</label>
      {f.step && <input type="hidden" name="step" value={f.step} />}{f.attention && <input type="hidden" name="attention" value={f.attention} />}
      <button className="btn-secondary">Aplicar</button>
      {(filtered || f.demo) && <Link className="inline-flex min-h-11 items-center font-bold text-teal-800 underline" href={path}>Limpiar filtros</Link>}
    </form>
    {f.demo === "1" && <DemoIncluded />}
    {!anyReal && !f.demo ? <p className="sch-panel text-sm text-slate-600">Todavía no hay clientes en la red.</p> : rows.length === 0 ? <p className="sch-panel text-sm text-slate-600">Ningún cliente coincide con estos filtros.</p> : <>
      <ReportSummary label="Resumen de clientes" items={[
        { label: "Clientes", value: num(rows.length), help: filtered ? "con los filtros aplicados" : f.demo ? "reales y Demo" : "todos los clientes reales" },
        { label: "Activos", value: num(l.active), help: [l.suspended ? n(l.suspended, "suspendido", "suspendidos") : "", l.closed ? n(l.closed, "cerrado", "cerrados") : ""].filter(Boolean).join(" · ") || "ninguno suspendido ni cerrado" },
        { label: "Listos para operar", value: num(c.ready), help: `${n(c.configuring, "en configuración", "en configuración")}` },
        { label: "Operando", value: num(c.operating), help: "con al menos una venta real" },
      ]} />
      <section aria-labelledby="rpt-lifecycle" className="sch-panel space-y-3">
        <h2 id="rpt-lifecycle" className="sch-h2">Ciclo de vida</h2>
        <p className="rpt-help">Suspender es temporal y reversible; un cliente cerrado conserva su historial en solo lectura. Nada se elimina.</p>
        <BarList label="Clientes por ciclo de vida" unit={["cliente", "clientes"]} items={([["active", "Activo"], ["suspended", "Suspendido"], ["closed", "Cerrado"]] as const).map(([k, label]) => ({ key: k, label, count: l[k],
          href: l[k] ? reportHref(path, { ...keep, status: k, readiness: f.readiness }) : undefined }))} />
      </section>
      {!f.readiness && c.configuring + c.ready + c.operating > 0 && <section aria-labelledby="rpt-launch" className="sch-panel space-y-3">
        <h2 id="rpt-launch" className="sch-h2">Puesta en marcha de los clientes activos</h2>
        <p className="rpt-help">Cuántos clientes activos están en cada etapa. Los clientes suspendidos o cerrados y las demostraciones no tienen etapa.</p>
        <BarList label="Clientes activos por etapa" unit={["cliente", "clientes"]} items={([["configuring", "En configuración"], ["ready", "Listo para operar"], ["operating", "Operando"]] as const).map(([k, label]) => ({ key: k, label, count: c[k],
          href: c[k] ? reportHref(path, { ...keep, readiness: k }) : undefined }))} />
      </section>}
      <section aria-labelledby="rpt-customers" className="space-y-3">
        <h2 id="rpt-customers" className="sch-h2">{n(rows.length, "cliente", "clientes")}</h2>
        <ReportTable label="Clientes del reporte" rows={rows} rowKey={r => r.id} columns={[
          { header: "Cliente", primary: true, cell: r => <span className="break-words"><Link className="rpt-record" href={customerHref(r.id)}>{r.name}</Link>{r.demo && <DemoTag />}<span className="block text-sm font-normal text-slate-600">{r.code}</span></span> },
          { header: "Ciclo de vida", nowrap: true, cell: r => lifecycleLabel(r.status) },
          { header: "Puesta en marcha", cell: r => r.launch === "demo" || r.launch === "inactive" ? <span className="net-pill" data-launch="inactive">{launchText(r)}</span> : <LaunchPill status={r.launch} lifecycle={r.status} /> },
          { header: "Pasos", cell: r => r.demo ? "—" : <StepMeter steps={r.steps} /> },
          { header: "Presencia", cell: r => r.footprint ? <span className="text-sm">{n(r.footprint.schools.active, "colegio", "colegios")} · {n(r.footprint.locations.active, "sede", "sedes")}{r.footprint.locations.inactive ? ` (+${r.footprint.locations.inactive} inactiva${r.footprint.locations.inactive === 1 ? "" : "s"})` : ""}<br />
            {n(r.footprint.cafeterias.active, "cafetería activa", "cafeterías activas")}{r.footprint.cafeterias.suspended ? ` · ${r.footprint.cafeterias.suspended} suspendida${r.footprint.cafeterias.suspended === 1 ? "" : "s"}` : ""}{r.footprint.cafeterias.inactive ? ` · ${r.footprint.cafeterias.inactive} inactiva${r.footprint.cafeterias.inactive === 1 ? "" : "s"}` : ""} · {n(r.footprint.registers.active, "caja", "cajas")}</span> : "—" },
          { header: "Siguiente paso", cell: r => r.demo || r.launch === "inactive" ? "—" : r.launch === "operating" ? (r.next ? `${r.next.label} (pendiente)` : "—") : r.launch === "ready" ? "Primera venta" : r.next?.label ?? "—" },
          { header: "Última venta", nowrap: true, cell: r => r.lastSale ? shortDate(r.lastSale) : "—" },
        ]} />
      </section></>}
    {truncated && <p className="sch-attention text-sm" role="status">La lectura de la red incluye los primeros 200 clientes por nombre. Acota con la búsqueda; el CSV no se genera incompleto.</p>}
    {f.step && <p className="rpt-help">Paso pendiente: {stepLabel[f.step]} — clientes activos que aún no completan ese paso.</p>}
  </div>;
}

// Red y adopción: cafeterías en operación of active customers — readiness and use, each with its own definition.
export function NetworkReportBody({ report, demo }: { report: NetworkReport; demo: boolean }) {
  const t = networkTotals(report);
  if (t.customers === 0) return <p className="sch-panel text-sm text-slate-600">{demo ? "No hay clientes activos, ni siquiera de demostración." : "Todavía no hay clientes activos en la red."}</p>;
  const pct = (k: number) => `${k} de ${t.cafeterias}`;
  return <div className="space-y-5">
    <ReportSummary label="Resumen de la red" items={[
      { label: "Clientes activos", value: num(t.customers), help: `${n(t.schools, "colegio activo", "colegios activos")} · ${n(t.locations, "sede activa", "sedes activas")}${t.demoCustomers ? ` · ${t.demoCustomers} Demo` : ""}` },
      { label: "Cafeterías en operación", value: num(t.cafeterias), help: `${n(t.registers, "caja activa", "cajas activas")} · ${t.staffedRegisters} con personal` },
      { label: "Ventas en el período", value: num(t.sales), help: `${n(t.withSales, "cafetería con ventas", "cafeterías con ventas")} · ${n(t.customersWithSales, "cliente", "clientes")}` },
      { label: "Estudiantes habilitados", value: num(t.enabledStudents), help: "por las escuelas, en cafeterías en operación" },
    ]} />
    <section aria-labelledby="rpt-adoption" className="sch-panel space-y-3">
      <h2 id="rpt-adoption" className="sch-h2">Cafeterías en operación: preparación y uso</h2>
      <p className="rpt-help">De {n(t.cafeterias, "cafetería en operación", "cafeterías en operación")}. Cada barra es una condición distinta; no se suman en una puntuación.</p>
      <BarList label="Cafeterías por condición" items={[
        { key: "ready", label: "Lista para operar", count: t.ready, value: pct(t.ready) },
        { key: "students", label: "Servicio a estudiantes listo", count: t.studentService, value: pct(t.studentService) },
        { key: "sales", label: "Con ventas en el período", count: t.withSales, value: pct(t.withSales) },
      ]} />
      <dl className="rpt-help space-y-1">
        <div><dt className="inline font-bold">Lista para operar: </dt><dd className="inline">al menos una caja activa con personal de caja asignado y un producto disponible; si usa turnos, al menos un turno habilitado. Una primera venta no la vuelve «lista».</dd></div>
        <div><dt className="inline font-bold">Servicio a estudiantes listo: </dt><dd className="inline">el colegio comparte la cafetería con «Identificación básica» y habilitó al menos un estudiante activo.</dd></div>
        <div><dt className="inline font-bold">Con ventas: </dt><dd className="inline">al menos una venta confirmada con fecha de operación dentro del período.</dd></div>
      </dl>
    </section>
    <section aria-labelledby="rpt-structure" className="space-y-3">
      <h2 id="rpt-structure" className="sch-h2">Por cafetería</h2>
      <ReportTable label="Preparación y uso por cafetería" rows={t.rows} rowKey={r => r.cafeteria.cafeteria_id} columns={[
        { header: "Cafetería", primary: true, cell: r => <span className="break-words">{r.cafeteria.name}{r.customer.demo && <DemoTag />}<span className="block text-sm font-normal text-slate-600"><Link className="underline" href={customerHref(r.customer.account_id)}>{r.customer.name}</Link> · {r.cafeteria.school} · {r.cafeteria.location}</span></span> },
        { header: "Lista para operar", cell: r => r.cafeteria.operationally_ready ? "Sí" : <span>No<span className="block text-sm text-slate-600">{readinessGap(r.cafeteria)}</span></span> },
        { header: "Servicio a estudiantes", cell: r => <span>{studentServiceLabel[r.cafeteria.student_service]}{r.cafeteria.student_service === "ready" && <span className="block text-sm text-slate-600">{n(r.cafeteria.enabled_students, "estudiante habilitado", "estudiantes habilitados")}</span>}</span> },
        { header: "Ventas", align: "end", cell: r => num(r.cafeteria.sales) },
        { header: "Estudiantes atendidos", align: "end", cell: r => num(r.cafeteria.students_served) },
        { header: "Última venta", nowrap: true, cell: r => r.cafeteria.last_sale_at ? shortDate(r.cafeteria.last_sale_at) : "—" },
      ]} />
    </section>
    {t.dormant.length > 0 && <p className="rpt-help">{n(t.dormant.length, "cafetería en operación no registró ventas", "cafeterías en operación no registraron ventas")} en el período: {t.dormant.map(r => r.cafeteria.name).join(", ")}.</p>}
    <p className="rpt-help">Solo clientes activos y cafeterías en operación (cafetería activa en una sede activa de un colegio activo). PIKAS no muestra aquí montos de venta: cada cafetería ve su negocio en sus propios reportes.</p>
    {report.truncated && <p className="sch-attention text-sm" role="status">La lectura de la red incluye los primeros 200 clientes por nombre; los totales cubren solo esos clientes y el CSV no se genera.</p>}
  </div>;
}

// Finanzas (resumen): what finance needs to know at a glance; every action stays in Finanzas.
export function FinanceReportBody({ report: f }: { report: FinanceReport }) {
  const active = f.activations.filter(a => a.status === "active"), pending = f.settlements.due + f.settlements.in_review;
  const sum = (k: "gross_minor" | "fee_minor" | "net_minor") => f.replenishments.reduce((a, r) => a + BigInt(r[k]), 0n).toString();
  return <div className="space-y-5">
    <ReportSummary label="Resumen financiero" items={[
      { label: "Clientes con activación financiera", value: num(active.length), help: active.length ? active.map(a => a.customer).join(", ") : "ninguno: PIKAS Cash sin modelo financiero" },
      { label: "Recargas en el período", value: money(sum("gross_minor")), help: `cargo PIKAS ${money(sum("fee_minor"))} · acreditado ${money(sum("net_minor"))}` },
      { label: "Liquidaciones pendientes", value: num(pending), help: `${f.settlements.overdue} vencida${f.settlements.overdue === 1 ? "" : "s"} · ${f.settlements.in_review} en revisión` },
      { label: "Semanas por liquidar", value: num(f.ready_periods), help: "semanas cerradas sin calcular" },
    ]} />
    <section aria-labelledby="rpt-fin-settle" className="sch-panel space-y-3">
      <h2 id="rpt-fin-settle" className="sch-h2">Liquidaciones pendientes de pago o en revisión</h2>
      <dl className="tabular-nums">
        <div className="flex flex-wrap justify-between gap-x-4 py-1"><dt>Las cafeterías deben enviar a PIKAS</dt><dd className="font-bold">{money(f.settlements.cafeterias_owe_minor)}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-4 py-1"><dt>PIKAS debe pagar a las cafeterías</dt><dd className="font-bold">{money(f.settlements.pikas_owes_minor)}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-4 py-1"><dt>Liquidadas en el período</dt><dd>{num(f.settlements.settled_in_period)}</dd></div>
      </dl>
      <p className="rpt-help">Totales por dirección, sin compensar entre cafeterías. Los pagos, revisiones y cálculos se hacen en <Link className="font-bold underline" href="/platform/finanzas/liquidaciones">Finanzas · Liquidaciones</Link>.</p>
    </section>
    <section aria-labelledby="rpt-fin-open" className="sch-panel space-y-3">
      <h2 id="rpt-fin-open" className="sch-h2">Obligaciones aún sin liquidar</h2>
      <dl className="tabular-nums">
        <div className="flex flex-wrap justify-between gap-x-4 py-1"><dt>Las cafeterías deben (efectivo recibido y reembolsos)</dt><dd className="font-bold">{money(f.unsettled_obligations.cafeterias_owe_minor)}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-4 py-1"><dt>PIKAS debe (ventas con PIKAS Cash)</dt><dd className="font-bold">{money(f.unsettled_obligations.pikas_owes_minor)}</dd></div>
      </dl>
      <p className="rpt-help">Movimientos de la semana en curso o de semanas cerradas que todavía no se calculan. {n(f.unsettled_obligations.count, "obligación", "obligaciones")}.</p>
    </section>
    <section aria-labelledby="rpt-fin-repl" className="space-y-3">
      <h2 id="rpt-fin-repl" className="sch-h2">Recargas acreditadas en el período</h2>
      {f.replenishments.length === 0 ? <p className="sch-panel text-sm text-slate-600">No hubo recargas acreditadas en el período.</p>
        : <ReportTable label="Recargas por método" rows={f.replenishments} rowKey={r => r.method} columns={[
          { header: "Método", primary: true, cell: r => r.method === "cafeteria_cash" ? "Efectivo en la cafetería" : "Transferencia verificada" },
          { header: "Recargas", align: "end", cell: r => num(r.count) },
          { header: "Recibido", align: "end", nowrap: true, cell: r => money(r.gross_minor) },
          { header: "Cargo PIKAS", align: "end", nowrap: true, cell: r => money(r.fee_minor) },
          { header: "Acreditado", align: "end", nowrap: true, cell: r => money(r.net_minor) },
        ]} />}
      <p className="rpt-help">{n(f.reversals.count, "reversión", "reversiones")} en el período ({money(f.reversals.net_minor)} retirados de PIKAS Cash). Montos tal como se registraron; el cargo no se recalcula.</p>
    </section>
    {f.activations.length > 0 && <section aria-labelledby="rpt-fin-act" className="space-y-3">
      <h2 id="rpt-fin-act" className="sch-h2">Activaciones financieras</h2>
      <ReportTable label="Activaciones financieras" rows={f.activations} rowKey={a => `${a.code}:${a.activated_at}`} columns={[
        { header: "Cliente", primary: true, cell: a => `${a.customer} · ${a.code}` },
        { header: "Estado", cell: a => a.status === "active" ? "Activa" : "Terminada" },
        { header: "Política", cell: a => `Versión ${a.policy_version} · cargo ${a.fee_bps / 100} %` },
        { header: "Desde", nowrap: true, cell: a => shortDate(a.activated_at) },
        { header: "Hasta", nowrap: true, cell: a => a.ended_at ? shortDate(a.ended_at) : "—" },
      ]} />
    </section>}
  </div>;
}
