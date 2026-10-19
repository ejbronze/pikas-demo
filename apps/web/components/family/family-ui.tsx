import Link from "next/link";
import { money } from "../../lib/cafeteria/operations";
import type { PurchaseSummary, StudentSummary, WalletActivity } from "../../lib/family/contracts";
import { activitySpoken, activityTitle, childMarkers, formatTime, formatWhen, paymentLabel, refundLabel, remainingToday, restrictionKind } from "../../lib/family/presentation";
import { MoneyValue } from "../money-value";
import { EmptyState } from "../state-panels";

// Consumer-facing building blocks for the Parent and Student experiences: warm, plain language,
// money that is labelled in words, no admin density. Data always arrives as family-safe contracts.
type Tone = "student" | "parent";
const heroTone: Record<Tone, string> = { student: "from-violet-950 via-violet-800 to-fuchsia-600", parent: "from-blue-950 via-blue-800 to-teal-600" };

export function BalanceHero({ student, tone, whose }: { student: StudentSummary; tone: Tone; whose: "tu" | "su" }) {
  const w = student.wallet, left = remainingToday(student), limit = student.controls.daily_limit_minor;
  return <section aria-labelledby={`balance-${student.student_id}`} className={`rounded-3xl bg-gradient-to-br ${heroTone[tone]} p-5 text-white shadow-lg sm:p-7`}>
    <h2 id={`balance-${student.student_id}`} className="text-sm font-bold text-white/85">{whose === "tu" ? "Tu saldo PIKAS Cash" : `Saldo PIKAS Cash de ${student.first_name}`}</h2>
    {w ? <p className="mt-1 break-words text-4xl font-black tracking-tight tabular-nums sm:text-5xl"><span className="sr-only">Saldo PIKAS Cash de {student.display_name}: </span>{money(w.balance_minor)}</p>
      : <p className="mt-2 text-2xl font-black">{whose === "tu" ? "Aún no tienes PIKAS Cash" : "Aún no tiene PIKAS Cash"}</p>}
    {!w && <p className="mt-1 text-sm text-white/85">{whose === "tu" ? "Tu familia o escuela puede recargarlo." : "Se crea con la primera recarga."}</p>}
    {w?.status === "frozen" && <p className="mt-3 inline-flex min-h-8 items-center rounded-full bg-white/15 px-3 text-sm font-bold">{whose === "tu" ? "Tu PIKAS Cash está pausado." : "PIKAS Cash pausado por la escuela."}</p>}
    {limit !== null && w && <dl className="mt-5 grid grid-cols-2 gap-3">
      <div className="rounded-2xl bg-white/10 p-3"><dt className="text-xs font-bold text-white/80">{whose === "tu" ? "Hoy gastaste" : "Gastó hoy"}</dt><dd className="mt-1 text-lg font-black tabular-nums">{money(student.controls.spent_today_minor)}</dd></div>
      <div className="rounded-2xl bg-white/10 p-3"><dt className="text-xs font-bold text-white/80">{whose === "tu" ? "Te queda hoy" : "Le queda hoy"}</dt><dd className="mt-1 text-lg font-black tabular-nums">{money(left ?? "0")}</dd></div>
    </dl>}
  </section>;
}

export function PurchaseCard({ purchase, level = 3, whose }: { purchase: PurchaseSummary; level?: 2 | 3; whose: "tu" | "su" }) {
  const H = level === 2 ? "h2" : "h3", refund = refundLabel(purchase);
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <div className="min-w-0"><H className="break-words font-black">Compra en {purchase.cafeteria_name}</H>
        <p className="text-sm text-slate-600">{formatWhen(purchase.purchased_at)} · Recibo #{purchase.receipt_number}</p></div>
      <p className="shrink-0 text-lg font-black tabular-nums"><span className="sr-only">Total: </span>{money(purchase.total_minor)}</p>
    </div>
    <ul className="mt-3 space-y-1.5 text-sm">{purchase.items.map((item, i) => <li key={i} className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 break-words">{item.quantity} × {item.name}{item.refunded_quantity > 0 && <span className="ml-1 font-semibold text-slate-600">({item.refunded_quantity === item.quantity ? "reembolsado" : `${item.refunded_quantity} reembolsado`})</span>}</span>
      <span className="shrink-0 tabular-nums text-slate-700">{money(item.line_total_minor)}</span></li>)}</ul>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="chip bg-slate-100 text-slate-800">Pagada con {paymentLabel[purchase.payment]}</span>
      {refund && <span className="chip bg-emerald-50 text-emerald-900">{refund} · {money(purchase.refunded_minor)} devuelto</span>}
    </div>
    {purchase.payment === "cash" && <p className="mt-2 text-sm text-slate-600">Pagada en efectivo: {whose === "tu" ? "tu" : "su"} saldo PIKAS Cash no cambió.</p>}
  </article>;
}

