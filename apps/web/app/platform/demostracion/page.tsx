import { requirePlatform } from "@/lib/platform/customer-console";
import { loadSandboxLauncherState } from "@/lib/platform/sandbox-launcher";
import { SandboxLauncher } from "../sandbox-launcher";
export default async function DemonstrationPage() {
  const { supabase, identity, capabilities } = await requirePlatform();
  if (!capabilities.includes("platform:sandbox:pov:enter")) return <p role="alert">No tienes acceso a las demostraciones.</p>;
  const state = await loadSandboxLauncherState(supabase, identity);
  return <><h1 className="text-2xl font-bold">Demostración</h1><p>El sandbox está separado de los clientes. Las acciones de plataforma siguen correspondiendo a tu identidad.</p><SandboxLauncher state={state} /></>;
}
