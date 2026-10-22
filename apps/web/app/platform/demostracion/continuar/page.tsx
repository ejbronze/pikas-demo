import { redirect } from "next/navigation";
import { requirePlatform } from "@/lib/platform/customer-console";
import { loadSandboxLauncherState } from "@/lib/platform/sandbox-launcher";
export default async function ContinueDemoPage() {
  const { supabase, identity } = await requirePlatform({ demo: "allow" });
  const state = await loadSandboxLauncherState(supabase, identity);
  redirect(state.kind === "active" && state.active.canOpenExperience ? state.active.destination : "/platform/demostracion");
}
