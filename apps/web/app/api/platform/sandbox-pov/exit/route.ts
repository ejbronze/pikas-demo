import { z } from "zod";
import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";

const exitSchema = z.object({}).strict();

const resultSchema = z.object({ status: z.literal("exited") });

export const POST = createPlatformRpcPostHandler({
  capability: "platform:sandbox:pov:enter",
  demo: "allow",
  schema: exitSchema,
  resultSchema,
  invoke: async (supabase, _payload, requestId) => {
    const response = await supabase.rpc("platform_exit_sandbox_pov", { p_request_id: requestId });
    if (response.error?.code === "23514") {
      const current = await supabase.rpc("platform_get_active_sandbox_pov");
      if (!current.error && current.data === null) return { data: { status: "exited" }, error: null };
    }
    return response;
  },
});
