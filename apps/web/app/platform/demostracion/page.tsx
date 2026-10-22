import { z } from "zod";
import { requirePlatform } from "@/lib/platform/customer-console";
import { loadSandboxLauncherState, targetSchema } from "@/lib/platform/sandbox-launcher";
import { DemoWorkspace } from "@/components/demo-workspace";
export default async function DemonstrationPage() {
  const { supabase, identity, capabilities } = await requirePlatform({ demo: "allow" });
  if (!capabilities.includes("platform:sandbox:pov:enter")) return <p role="alert">No tienes acceso al Demo.</p>;
  const state = await loadSandboxLauncherState(supabase, identity);
  const response = await supabase.rpc("platform_list_sandbox_pov_targets");
  const targets = z.array(targetSchema).safeParse(response.data);
  const rows = !response.error && targets.success ? targets.data : [];
  const environments = new Set(rows.map(t => `${t.account_id}:${t.cafeteria_id}`));
  const available = rows.filter(t => state.kind === "active" ? t.account_id === state.active.accountId && t.cafeteria_id === state.active.cafeteriaId : environments.size === 1).map(t => t.pov_code);
  return <><h1 className="text-2xl font-bold">Explorar PIKAS</h1><p>Entorno Demo con datos ficticios, separado de los clientes. Sigues actuando como {identity.person.displayName}, operador de PIKAS.</p><DemoWorkspace state={state} available={available} /></>;
}
