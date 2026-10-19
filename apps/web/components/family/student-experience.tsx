import type { StudentActivity } from "../../lib/family/contracts";
import { studentScenarios, type StudentScenario } from "../../lib/family/demo-scenarios";
import { ErrorState, EmptyState } from "../state-panels";
import { DemoScenarioPicker } from "./demo-scenario-picker";
import { ActivityList, BalanceHero, ControlsPanel, PurchaseCard, PurchaseList, SectionHeader, ViewTabs } from "./family-ui";

// Student experience: only the student's own data (self-scoped read). Read-only profile; the
// school manages limits and restrictions. Today the data is a demo scenario only.
type Read = { kind: "ready"; value: StudentActivity } | { kind: "unavailable" };
const Failure = () => <ErrorState title="No pudimos cargar tu información." description="Inténtalo de nuevo en unos minutos." retryHref="/estudiante" />;
function Demo({ scenario }: { scenario: StudentScenario }) { return <DemoScenarioPicker options={studentScenarios} current={scenario} />; }

function Notices({ value }: { value: StudentActivity }) {
  const s = value.student;
  return <>
    {s.status === "inactive" && <p role="status" className="rounded-2xl bg-slate-200 p-4 font-bold text-slate-900">Tu cuenta escolar no está activa.</p>}
    {s.status === "active" && !s.cafeteria_access && <p role="status" className="rounded-2xl bg-amber-50 p-4 font-bold text-amber-950">Tu escuela aún no habilitó compras en la cafetería.</p>}
  </>;
}

export function StudentHome({ read, scenario }: { read: Read; scenario: StudentScenario }) {
  if (read.kind !== "ready") return <><Demo scenario={scenario} /><h1 className="sr-only">Inicio</h1><Failure /></>;
  const { student: s, purchases, activity } = read.value;
  return <>
    <Demo scenario={scenario} />
    <div className="space-y-5">
      <header><p className="text-sm font-bold text-violet-800">¡Hola, {s.first_name}!</p><h1 className="break-words text-2xl font-black sm:text-3xl">{s.display_name}</h1></header>
      <Notices value={read.value} />
      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <BalanceHero student={s} tone="student" whose="tu" />
        <section aria-labelledby="last-purchase" className="space-y-2"><SectionHeader id="last-purchase" title="Tu última compra" href="/estudiante/compras" linkLabel="Ver todo" />
          {purchases[0] ? <PurchaseCard purchase={purchases[0]} whose="tu" /> : <EmptyState title="Todavía no hay compras." />}</section>
      </div>
      {s.wallet && <section aria-labelledby="recent" className="space-y-2"><SectionHeader id="recent" title="Movimientos recientes" href="/estudiante/compras?vista=saldo" linkLabel="Ver todo" />
        <ActivityList activity={activity.slice(0, 3)} whose="tu" label="Movimientos recientes de tu PIKAS Cash" /></section>}
    </div>
  </>;
}

export function StudentPurchases({ read, scenario, viewParam }: { read: Read; scenario: StudentScenario; viewParam?: string }) {
  const view = viewParam === "saldo" ? "saldo" : "compras";
  if (read.kind !== "ready") return <><Demo scenario={scenario} /><h1 className="sr-only">Compras</h1><Failure /></>;
  const { student: s, purchases, activity } = read.value;
  return <>
    <Demo scenario={scenario} />
    <div className="space-y-4">
      <h1 className="text-2xl font-black sm:text-3xl">{view === "saldo" ? "Tu PIKAS Cash" : "Tus compras"}</h1>
      <ViewTabs label="Ver" current={view} items={[["compras", "Compras", "/estudiante/compras"], ["saldo", "PIKAS Cash", "/estudiante/compras?vista=saldo"]]} />
      {view === "compras" ? <PurchaseList purchases={purchases} whose="tu" />
        : s.wallet ? <ActivityList activity={activity} whose="tu" label="Movimientos de tu PIKAS Cash" /> : <EmptyState title="Aún no tienes PIKAS Cash." description="Tu familia o escuela puede recargarlo." />}
    </div>
  </>;
}

export function StudentProfileView({ read, scenario }: { read: Read; scenario: StudentScenario }) {
  if (read.kind !== "ready") return <><Demo scenario={scenario} /><h1 className="sr-only">Perfil</h1><Failure /></>;
  const s = read.value.student;
  return <>
    <Demo scenario={scenario} />
    <div className="space-y-4">
      <h1 className="text-2xl font-black sm:text-3xl">Perfil</h1>
      <Notices value={read.value} />
      <section aria-labelledby="student-data" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 id="student-data" className="break-words text-lg font-black">{s.display_name}</h2>
        <dl className="mt-3 divide-y divide-slate-100">{([["Escuela", s.school_name], ["Campus", s.campus_name], ["Curso", s.grade], ["Sección", s.class_label]] as const).map(([k, v]) =>
          <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"><dt className="text-sm text-slate-600">{k}</dt><dd className="break-words font-bold">{v ?? "No registrado"}</dd></div>)}</dl>
      </section>
      <ControlsPanel student={s} audience="student" />
    </div>
  </>;
}