export function PurchaseList({ purchases, whose, emptyTitle = "Todavía no hay compras." }: { purchases: PurchaseSummary[]; whose: "tu" | "su"; emptyTitle?: string }) {
  if (!purchases.length) return <EmptyState title={emptyTitle} description="Cuando haya compras en la cafetería aparecerán aquí." />;
  return <div className="space-y-3">{purchases.map(p => <PurchaseCard key={p.purchase_id} purchase={p} whose={whose} />)}</div>;
}

export function ActivityList({ activity, whose, label }: { activity: WalletActivity[]; whose: "tu" | "el"; label: string }) {
  if (!activity.length) return <EmptyState title="Sin movimientos de PIKAS Cash." description="Las recargas, compras con PIKAS Cash y reembolsos aparecerán aquí." />;
  return <ul aria-label={label} className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">{activity.map(a => <li key={a.id} className="flex items-start gap-3 px-4 py-3.5">
    <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-full text-lg font-black ${BigInt(a.amount_minor) < 0n ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-800"}`}>{BigInt(a.amount_minor) < 0n ? "−" : "+"}</span>
    <div className="min-w-0 flex-1"><p className="break-words font-bold leading-snug">{activityTitle(a)}</p><p className="text-sm text-slate-600">{formatWhen(a.occurred_at)}</p>
      <p className="text-sm text-slate-600">Saldo después: <span className="whitespace-nowrap font-semibold text-slate-800">{money(a.balance_after_minor)}</span></p></div>
    <span aria-hidden className="shrink-0 whitespace-nowrap pt-0.5 font-black tabular-nums"><MoneyValue minor={a.amount_minor} intent="movement" /></span>
    <span className="sr-only">{activitySpoken(a, whose)}</span>
  </li>)}</ul>;
}

export function ControlsPanel({ student, audience }: { student: StudentSummary; audience: "student" | "parent" }) {
  const c = student.controls;
  return <section aria-labelledby={`controls-${student.student_id}`} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <h2 id={`controls-${student.student_id}`} className="text-lg font-black">{audience === "parent" ? "Configuración del estudiante" : "Límites y cuidados"}</h2>
    <p className="text-sm text-slate-600">{audience === "parent" ? "Administrada por la escuela." : "Tu escuela administra estos datos."}</p>
    <dl className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl bg-slate-50 p-3"><dt className="text-sm text-slate-600">Límite diario</dt><dd className="font-black">{c.daily_limit_minor === null ? "Sin límite diario" : money(c.daily_limit_minor)}</dd></div>
      <div className="rounded-xl bg-slate-50 p-3"><dt className="text-sm text-slate-600">Límite por compra</dt><dd className="font-black">{c.per_purchase_limit_minor === null ? "Sin límite por compra" : money(c.per_purchase_limit_minor)}</dd></div>
    </dl>
    <h3 className="mt-4 font-bold">Alergias y restricciones</h3>
    {student.restrictions.length ? <ul className="mt-2 flex flex-wrap gap-2">{student.restrictions.map((r, i) => <li key={i} className={`chip min-h-9 ${r.kind === "allergen" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-950"}`}>{restrictionKind[r.kind]}: {r.label}</li>)}</ul>
      : <p className="mt-1 text-sm text-slate-600">No hay alergias ni restricciones registradas.</p>}
  </section>;
}

