import Image from "next/image";
import Link from "next/link";
import { attentionItems, completeCount, customerHref, launchLabel, launchStatus, networkSummary, nextStep, readinessSteps, shortDate,
  type CustomerReadiness, type LaunchStatus, type Readiness, type Step } from "../../lib/platform/readiness";
import { statusLabel } from "../../lib/platform/customer-contracts";

// PIKAS UX 2. Presentation only: every state comes from lib/platform/readiness over the
// platform_customer_readiness facts. Status is always written as text, never color alone.
export type ActivityItem = { id: string; label: string; customer: string | null; when: string };
const stateText: Record<Step["state"], string> = { complete: "Completo", pending: "Pendiente", attention: "Requiere atención" };
const mark: Record<Step["state"], string> = { complete: "✓", pending: "", attention: "!" };

export function LaunchPill({ status, lifecycle }: { status: LaunchStatus; lifecycle: string }) {
  return <span className="net-pill" data-launch={status}>{status === "inactive" ? statusLabel[lifecycle] ?? lifecycle : launchLabel[status]}</span>;
}

// Seven segments, one per step, with the count written beside them.
export function StepMeter({ steps }: { steps: Step[] }) {
  return <span className="net-meter"><span className="net-meter-bar" aria-hidden>{steps.map(s => <i key={s.key} data-state={s.state} />)}</span>
    <span className="net-meter-text">{completeCount(steps)} de {steps.length} listos</span></span>;
}

export function PlatformCockpit({ data, activity, canAdd, demoHref }: { data: Readiness; activity: ActivityItem[] | null; canAdd: boolean; demoHref: string | null }) {
  const summary = networkSummary(data.customers), attention = attentionItems(data.customers);
  const rows = data.customers.map(c => { const steps = readinessSteps(c); return { c, steps, status: launchStatus(c, steps) }; })
    .sort((a, b) => order[a.status] - order[b.status] || a.c.name.localeCompare(b.c.name, "es"));
  return <div className="net space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><h1 className="font-display text-3xl font-black text-[var(--primary)]">Inicio</h1><p className="text-slate-600">Estado de la red PIKAS</p></div>
      <div className="flex flex-wrap gap-2">{canAdd && <Link className="btn" href="/platform/clientes/nuevo">Agregar colegio</Link>}<Link className="btn-secondary" href="/platform/clientes">Ver clientes</Link></div>
    </header>

    <section aria-label="Resumen de la red" className="net-band">
      <dl className="net-figures">
        <div><dt>Clientes activos</dt><dd className="num-display">{summary.active}</dd></div>
        <div><dt>En configuración</dt><dd className="num-display">{summary.configuring}</dd></div>
        <div><dt>Listos para operar</dt><dd className="num-display">{summary.ready}</dd></div>
        <div><dt>Operando</dt><dd className="num-display">{summary.operating}</dd></div>
      </dl>
      <p className="net-band-note">Operando: con al menos una venta real. {summary.inactive > 0 ? `${summary.inactive} ${summary.inactive === 1 ? "cliente suspendido o cerrado no se cuenta" : "clientes suspendidos o cerrados no se cuentan"}. ` : ""}Las demostraciones no se cuentan.</p>
    </section>

    {data.customers.length === 0 ? <div className="net-empty"><Image src="/brand/pikas-logo-mark-full-color.png" alt="" width={48} height={48} className="rounded-xl" />
        <div><p className="font-bold">Todavía no hay clientes en la red.</p><p className="text-sm text-slate-600">Cuando agregues el primer colegio, aquí verás su puesta en marcha y lo que necesita.</p></div></div>
      : <section aria-labelledby="net-attention" className={attention.length ? "net-attention" : "net-panel"}>
        <h2 id="net-attention" className="net-h2">{attention.length ? `Requiere atención · ${attention.length}` : "Todo en orden"}</h2>
        {attention.length === 0 ? <p className="net-calm"><span aria-hidden>✓</span> Ningún cliente activo tiene pasos de puesta en marcha pendientes.</p>
          : <ul className="net-list">{attention.map(item => <li key={item.customer.account_id} data-severity={item.severity}>
            <div className="min-w-0 flex-1"><p className="font-bold break-words">{item.customer.name}</p>
              <p className="net-issue"><span className="net-issue-tag">{item.severity === "attention" ? "Requiere atención" : "Siguiente paso"} · {item.step.label}</span> {item.step.detail}</p>
              {item.others.length > 0 && <p className="text-sm text-slate-600">También pendiente: {item.others.map(s => s.label).join(", ")}.</p>}</div>
            <Link className="net-action" href={customerHref(item.customer.account_id, "puesta-en-marcha")}>Abrir puesta en marcha<span className="sr-only"> de {item.customer.name}</span></Link></li>)}</ul>}
      </section>}

    {data.customers.length > 0 && <section aria-labelledby="net-customers" className="net-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="net-customers" className="net-h2">Clientes</h2><Link className="net-action" href="/platform/clientes">Buscar y filtrar</Link></div>
      <ul className="net-rows">{rows.map(({ c, steps, status }) => { const next = nextStep(steps); return <li key={c.account_id}>
        <div className="min-w-0 flex-1"><Link className="font-bold break-words text-[var(--primary)] hover:underline" href={customerHref(c.account_id)}>{c.name}</Link>
          <span className="block text-xs text-slate-500">Código interno {c.code}</span></div>
        <div className="net-row-meta"><LaunchPill status={status} lifecycle={c.status} /><StepMeter steps={steps} /></div>
        <p className="net-row-next">{status === "operating" ? (c.sales.last_at ? `Última venta: ${shortDate(c.sales.last_at)}` : "") : status === "ready" ? "Esperando la primera venta" : status === "inactive" ? "Sin acciones de puesta en marcha" : next ? `Siguiente: ${next.label}` : ""}</p>
      </li>; })}</ul>
      {data.truncated && <p className="text-sm text-slate-600">Se muestran los primeros 200 clientes. Usa Clientes para buscar el resto.</p>}
    </section>}

    <div className="grid gap-5 lg:grid-cols-12">
      <section aria-labelledby="net-activity" className="net-panel lg:col-span-8"><h2 id="net-activity" className="net-h2">Actividad reciente</h2>
        {activity === null ? <p className="text-sm text-slate-600">Tu acceso no incluye el registro de actividad.</p> : activity.length === 0 ? <p className="text-sm text-slate-600">Todavía no hay actividad registrada.</p>
          : <ul className="net-activity">{activity.map(a => <li key={a.id}><span className="min-w-0 break-words">{a.label}{a.customer ? <span className="text-slate-600"> · {a.customer}</span> : null}</span><time className="text-sm text-slate-500">{a.when}</time></li>)}</ul>}
      </section>
      <section aria-labelledby="net-demo" className="net-panel net-demo lg:col-span-4"><h2 id="net-demo" className="net-h2">Demostración</h2>
        {data.sandbox.length === 0 ? <p className="text-sm text-slate-600">No hay entornos de demostración.</p>
          : <><ul className="space-y-1">{data.sandbox.map(s => <li key={s.account_id} className="break-words"><span className="font-semibold">{s.name}</span> <span className="chip bg-amber-100 text-amber-900">Sandbox</span></li>)}</ul>
            <p className="mt-2 text-sm text-slate-600">Separado de los clientes: no se cuenta en la red ni en sus ventas.</p></>}
        {demoHref && <Link className="net-action mt-1" href={demoHref}>Ir a Demo</Link>}
      </section>
    </div>
  </div>;
}
const order: Record<LaunchStatus, number> = { configuring: 0, ready: 1, operating: 2, inactive: 3 };

