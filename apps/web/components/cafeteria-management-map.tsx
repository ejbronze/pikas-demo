'use client';
import Link from 'next/link';
import type { CafeteriaRead } from '../lib/cafeteria/contracts';
import { cafeteriaHref, managedCounts, readinessLabel, type CafeteriaReadiness, type ReadinessStep } from '../lib/cafeteria/readiness';
import { studentServiceCopy } from '../lib/cafeteria/student-service';

// PIKAS UX 12A: orientation for the Cafetería Admin. The map states the inherited context
// (colegio → sede → cafetería, established by PIKAS and never editable here) and where the admin's
// own management begins (cajas, personal POS, productos). The readiness guide lists only what the
// admin controls, in management order, with one clear next step. Everything is the server read.
const stateText: Record<ReadinessStep['state'], string> = { complete: 'Completo', pending: 'Pendiente', attention: 'Requiere atención' };
const mark: Record<ReadinessStep['state'], string> = { complete: '✓', pending: '', attention: '!' };
// «Sede Santiago», not «Sede Sede Santiago»: real names often already carry their level word.
const withLevel = (level: string, name: string) => name.trim().toLocaleLowerCase('es').startsWith(level.toLocaleLowerCase('es')) ? name : `${level} ${name}`;

export function ManagementMap({ data, readiness }: { data: CafeteriaRead; readiness: CafeteriaReadiness }) {
  const s = data.scope, counts = managedCounts(data), href = (path: string) => cafeteriaHref(s.cafeteria_id, path);
  const managed = [['/cajas', 'Cajas', counts.cajas], ['/personal', 'Personal POS', counts.personal], ['/productos', 'Productos', counts.productos]] as const;
  return <section className="hoy-map" aria-labelledby="map-title">
    <div className="hoy-map-head">
      <div className="min-w-0">
        <p className="hoy-map-eyebrow">Estás administrando</p>
        <h2 id="map-title" className="font-display break-words text-2xl font-black text-[var(--primary)]">{s.cafeteria_name}</h2>
        <p className="text-sm text-slate-600">Sede: {s.location_name} · Colegio: {s.school_name}</p>
      </div>
      <span className="net-pill" data-launch={readiness.status}>{readinessLabel[readiness.status]}</span>
    </div>
    <ol className="hoy-chain" aria-label="Estructura de la cafetería">
      <li data-level="context"><span className="hoy-chain-k">Colegio</span><span className="hoy-chain-v">{s.school_name}</span></li>
      <li data-level="context"><span className="hoy-chain-k">Sede</span><span className="hoy-chain-v">{s.location_name}</span></li>
      <li data-level="here"><span className="hoy-chain-k">Cafetería</span><span className="hoy-chain-v">{s.cafeteria_name}</span></li>
      <li data-level="manage"><span className="hoy-chain-k">Tú administras</span>
        <ul className="hoy-chain-managed">{managed.map(([path, label, count]) => <li key={path}><Link href={href(path)} aria-label={`${label} de ${s.cafeteria_name}: ${count}`}><span className="hoy-chain-v num">{count}</span><span className="hoy-chain-l">{label}</span></Link></li>)}</ul></li>
    </ol>
    <p className="hoy-muted">El colegio, la sede y la cafetería los establece PIKAS; no tienes que crearlos. Dentro de {s.cafeteria_name} administras cajas, personal POS, productos y configuración operativa.</p>
  </section>;
}

