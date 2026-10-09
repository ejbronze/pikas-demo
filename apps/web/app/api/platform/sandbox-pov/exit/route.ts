import { z } from "zod";
import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";

const exitSchema = z.object({}).strict();

const resultSchema = z.object({ status: z.literal("exited") });

export const POST = createPlatformRpcPostHandler({
  capability: "platform:sandbox:pov:enter",
  schema: exitSchema,
  resultSchema,
  invoke: (supabase, _payload, requestId) =>
    supabase.rpc("platform_exit_sandbox_pov", { p_request_id: requestId }),
});
