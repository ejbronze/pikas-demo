import { sandboxPovCodeSchema, sandboxDestination, type SandboxPovCode } from "./sandbox-pov";
import { schoolContextSchema } from "../school/contracts";
import { contextSchema as cafeteriaContextSchema } from "../cafeteria/contracts";
import { posAccessContextSchema } from "../pos/access-context";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PikasIdentity } from "@/lib/auth/pikas-context";

export const SANDBOX_POV_CAPABILITY = "platform:sandbox:pov:enter";

export const targetSchema = z.object({
  school_id: z.uuid().optional(),
  account_id: z.uuid(),
  account_name: z.string(),
  cafeteria_id: z.uuid(),
  cafeteria_name: z.string(),
  pov_code: sandboxPovCodeSchema,
  persona_display_name: z.string(),
});

export const activeSchema = z.object({
  session_id: z.uuid(),
  school_id: z.uuid().optional(),
  account_id: z.uuid(),
  account_name: z.string(),
  cafeteria_id: z.uuid(),
  cafeteria_name: z.string(),
  pov_code: sandboxPovCodeSchema,
  persona_display_name: z.string(),
  operator_name: z.string().optional(),
  expires_at: z.iso.datetime({ offset: true }),
});

export type SandboxTarget = {
  povCode: SandboxPovCode;
  schoolId: string;
  accountId: string;
  accountName: string;
  cafeteriaId: string;
  cafeteriaName: string;
  personaName: string;
};

export type ActiveSandboxPov = SandboxTarget & { sessionId: string; expiresAt: string; canOpenPos: boolean; canOpenExperience: boolean; destination: string; operatorName: string };

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
      if (Date.parse(a.expires_at) <= Date.now()) return { kind: "unavailable" };
      let canOpenExperience = false;
      if (a.pov_code === "cashier") {
        const pos = await supabase.rpc("get_pos_access_context");
        const context = posAccessContextSchema.safeParse(pos.data);
        canOpenExperience = !pos.error && context.success && context.data.pov?.session_id === a.session_id &&
          Date.parse(context.data.pov!.expires_at) > Date.now() && context.data.memberships.length === 1 &&
          context.data.memberships[0].account_id === a.account_id && context.data.memberships[0].cafeteria_id === a.cafeteria_id;
      } else if (a.pov_code === "school_admin") {
        const response = await supabase.rpc("get_school_admin_context");
        const context = schoolContextSchema.safeParse(response.data);
        canOpenExperience = !response.error && context.success && context.data.pov?.session_id === a.session_id &&
          context.data.pov.pov_code === a.pov_code && Date.parse(context.data.pov.expires_at) > Date.now() &&
          context.data.schools.length === 1 && context.data.schools[0].school_id === a.school_id &&
          context.data.schools[0].account_id === a.account_id;
      } else {
        const response = await supabase.rpc("get_cafeteria_admin_context");
        const context = cafeteriaContextSchema.safeParse(response.data);
        canOpenExperience = !response.error && context.success && context.data.pov?.session_id === a.session_id &&
          context.data.pov.pov_code === a.pov_code && Date.parse(context.data.pov.expires_at) > Date.now() &&
          context.data.cafeterias.length === 1 && context.data.cafeterias[0].cafeteria_id === a.cafeteria_id;
      }

      return {
        kind: "active",
        active: {
          sessionId: a.session_id,
          povCode: a.pov_code,
          schoolId: a.school_id ?? "",
          accountId: a.account_id,
          accountName: a.account_name,
          cafeteriaId: a.cafeteria_id,
          cafeteriaName: a.cafeteria_name,
          personaName: a.persona_display_name,
          expiresAt: a.expires_at,
          canOpenPos: a.pov_code === "cashier" && canOpenExperience,
          canOpenExperience,
          destination: sandboxDestination(a.pov_code, a.school_id ?? "", a.cafeteria_id),
          operatorName: a.operator_name ?? (identity.status === "ready" ? identity.person.displayName : ""),
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
        povCode: t.pov_code,
        schoolId: t.school_id ?? "",
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
