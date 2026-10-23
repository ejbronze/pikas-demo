import Link from "next/link";
import { LaunchPill, StepMeter } from "./cockpit";
import { LifecycleBadge } from "../../app/platform/console-views";
import { launchStatus, nextStep, readinessSteps, type CustomerReadiness } from "../../lib/platform/readiness";
import { sectionLabel, workspaceHref, workspaceSections, type WorkspaceSection } from "../../lib/platform/workspace";

// Platform Operations & Support Console: the persistent customer context. Name first, lifecycle and
// launch status as text, the one next action, and the section navigation. It stays below the shell
// header on every section (sticky), so the operator never loses which customer they are operating.
// Codes are present for support conversations but never compete with the name.
export function CustomerContextBar({ accountId, name, code, status, kind, launch, section, available }: {
  accountId: string; name: string; code: string; status: string; kind: "customer" | "sandbox"; launch: CustomerReadiness | null; section: WorkspaceSection; available: WorkspaceSection[];
}) {
  const steps = launch ? readinessSteps(launch) : null, next = steps ? nextStep(steps) : null, launchState = launch ? launchStatus(launch, steps!) : null;
  return <div className="ws-context" data-section={section}>
    <div className="ws-context-head">
      <div className="min-w-0 flex-1 basis-64">
        <p className="ws-context-eyebrow">Cliente</p>
        <h1 className="ws-context-name">{name}</h1>
        <p className="ws-context-meta">
          <LifecycleBadge status={status} />
          <span className={`chip ${kind === "sandbox" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{kind === "sandbox" ? "Sandbox · Demostración" : "Cliente"}</span>
          {launchState && status === "active" && <LaunchPill status={launchState} lifecycle={status} />}
          {steps && status === "active" && <StepMeter steps={steps} />}
          <span className="ws-context-code">Código interno {code}</span>
        </p>
      </div>
      {next && status === "active" && launchState !== "operating" && <div className="ws-context-next">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Siguiente paso · {next.owner === "PIKAS" ? "PIKAS" : "la cafetería"}</p>
        <p className="text-sm font-bold">{next.label}</p>
        {next.action && <Link className="net-action" href={next.action.href}>{next.action.label}</Link>}
      </div>}
    </div>
    <nav aria-label="Secciones del cliente" className="ws-nav ws-context-nav"><ul>{workspaceSections.filter(([k]) => available.includes(k)).map(([key]) =>
      <li key={key}><Link href={workspaceHref(accountId, key)} aria-current={key === section ? "page" : undefined}>{sectionLabel(key)}</Link></li>)}</ul></nav>
  </div>;
}

// Inherited context above a Platform management screen: Cliente → Colegio → Sede → Cafetería → area.
// Plain text for the inherited levels (nothing here is editable), the current area in bold.
export function PlatformTrail({ accountId, levels, current }: { accountId: string; levels: { label: string; name: string }[]; current: string }) {
  return <nav aria-label="Ubicación en la estructura" className="hoy-trail ws-trail"><ol>
    {levels.map((level, i) => <li key={`${level.label}-${i}`} data-level="context" data-compact={i > 0 && i < levels.length - 1 ? "hide" : undefined}>
      <span className="hoy-trail-k">{level.label}</span>{i === 0 ? <Link className="hoy-trail-v underline" href={workspaceHref(accountId, "operacion")}>{level.name}</Link> : <span className="hoy-trail-v">{level.name}</span>}</li>)}
    <li data-level="current" aria-current="page">{current}</li>
  </ol></nav>;
}
