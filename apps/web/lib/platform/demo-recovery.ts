import "server-only";
import { redirect } from "next/navigation";
import { resolvePikasIdentity } from "../auth/pikas-context";
import { canUseSandboxPov } from "./sandbox-launcher";
import type { createSupabaseServerClient } from "../supabase/server";
import { organizationDenial } from "../auth/tenant-lifecycle";
// Presentation of an existing denial only. No tenant authority or POV is restored.
export async function redirectDemoDenial(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, fallback: string): Promise<never> {
  let isOperator = false;
  try { isOperator = canUseSandboxPov(await resolvePikasIdentity(client)); } catch { /* normal failure remains closed */ }
  if (isOperator) redirect("/platform/demostracion/cambio");
  // A suspended/closed organization is explained as such, never as a credentials or role problem.
  const organization = await organizationDenial(client);
  redirect(organization ? `/login?error=${organization}` : fallback);
}
