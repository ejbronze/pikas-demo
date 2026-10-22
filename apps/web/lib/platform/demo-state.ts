import type { SupabaseClient } from "@supabase/supabase-js";
import type { PikasIdentity } from "../auth/pikas-context";
import { activeSchema, canUseSandboxPov } from "./sandbox-launcher";
import type { SandboxPovCode } from "./sandbox-pov";

export type ActiveDemo = {
  sessionId: string; povCode: SandboxPovCode; accountId: string; schoolId: string; cafeteriaId: string;
  accountName: string; cafeteriaName: string; personaName: string; expiresAt: string;
};
export type DemoState = { kind: "none" } | { kind: "unknown" } | { kind: "active"; demo: ActiveDemo };

// UX 11: the operator's CURRENT Demo POV, from the authoritative server resolver
// (platform_get_active_sandbox_pov → sandbox_validated_pov: active, unexpired, persona valid, bound
// to this Auth user). Expired or exited sessions are "none". An unavailable read is "unknown": pages
// then render normally (the database still refuses real operations under a POV) and Platform
// mutations fail closed. Shared by the Platform pages and the mutation guard.
export async function readActiveDemo(supabase: Pick<SupabaseClient, "rpc">, identity: PikasIdentity): Promise<DemoState> {
  if (!canUseSandboxPov(identity)) return { kind: "none" };
  try {
    const response = await supabase.rpc("platform_get_active_sandbox_pov");
    if (response.error) return { kind: "unknown" };
    if (response.data === null) return { kind: "none" };
    const active = activeSchema.safeParse(response.data);
    if (!active.success) return { kind: "unknown" };
    const a = active.data;
    if (Date.parse(a.expires_at) <= Date.now()) return { kind: "none" };
    return { kind: "active", demo: { sessionId: a.session_id, povCode: a.pov_code, accountId: a.account_id, schoolId: a.school_id ?? "", cafeteriaId: a.cafeteria_id,
      accountName: a.account_name, cafeteriaName: a.cafeteria_name, personaName: a.persona_display_name, expiresAt: a.expires_at } };
  } catch { return { kind: "unknown" }; }
}
