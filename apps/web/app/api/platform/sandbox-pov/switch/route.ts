import type { NextRequest } from "next/server";
import { z } from "zod";
import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";
import { activeSchema, targetSchema } from "../../../../../lib/platform/sandbox-launcher";
import { demoExperienceSchema, demoExperiences } from "../../../../../lib/platform/demo-experiences";
import { sandboxDestination } from "../../../../../lib/platform/sandbox-pov";

// No client identity, scope or return URL. The existing RPC owns persona resolution,
// supersession, four-hour expiry, real-operator binding and audit.
const handleSwitch = createPlatformRpcPostHandler({
  capability: "platform:sandbox:pov:enter",
  demo: "allow",
  schema: z.object({ experience: demoExperienceSchema }).strict(),
  resultSchema: z.object({ destination: z.string(), session_id: z.uuid() }).strict(),
  invoke: async (supabase, payload, requestId) => {
    const denied = () => ({ data: null, error: { code: "42501" } });
    const activeResponse = await supabase.rpc("platform_get_active_sandbox_pov");
    if (activeResponse.error) return activeResponse;
    const active = activeSchema.nullable().safeParse(activeResponse.data);
    if (!active.success) return denied();
    const response = await supabase.rpc("platform_list_sandbox_pov_targets");
    if (response.error) return response;
    const targets = z.array(targetSchema).safeParse(response.data);
    if (!targets.success) return denied();
    // With no POV, exactly one registered environment must exist. With a POV,
    // both account AND cafeteria must match; never hop between customer scopes.
    const environments = new Set(targets.data.map(t => `${t.account_id}:${t.cafeteria_id}`));
    if (!active.data && environments.size !== 1) return denied();
    if (active.data && Date.parse(active.data.expires_at) <= Date.now()) return denied();
    const code = demoExperiences.find(e => e.experience === payload.experience)!.code;
    const matches = targets.data.filter(t => t.pov_code === code && (!active.data ||
      (t.account_id === active.data.account_id && t.cafeteria_id === active.data.cafeteria_id && t.school_id === active.data.school_id)));
    if (matches.length !== 1) return denied();
    const target = matches[0];
    if (code === "school_admin" && !target.school_id) return denied();
    const entered = await supabase.rpc("platform_enter_sandbox_pov", {
      p_request_id: requestId, p_account_id: target.account_id,
      p_cafeteria_id: target.cafeteria_id, p_pov_code: code,
    });
    if (entered.error) return entered;
    const result = z.object({ session_id: z.uuid() }).safeParse(entered.data);
    if (!result.success) return { data: null, error: { code: "invalid_result" } };
    return { error: null, data: { session_id: result.data.session_id,
      destination: sandboxDestination(code, target.school_id ?? "", target.cafeteria_id) } };
  },
});

export async function POST(request: NextRequest) {
  const response = await handleSwitch(request);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
