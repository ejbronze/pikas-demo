import { sandboxPovCodeSchema } from "../../../../../lib/platform/sandbox-pov";
import { z } from "zod";
import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";

// Only target and an allowlisted experience are supplied; the database resolves the persona.
const enterSchema = z
  .object({ accountId: z.uuid(), cafeteriaId: z.uuid(), povCode: sandboxPovCodeSchema.default("cashier") })
  .strict();

const resultSchema = z.object({
  session_id: z.uuid(),
  expires_at: z.string(),
});

export const POST = createPlatformRpcPostHandler({
  capability: "platform:sandbox:pov:enter",
  schema: enterSchema,
  resultSchema,
  invoke: (supabase, payload, requestId) =>
    supabase.rpc("platform_enter_sandbox_pov", {
      p_request_id: requestId,
      p_account_id: payload.accountId,
      p_cafeteria_id: payload.cafeteriaId,
      p_pov_code: payload.povCode,
    }),
});