const markerTone: Record<string, string> = { inactive: "bg-slate-200 text-slate-800", no_wallet: "bg-slate-100 text-slate-800", frozen: "bg-amber-100 text-amber-950", limit_reached: "bg-amber-100 text-amber-950", no_cafeteria: "bg-slate-100 text-slate-800" };
export function Markers({ student }: { student: StudentSummary }) {
  const markers = childMarkers(student);
  return markers.length ? <ul aria-label="Avisos" className="flex flex-wrap gap-2">{markers.map(m => <li key={m.kind} className={`chip min-h-8 ${markerTone[m.kind]}`}>{m.label}</li>)}</ul> : null;
}

export function ChildCard({ student, href, featured = false }: { student: StudentSummary; href: string; featured?: boolean }) {
  const inactive = student.status === "inactive", w = student.wallet;
  return <article className={`rounded-3xl border bg-white p-5 shadow-sm ${inactive ? "border-slate-200 bg-slate-50" : "border-slate-200"} ${featured ? "sm:p-7" : ""}`}>
    <div className="flex items-start gap-3"><span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-lg font-black text-blue-800">{student.first_name[0]}</span>
      <div className="min-w-0"><h2 className="break-words text-lg font-black leading-snug">{student.display_name}</h2><p className="text-sm text-slate-600">{[student.grade, student.campus_name].filter(Boolean).join(" · ") || student.school_name}</p></div></div>
    {inactive ? <p className="mt-4 text-sm text-slate-700">Este estudiante no está disponible en este momento.</p> : <>
      <div className="mt-4"><p className="text-sm font-bold text-slate-600">PIKAS Cash</p>
        {w ? <p className="break-words text-3xl font-black tabular-nums"><span className="sr-only">Saldo PIKAS Cash de {student.display_name}: </span>{money(w.balance_minor)}</p> : <p className="text-lg font-black">Aún no tiene PIKAS Cash</p>}</div>
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {student.controls.daily_limit_minor !== null && <div className="flex gap-1"><dt className="text-slate-600">Hoy:</dt><dd className="font-bold tabular-nums">{money(student.controls.spent_today_minor)} de {money(student.controls.daily_limit_minor)}</dd></div>}
        <div className="flex gap-1"><dt className="text-slate-600">Última compra:</dt><dd className="font-bold">{student.last_purchase_at ? formatWhen(student.last_purchase_at) : "Ninguna"}</dd></div>
      </dl>
    </>}
    <div className="mt-3"><Markers student={student} /></div>
    {!inactive && <Link href={href} className="btn mt-4 w-full sm:w-auto">Ver actividad<span className="sr-only"> de {student.display_name}</span></Link>}
  </article>;
}

export function ChildSwitcher({ students, selected, hrefFor }: { students: StudentSummary[]; selected: string; hrefFor: (id: string) => string }) {
  if (students.length < 2) return null;
  return <nav aria-label="Elegir estudiante" className="-mx-4 overflow-x-auto px-4 pb-1"><ul className="flex w-max gap-2">{students.map(s => {
    const current = s.student_id === selected;
    return <li key={s.student_id}><Link href={hrefFor(s.student_id)} aria-current={current ? "true" : undefined}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-bold ${current ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-800"}`}>
      {current && <span aria-hidden>✓</span>}{s.first_name}{current && <span className="sr-only"> (seleccionado)</span>}</Link></li>;
  })}</ul></nav>;
}

export function ViewTabs({ items, current, label }: { items: [string, string, string][]; current: string; label: string }) {
  return <nav aria-label={label}><ul className="grid grid-flow-col gap-1 rounded-2xl bg-slate-100 p-1">{items.map(([key, text, href]) => <li key={key}>
    <Link href={href} aria-current={key === current ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-bold ${key === current ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}>{text}</Link></li>)}</ul></nav>;
}

export function SectionHeader({ id, title, href, linkLabel }: { id: string; title: string; href?: string; linkLabel?: string }) {
  return <div className="flex items-end justify-between gap-3"><h2 id={id} className="text-lg font-black">{title}</h2>{href && <Link href={href} className="inline-flex min-h-11 items-center font-bold text-blue-800 underline-offset-4 hover:underline">{linkLabel}</Link>}</div>;
}

export { formatTime };
