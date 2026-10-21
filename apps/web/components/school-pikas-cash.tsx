import Image from "next/image";
import Link from "next/link";
import { money } from "../lib/cafeteria/operations";
import { needsAttention, walletLabel, type WalletOverview, type WalletStudent } from "../lib/school/wallets";
import { SchoolWalletReport } from "./school-wallet-report";

// PIKAS UX 7: School PIKAS Cash = student wallet administration. Wallet state and balance per
// student, a few wallet aggregates and factual attention. No purchases, products, receipts,
// per-cafetería spending or rankings on this page; the period movement report stays secondary.
const n = (k: number, one: string, many: string) => `${k.toLocaleString("es-DO")} ${k === 1 ? one : many}`;
const day = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");
const studentStatus = { active: "", suspended: "Suspendido", inactive: "Inactivo" } as const;

export function SchoolPikasCash({ schoolId, schoolName, overview, students, view, attentionCount, query, paged, nextCursor }: {
  schoolId: string; schoolName: string; overview: WalletOverview | null; students: WalletStudent[] | null; view: "todos" | "atencion"; attentionCount: number | null;
  query: string; paged: boolean; nextCursor: string | null }) {
  const base = `/admin/escuela/pikas-cash?school=${schoolId}`;
  const walletHref = (id: string) => `/admin/escuela/estudiantes/${id}/pikas-cash?school=${schoolId}&from=pikas-cash`;
  const studentHref = (id: string) => `/admin/escuela/estudiantes/${id}?school=${schoolId}`;
  const filtered = !!query;
  return <div className="pc space-y-5">
    <header className="min-w-0"><h1 className="font-display text-3xl font-black text-[var(--primary)]">PIKAS Cash</h1>
      <p className="break-words text-slate-600">{schoolName} · monederos de los estudiantes</p></header>

    <section aria-labelledby="pc-overview" className="sch-ledger">
      <h2 id="pc-overview" className="sch-h2">Monederos</h2>
      {!overview ? <p className="text-sm text-slate-600" role="alert">No pudimos cargar el resumen de monederos. Intenta de nuevo.</p>
        : overview.wallet_count === 0 ? <div className="sch-empty"><Image src="/brand/pikas-logo-mark-full-color.png" alt="" width={44} height={44} className="rounded-xl" />
            <div><p className="font-bold">Aún no hay monederos de PIKAS Cash en este colegio.</p><p className="text-sm text-slate-600">El monedero de un estudiante activo y matriculado se crea con su primera recarga, desde su PIKAS Cash.</p></div></div>
        : <dl className="sch-figures">
          <div><dt>Monederos activos</dt><dd className="num-display">{overview.active.toLocaleString("es-DO")}</dd><dd className="sch-help">de {n(overview.wallet_count, "monedero", "monederos")}{overview.frozen ? ` · ${n(overview.frozen, "congelado", "congelados")}` : ""}</dd></div>
          <div><dt>Saldo de estudiantes</dt><dd className="num-display">{money(overview.total_balance_minor)}</dd><dd className="sch-help">suma de los saldos de PIKAS Cash, ahora</dd></div>
          <div><dt>Monederos con movimiento</dt><dd className="num-display">{overview.with_movement.toLocaleString("es-DO")}</dd><dd className="sch-help">con recargas, compras o ajustes · {day(overview.from)} al {day(overview.to)}</dd></div>
        </dl>}
    </section>

    {attentionCount !== null && <section aria-labelledby="pc-attention" className={attentionCount ? "sch-attention" : "sch-panel"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="pc-attention" className="sch-h2">{attentionCount ? `Requiere atención · ${attentionCount}` : "Todo en orden"}</h2>
        {attentionCount > 0 && view === "todos" && <Link className="sch-action" href={`${base}&vista=atencion`}>Ver monederos</Link>}</div>
      <p className={attentionCount ? "text-sm text-[var(--attention-ink)]" : "sch-calm"}>{attentionCount ? `${n(attentionCount, "monedero está congelado o tiene", "monederos están congelados o tienen")} saldo negativo${attentionCount === 50 ? " (se muestran los primeros 50)" : ""}.` : <><span aria-hidden>✓</span> Ningún monedero congelado ni con saldo negativo.</>}</p>
    </section>}

    <section aria-labelledby="pc-students" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="pc-students" className="sch-h2">Monederos de estudiantes</h2>
        <nav aria-label="Vista de monederos" className="stu-chips">
          <Link className="stu-chip" aria-current={view === "todos" ? "page" : undefined} href={base}>Todos</Link>
          {attentionCount ? <Link className="stu-chip" aria-current={view === "atencion" ? "page" : undefined} href={`${base}&vista=atencion`}>Requieren atención<span className="stu-chip-count">{attentionCount}</span></Link> : null}
        </nav></div>
      {view === "todos" && <form method="get" action="/admin/escuela/pikas-cash" className="stu-search" role="search" aria-label="Buscar monederos">
        <input type="hidden" name="school" value={schoolId} /><label className="sr-only" htmlFor="pc-q">Buscar estudiante</label>
        <input id="pc-q" className="field min-w-0 flex-1" type="search" name="q" placeholder="Nombre o código" maxLength={80} defaultValue={query} />
        <button className="btn-secondary">Buscar</button>{filtered && <Link className="inline-flex min-h-11 items-center font-bold text-teal-800 underline" href={base}>Limpiar</Link>}
      </form>}
      {students === null ? <p className="sch-panel text-sm text-slate-600" role="alert">No pudimos cargar los monederos. Intenta de nuevo.</p>
        : students.length === 0 ? <p className="sch-panel text-sm text-slate-600">{view === "atencion" ? "Ningún monedero requiere atención." : filtered || paged ? "No encontramos estudiantes con esa búsqueda." : <>Aún no hay estudiantes en este colegio. <Link className="font-bold underline" href={`/admin/escuela/estudiantes?school=${schoolId}`}>Ir a Estudiantes</Link></>}</p>
        : <ul aria-label="Monederos de estudiantes" className="pc-list">{students.map(s => <li key={s.id} data-attention={needsAttention(s) || undefined}>
            <div className="pc-who"><Link className="stu-name" href={studentHref(s.id)}>{s.name}</Link><span className="stu-meta">Código {s.code}{studentStatus[s.status] ? ` · ${studentStatus[s.status]}` : ""}</span></div>
            <span className="pc-state" data-state={!s.wallet ? "none" : needsAttention(s) ? "attention" : "active"}>{walletLabel(s.wallet)}{s.wallet && s.wallet.balance_minor.startsWith("-") ? " · saldo negativo" : ""}</span>
            <span className="pc-balance num">{s.wallet ? money(s.wallet.balance_minor) : "—"}</span>
            <Link className="btn-tertiary pc-open" href={walletHref(s.id)}>PIKAS Cash<span className="sr-only"> de {s.name}</span></Link>
          </li>)}</ul>}
      {view === "todos" && <div className="flex flex-wrap gap-3">{paged && <Link className="btn-secondary" href={`${base}&${new URLSearchParams({ q: query })}`}>Primera página</Link>}
        {nextCursor && <Link className="btn-secondary" href={`${base}&${new URLSearchParams({ q: query, after: nextCursor })}`}>Siguiente página</Link>}</div>}
    </section>

    <details className="sch-panel pc-report"><summary className="flex min-h-11 cursor-pointer items-center font-bold">Reporte de movimientos por período</summary>
      <p className="mt-1 text-sm text-slate-600">Recargas, compras, reembolsos y correcciones de los monederos del colegio en el período elegido.</p>
      <div className="mt-3"><SchoolWalletReport schoolId={schoolId} embedded /></div></details>
  </div>;
}
