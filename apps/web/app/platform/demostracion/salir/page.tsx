import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePlatform } from "@/lib/platform/customer-console";
import { DEMO_HOME, platformReturnTarget } from "../../../../lib/platform/demo-mode";
import { experienceLabel } from "../../../../lib/platform/sandbox-pov";
import { DemoExitContinue } from "./demo-exit-continue";

// UX 11 Demo conflict screen: a real Platform route was requested while a Demo POV is current. The
// operator exits the Demo (the same authoritative exit) and continues to the validated route, or
// returns to the Demo. Without a current Demo there is no conflict: continue at once.
export default async function DemoConflictPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { demo } = await requirePlatform({ demo: "allow" });
  const next = platformReturnTarget((await searchParams).next);
  if (!demo) redirect(next);
  return <section aria-labelledby="demo-conflict-title" className="card max-w-2xl space-y-4 border-amber-300 p-6">
    <p role="status" className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-950"><span aria-hidden>●</span>Demo activo · {experienceLabel[demo.povCode]} · {demo.accountName}</p>
    <h1 id="demo-conflict-title" className="text-2xl font-black sm:text-3xl">Estás en modo Demo</h1>
    <p>Sal del Demo para trabajar con clientes reales. La operación real no está disponible mientras el Demo esté activo; los datos del Demo son ficticios.</p>
    <div className="flex flex-col gap-2 sm:flex-row">
      <DemoExitContinue next={next} />
      <Link className="btn-secondary" href={DEMO_HOME}>Volver al Demo</Link>
    </div>
  </section>;
}
