import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PikasIdentity } from "@/lib/auth/pikas-context";

export const SANDBOX_POV_CAPABILITY = "platform:sandbox:pov:enter";

const targetSchema = z.object({
  account_id: z.uuid(),
  account_name: z.string(),
  cafeteria_id: z.uuid(),
  cafeteria_name: z.string(),
  pov_code: z.literal("cashier"),
  persona_display_name: z.string(),
});

const activeSchema = z.object({
  session_id: z.uuid(),
  account_id: z.uuid(),
  account_name: z.string(),
  cafeteria_id: z.uuid(),
  cafeteria_name: z.string(),
  pov_code: z.literal("cashier"),
  persona_display_name: z.string(),
  expires_at: z.string(),
});

export type SandboxTarget = {
  accountId: string;
  accountName: string;
  cafeteriaId: string;
  cafeteriaName: string;
  personaName: string;
};

export type ActiveSandboxPov = SandboxTarget & { expiresAt: string };

export type SandboxLauncherState =
  | { kind: "hidden" }
  | { kind: "unavailable" }
  | { kind: "active"; active: ActiveSandboxPov }
  | { kind: "targets"; targets: SandboxTarget[] };

export function canUseSandboxPov(identity: PikasIdentity): boolean {
  return (
    identity.status === "ready" &&
    identity.platform !== null &&
    identity.platform.capabilities.includes(SANDBOX_POV_CAPABILITY)
  );
}

// The active demonstration is authoritative: when one exists the target list is not consulted.
export async function loadSandboxLauncherState(
  supabase: Pick<SupabaseClient, "rpc">,
  identity: PikasIdentity,
): Promise<SandboxLauncherState> {
  if (!canUseSandboxPov(identity)) return { kind: "hidden" };

  try {
    const activeResponse = await supabase.rpc("platform_get_active_sandbox_pov");
    if (activeResponse.error) return { kind: "unavailable" };
    if (activeResponse.data !== null) {
      const active = activeSchema.safeParse(activeResponse.data);
      if (!active.success) return { kind: "unavailable" };
      const a = active.data;
      return {
        kind: "active",
        active: {
          accountId: a.account_id,
          accountName: a.account_name,
          cafeteriaId: a.cafeteria_id,
          cafeteriaName: a.cafeteria_name,
          personaName: a.persona_display_name,
          expiresAt: a.expires_at,
        },
      };
    }

    const targetsResponse = await supabase.rpc("platform_list_sandbox_pov_targets");
    if (targetsResponse.error) return { kind: "unavailable" };
    const targets = z.array(targetSchema).safeParse(targetsResponse.data);
    if (!targets.success) return { kind: "unavailable" };
    return {
      kind: "targets",
      targets: targets.data.map((t) => ({
        accountId: t.account_id,
        accountName: t.account_name,
        cafeteriaId: t.cafeteria_id,
        cafeteriaName: t.cafeteria_name,
        personaName: t.persona_display_name,
      })),
    };
  } catch {
    return { kind: "unavailable" };
  }
}
