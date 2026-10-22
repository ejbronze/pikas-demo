import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePikasIdentity, type PikasIdentity } from "@/lib/auth/pikas-context";
import { readActiveDemo } from "../platform/demo-state";

// UX 11: Demo and real Platform operations are mutually exclusive. A real Platform mutation is
// refused, before anything runs, while the signed-in operator has a CURRENT Demo POV (the same
// authoritative server state the Platform pages use). Expired or exited Demo history and other
// operators' POVs never block. When the Demo state cannot be established the mutation fails closed.
// Tenant users (no Platform context) are never affected. This grants nothing: it only withholds.
export type DemoMutationBlock = { error: "demo_mode_active"; status: 403 } | { error: "authorization_unavailable"; status: 503 };
export const DEMO_MODE_ACTIVE = "demo_mode_active";

export async function demoMutationBlock(supabase: Pick<SupabaseClient, "rpc" | "auth" | "from">, identity?: PikasIdentity): Promise<DemoMutationBlock | null> {
  let resolved = identity;
  if (!resolved) {
    try { resolved = await resolvePikasIdentity(supabase as SupabaseClient); } catch { return { error: "authorization_unavailable", status: 503 }; }
  }
  if (resolved.status !== "ready" || !resolved.platform) return null;
  const state = await readActiveDemo(supabase, resolved);
  if (state.kind === "active") return { error: DEMO_MODE_ACTIVE, status: 403 };
  if (state.kind === "unknown") return { error: "authorization_unavailable", status: 503 };
  return null;
}