export function ReadinessGuide({ data, readiness, collapsed = false }: { data: CafeteriaRead; readiness: CafeteriaReadiness; collapsed?: boolean }) {
  const { steps, status, next, complete } = readiness, s = data.scope;
  const summary = status === 'operating' ? 'Completa: la cafetería ya opera.' : status === 'ready' ? 'Lista para operar: el personal asignado puede abrir una caja desde el POS.' : next ? `Siguiente paso: ${next.label}.` : '';
  const list = <ol className="net-steps">{steps.map((step, i) => <li key={step.key} data-state={step.state} data-next={next?.key === step.key}>
    <span className="net-step-mark" aria-hidden>{mark[step.state] || i + 1}</span>
    <div className="min-w-0 flex-1"><p className="font-bold">{step.label} <span className="net-step-state">{stateText[step.state]}</span></p><p className="text-sm text-slate-700">{step.detail}</p></div>
    {step.state !== 'complete' && step.action && <Link className="net-action" href={step.action.href}>{step.action.label}<span className="sr-only"> · {step.label}</span></Link>}
  </li>)}</ol>;
  return <section id="puesta-en-marcha" aria-labelledby="readiness-title" className={`net-launch scroll-mt-24 ${status === 'operating' ? 'net-launch-done' : ''}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h2 id="readiness-title" className="font-display text-xl font-black text-[var(--primary)]">Puesta en marcha</h2><p className="text-sm text-slate-600">{summary}</p></div>
      <div className="flex flex-wrap items-center gap-2"><span className="net-pill" data-launch={status}>{readinessLabel[status]}</span>
        <span className="net-meter"><span className="net-meter-bar" aria-hidden>{steps.map(step => <i key={step.key} data-state={step.state} />)}</span><span className="net-meter-text">{complete} de {steps.length}</span></span></div>
    </div>
    <p className="hoy-readiness-context"><span className="hoy-chain-k">Contexto establecido por PIKAS</span><span><i aria-hidden>✓</i> {withLevel('Sede', s.location_name)}</span><span><i aria-hidden>✓</i> {withLevel('Cafetería', s.cafeteria_name)}</span></p>
    {collapsed ? <details className="mt-2"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold">Ver los pasos</summary>{list}</details> : list}
  </section>;
}

// Persistent location cue for every Cafetería Admin surface: inherited levels (plain text, never
// controls) and the current area. The colegio is hidden on narrow screens; the rest wraps.
export function HierarchyTrail({ levels, current }: { levels: { label: string; name: string }[]; current: string }) {
  return <nav aria-label="Ubicación en la estructura" className="hoy-trail"><ol>
    {levels.map((level, i) => <li key={level.label} data-level="context" data-compact={i === 0 ? 'hide' : undefined}><span className="hoy-trail-k">{level.label}</span><span className="hoy-trail-v">{level.name}</span></li>)}
    <li data-level="current" aria-current="page">{current}</li>
  </ol></nav>;
}

// UX 13 / 13B: student service is School-owned. With the read's student_service status (13B) the
// block shows the live operational truth for THIS cafetería; without it, only the ownership. It is
// never a Cafetería setup step and never carries a Cafetería CTA: the School completes it.
export { studentServiceCopy, type StudentServiceStatus } from '../lib/cafeteria/student-service';
export function StudentServiceNote({ data }: { data: CafeteriaRead }) {
  const s = data.scope, status = data.student_service;
  if (!status) return <section aria-labelledby="student-service-title" className="hoy-panel">
    <h2 id="student-service-title" className="hoy-h2">Servicio a estudiantes · lo administra {s.school_name}</h2>
    <p className="text-sm">Los estudiantes que el POS puede atender los comparte y habilita el colegio, no la cafetería. Si el POS no encuentra estudiantes, pide al administrador de {s.school_name} que comparta {s.cafeteria_name} y habilite estudiantes.</p>
    <p className="mt-2 text-xs text-slate-500">Esto no cambia tu Puesta en marcha: «Lista para operar» solo depende de lo que administras aquí.</p>
  </section>;
  const copy = studentServiceCopy(status, s.school_name, s.cafeteria_name);
  return <section aria-labelledby="student-service-title" className="hoy-panel hoy-service" data-tone={copy.tone}>
    <div className="hoy-panel-head"><h2 id="student-service-title" className="hoy-h2">Servicio a estudiantes</h2><span className="hoy-pill" data-state={copy.tone === 'ready' ? 'open' : copy.tone === 'off' ? 'stale' : 'closed'} role="status">{copy.label}</span></div>
    <p className="text-sm">{copy.detail}</p>
    <p className="mt-2 text-xs text-slate-500">Lo administra {s.school_name}. Esto no cambia tu Puesta en marcha: «Lista para operar» solo depende de lo que administras aquí.</p>
  </section>;
}
