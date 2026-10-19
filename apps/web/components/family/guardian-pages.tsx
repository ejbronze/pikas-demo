import Link from "next/link";
import type { GuardianOverview, StudentActivity } from "../../lib/family/contracts";
import { guardianScenarios, type GuardianScenario } from "../../lib/family/demo-scenarios";
import { ErrorState, EmptyState } from "../state-panels";
import { DemoScenarioPicker } from "./demo-scenario-picker";
import { ActivityList, BalanceHero, ChildCard, ChildSwitcher, ControlsPanel, Markers, PurchaseCard, PurchaseList, SectionHeader, ViewTabs } from "./family-ui";

// Parent (guardian) experience. Child-centric; each wallet belongs to one student and is never
// summed. Limits and restrictions are read-only (school-managed). No Recargar until PIKAS-managed
// replenishment exists. Today the data is a demo scenario; nothing here reads real records.
type Read = { kind: "ready"; value: GuardianOverview } | { kind: "unavailable" };
const Failure = () => <ErrorState title="No pudimos cargar la información de tus estudiantes." description="Inténtalo de nuevo en unos minutos." retryHref="/familias" />;

function Demo({ scenario }: { scenario: GuardianScenario }) { return <DemoScenarioPicker options={guardianScenarios} current={scenario} />; }

export function GuardianHome({ read, scenario }: { read: Read; scenario: GuardianScenario }) {
  return <>
    <Demo scenario={scenario} />
    {read.kind !== "ready" ? <><h1 className="sr-only">Inicio</h1><Failure /></> : <>
      <header className="mb-5"><p className="text-sm font-bold text-slate-600">Hola, {read.value.guardian.display_name.split(" ")[0]}</p>
        <h1 className="text-2xl font-black sm:text-3xl">{read.value.children.length === 1 ? "Tu estudiante" : "Tus estudiantes"}</h1></header>
      {read.value.children.length === 0 ? <EmptyState title="Tu escuela aún no vinculó estudiantes a tu cuenta." description="Cuando la escuela los vincule, aquí verás su saldo PIKAS Cash y sus compras." />
        : <div className={read.value.children.length === 1 ? "" : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"}>
          {read.value.children.map(c => <ChildCard key={c.student.student_id} student={c.student} featured={read.value.children.length === 1} href={`/familias/actividad?estudiante=${encodeURIComponent(c.student.student_id)}`} />)}
        </div>}
    </>}
  </>;
}

type View = "resumen" | "compras" | "saldo";
// The student in the URL only SELECTS among the children returned for this guardian; any other
// value is "not found" and reveals nothing. Authority always comes from the read itself.
export function GuardianActivity({ read, scenario, studentParam, viewParam }: { read: Read; scenario: GuardianScenario; studentParam?: string; viewParam?: string }) {
  if (read.kind !== "ready") return <><Demo scenario={scenario} /><h1 className="sr-only">Actividad</h1><Failure /></>;
  const children = read.value.children, available = children.filter(c => c.student.status === "active");
  if (!available.length) return <><Demo scenario={scenario} /><h1 className="mb-4 text-2xl font-black">Actividad</h1>
    <EmptyState title={children.length ? "No hay estudiantes disponibles en este momento." : "Tu escuela aún no vinculó estudiantes a tu cuenta."} /></>;
  const child: StudentActivity | undefined = studentParam ? available.find(c => c.student.student_id === studentParam) : available[0];
  const view: View = viewParam === "compras" || viewParam === "saldo" ? viewParam : "resumen";
  const href = (id: string, v: View = view) => `/familias/actividad?estudiante=${encodeURIComponent(id)}${v === "resumen" ? "" : `&vista=${v}`}`;
  if (!child) return <><Demo scenario={scenario} /><h1 className="mb-4 text-2xl font-black">Actividad</h1>
    <EmptyState title="No encontramos ese estudiante en tu cuenta." action={<Link className="btn-secondary" href="/familias">Ver tus estudiantes</Link>} /></>;
  const s = child.student, id = s.student_id;
  return <>
    <Demo scenario={scenario} />
    <div className="space-y-4">
      <ChildSwitcher students={available.map(c => c.student)} selected={id} hrefFor={sid => href(sid)} />
      <header><p className="text-sm font-bold text-slate-600">Actividad de</p><h1 className="break-words text-2xl font-black sm:text-3xl">{s.display_name}</h1>
        <p className="text-sm text-slate-600">{[s.grade, s.class_label, s.campus_name].filter(Boolean).join(" · ")}</p></header>
      <Markers student={s} />
      <ViewTabs label={`Secciones de ${s.first_name}`} current={view} items={[["resumen", "Resumen", href(id, "resumen")], ["compras", "Compras", href(id, "compras")], ["saldo", "PIKAS Cash", href(id, "saldo")]]} />
      {view === "resumen" && <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4"><BalanceHero student={s} tone="parent" whose="su" />
          <section aria-labelledby="last-purchase" className="space-y-2"><SectionHeader id="last-purchase" title="Última compra" href={href(id, "compras")} linkLabel="Ver compras" />
            {child.purchases[0] ? <PurchaseCard purchase={child.purchases[0]} whose="su" /> : <EmptyState title="Todavía no hay compras." />}</section></div>
        <div className="space-y-4"><section aria-labelledby="recent-activity" className="space-y-2"><SectionHeader id="recent-activity" title="Movimientos recientes" href={href(id, "saldo")} linkLabel="Ver todo" />
          <ActivityList activity={child.activity.slice(0, 3)} whose="el" label={`Movimientos recientes de ${s.first_name}`} /></section>
          <ControlsPanel student={s} audience="parent" /></div>
      </div>}
      {view === "compras" && <section aria-label={`Compras de ${s.first_name}`}><PurchaseList purchases={child.purchases} whose="su" /></section>}
      {view === "saldo" && <section aria-labelledby="wallet-activity" className="space-y-3"><h2 id="wallet-activity" className="text-lg font-black">Movimientos de PIKAS Cash</h2>
        {s.wallet ? <ActivityList activity={child.activity} whose="el" label={`Movimientos de PIKAS Cash de ${s.first_name}`} /> : <EmptyState title="Aún no tiene PIKAS Cash." description="Las compras en efectivo aparecen en Compras." />}</section>}
    </div>
  </>;
}

export function GuardianProfileView({ read, scenario }: { read: Read; scenario: GuardianScenario }) {
  return <>
    <Demo scenario={scenario} />
    <h1 className="mb-4 text-2xl font-black sm:text-3xl">Perfil</h1>
    {read.kind !== "ready" ? <Failure /> : <section aria-labelledby="guardian-data" className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-5">
      <h2 id="guardian-data" className="text-lg font-black">{read.value.guardian.display_name}</h2>
      <dl className="mt-4 divide-y divide-slate-100">{([["Correo", read.value.guardian.email], ["Usuario", read.value.guardian.username], ["Teléfono", read.value.guardian.phone]] as const).map(([k, v]) =>
        <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"><dt className="text-sm text-slate-600">{k}</dt><dd className="break-all font-bold">{v ?? "No registrado"}</dd></div>)}</dl>
      <p className="mt-3 text-sm text-slate-600">Para cambiar estos datos, comunícate con tu escuela.</p>
    </section>}
  </>;
}
