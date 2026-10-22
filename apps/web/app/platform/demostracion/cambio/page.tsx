import Link from "next/link";
import { requirePlatform } from "@/lib/platform/customer-console";
export default async function DemoChangedPage() {
  const { capabilities } = await requirePlatform({ demo: "allow" });
  if (!capabilities.includes("platform:sandbox:pov:enter")) return <p role="alert">No tienes acceso al Demo.</p>;
  return <section className="rounded-xl border border-amber-400 bg-amber-50 p-5"><strong>DEMO</strong><h1 className="my-3 text-xl font-bold">La experiencia de demostración cambió en otra pestaña.</h1><p>Continúa para abrir la experiencia actual. No se recuperarán formularios ni operaciones anteriores.</p><Link className="btn mt-4" href="/platform/demostracion/continuar">Continuar</Link></section>;
}
