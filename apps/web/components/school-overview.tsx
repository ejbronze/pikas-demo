import Image from "next/image";
import Link from "next/link";
import { money } from "../lib/cafeteria/operations";
import { schoolAttention, serviceChecks, type OverviewInputs } from "../lib/school/overview";
import type { SchoolRead } from "../lib/school/contracts";

// PIKAS UX 4: the School Admin home. Students, access and service only; no cafeteria sales, tickets,
// tenders, products, cajas or cashier data. Wallet figures appear only with school:wallets:read.
const n = (k: number, one: string, many: string) => `${k.toLocaleString("es-DO")} ${k === 1 ? one : many}`;
const day = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

export function SchoolOverview({ data, overview }: { data: SchoolRead; overview: OverviewInputs }) {
  const href = (path: string) => `/admin/escuela${path}?school=${data.scope.school_id}`;
  const { counts, wallet } = overview, attention = schoolAttention(overview), checks = serviceChecks(overview);
  const rows = overview.cafeterias, serving = rows?.filter(r => r.active && r.sharing) ?? [];
  const ready = checks?.every(c => c.done) ?? false;
  return <div className="sch space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><h1 className="font-display text-3xl font-black text-[var(--primary)]">Resumen</h1>
        <p className="break-words text-slate-600">{data.scope.school_name} · estudiantes, accesos y servicio</p></div>
      <div className="flex flex-wrap gap-2"><Link className="btn" href={href("/estudiantes")}>Gestionar estudiantes</Link></div>
    </header>

    <section aria-labelledby="sch-students" className="sch-ledger">
      <h2 id="sch-students" className="sch-h2">Estudiantes</h2>
      {counts.students === 0
        ? <div className="sch-empty"><Image src="/brand/pikas-logo-mark-full-color.png" alt="" width={44} height={44} className="rounded-xl" />
            <div><p className="font-bold">Aún no hay estudiantes en este colegio.</p><p className="text-sm text-slate-600">Agrégalos uno por uno o importa un archivo CSV desde Estudiantes.</p></div></div>
        : <dl className="sch-figures">
          <div><dt>Estudiantes activos</dt><dd className="num-display">{counts.active.toLocaleString("es-DO")}</dd>
            <dd className="sch-help">{counts.suspended || counts.inactive ? [counts.suspended ? n(counts.suspended, "suspendido", "suspendidos") : "", counts.inactive ? n(counts.inactive, "inactivo", "inactivos") : ""].filter(Boolean).join(" · ") : `de ${n(counts.students, "estudiante registrado", "estudiantes registrados")}`}</dd></div>
          {wallet && <>
            <div><dt>Con PIKAS Cash</dt><dd className="num-display">{wallet.active_wallets.toLocaleString("es-DO")}</dd><dd className="sch-help">{wallet.active_wallets === 1 ? "monedero activo" : "monederos activos"}</dd></div>
            <div><dt>Movimiento en PIKAS Cash</dt><dd className="num-display">{wallet.wallets_with_movement.toLocaleString("es-DO")}</dd><dd className="sch-help">monederos con recargas, compras o ajustes · {day(wallet.from)} al {day(wallet.to)}</dd></div>
            <div><dt>Saldo de estudiantes</dt><dd className="num-display">{money(wallet.total_balance_minor)}</dd><dd className="sch-help">suma de los saldos de PIKAS Cash de los estudiantes</dd></div>
          </>}
        </dl>}
    </section>

    <div className="grid gap-5 lg:grid-cols-12">
      <section aria-labelledby="sch-attention" className={`${attention.length ? "sch-attention" : "sch-panel"} lg:col-span-7`}>
        <h2 id="sch-attention" className="sch-h2">{attention.length ? `Requiere atención · ${attention.length}` : "Todo en orden"}</h2>
        {attention.length === 0 ? <p className="sch-calm"><span aria-hidden>✓</span> No hay invitaciones vencidas{rows ? ", comparticiones pendientes" : ""}{wallet ? " ni monederos congelados o con saldo negativo" : ""}.</p>
          : <ul className="sch-list">{attention.map(a => <li key={a.key}><span className="min-w-0 flex-1">{a.text}</span><Link className="sch-action" href={href(a.href)}>{a.action}</Link></li>)}</ul>}
      </section>
      {checks && <section aria-labelledby="sch-service" className="sch-panel lg:col-span-5">
        <h2 id="sch-service" className="sch-h2">{ready ? "Listo para atender estudiantes" : "Servicio a estudiantes"}</h2>
        <ul className="sch-checks">{checks.map(c => <li key={c.key} data-done={c.done}><span className="sch-check" aria-hidden>{c.done ? "✓" : ""}</span>{c.label}<span className="sr-only">{c.done ? ": listo" : ": pendiente"}</span></li>)}</ul>
      </section>}
    </div>

    {rows && <section aria-labelledby="sch-cafeterias" className="sch-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="sch-cafeterias" className="sch-h2">Cafeterías que atienden al colegio</h2><Link className="sch-action" href={href("/cafeterias")}>Revisar cafeterías</Link></div>
      {rows.length === 0 ? <p className="text-sm text-slate-600">Todavía no hay cafeterías en este colegio. PIKAS las agrega al configurar el colegio.</p>
        : <>{serving.length === 0 && <p className="mb-2 text-sm text-slate-600">Ninguna cafetería tiene compartición activa con el colegio todavía.</p>}
          <ul className="sch-rows">{rows.map(r => <li key={r.id}>
            <div className="min-w-0 flex-1"><p className="font-bold break-words">{r.name}</p><p className="text-sm text-slate-600 break-words">{r.location}</p></div>
            <div className="sch-row-meta"><span className="sch-pill" data-state={r.active && r.sharing ? "on" : "off"}>{!r.active ? "Cafetería inactiva" : r.sharing ? "Compartición activa" : "Sin compartición activa"}</span>
              <span className="text-sm text-slate-700">{r.enabled_capped ? "100 o más estudiantes habilitados" : n(r.enabled_students, "estudiante habilitado", "estudiantes habilitados")}</span></div>
          </li>)}</ul></>}
    </section>}

    <nav aria-label="Accesos del colegio" className="sch-next">
      <Link href={href("/estudiantes")}>Estudiantes</Link>
      <Link href={href("/administradores")}>Administradores</Link>
      {rows && <Link href={href("/cafeterias")}>Cafeterías conectadas</Link>}
      {wallet && <Link href={href("/pikas-cash")}>PIKAS Cash</Link>}
      <Link href={href("/actividad")}>Actividad</Link>
    </nav>
  </div>;
}