// Puesta en marcha on the customer page. Links to the existing controls; never repeats their forms.
export function LaunchChecklist({ customer }: { customer: CustomerReadiness }) {
  const steps = readinessSteps(customer), status = launchStatus(customer, steps), next = nextStep(steps);
  const done = status === "operating" && steps.every(s => s.state === "complete");
  const list = <ol className="net-steps">{steps.map((s, i) => <li key={s.key} data-state={s.state} data-next={next?.key === s.key && status !== "inactive"}>
    <span className="net-step-mark" aria-hidden>{mark[s.state] || i + 1}</span>
    <div className="min-w-0 flex-1"><p className="font-bold">{s.label} <span className="net-step-state">{stateText[s.state]}</span></p><p className="text-sm text-slate-700">{s.detail}</p></div>
    {s.state !== "complete" && s.action && <Link className="net-action" href={s.action.href}>{s.action.label}<span className="sr-only"> · {s.label}</span></Link>}
  </li>)}</ol>;
  return <section id="puesta-en-marcha" aria-labelledby="launch-title" className={`net-launch scroll-mt-24 ${done ? "net-launch-done" : ""}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h2 id="launch-title" className="font-display text-xl font-black text-[var(--primary)]">Puesta en marcha</h2>
        <p className="text-sm text-slate-600">{done ? `Completa. Primera venta el ${shortDate(customer.sales.first_at!)}.` : status === "inactive" ? "El cliente no está activo: la puesta en marcha queda en pausa." : status === "ready" ? "Todo listo: falta la primera venta real." : next ? `Siguiente paso: ${next.label}.` : ""}</p></div>
      <div className="flex flex-wrap items-center gap-2"><LaunchPill status={status} lifecycle={customer.status} /><StepMeter steps={steps} /></div>
    </div>
    {done ? <details className="mt-2"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold">Ver los pasos</summary>{list}</details> : list}
  </section>;
}
