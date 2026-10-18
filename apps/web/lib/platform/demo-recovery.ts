import "server-only";
import { redirect } from "next/navigation";
import { resolvePikasIdentity } from "../auth/pikas-context";
import { canUseSandboxPov } from "./sandbox-launcher";
import type { createSupabaseServerClient } from "../supabase/server";
// Presentation of an existing denial only. No tenant authority or POV is restored.
export async function redirectDemoDenial(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, fallback: string): Promise<never> {
  let isOperator = false;
  try { isOperator = canUseSandboxPov(await resolvePikasIdentity(client)); } catch { /* normal failure remains closed */ }
  redirect(isOperator ? "/platform/demostracion/cambio" : fallback);
}
