import { z } from "zod";
import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";

const linkSchema = z
  .object({
    intentId: z.uuid(),
    authUserId: z.uuid(),
    displayName: z.string().trim().min(1).max(200),
  })
  .strict();

const resultSchema = z.object({
  intent_id: z.uuid(),
  person_id: z.uuid(),
  status: z.literal("linked"),
});

export const POST = createPlatformRpcPostHandler({
  capability: "platform:identity:link",
  schema: linkSchema,
  resultSchema,
  invoke: (supabase, payload, requestId) =>
    supabase.rpc("platform_link_customer_admin_identity", {
      p_request_id: requestId,
      p_intent_id: payload.intentId,
      p_auth_user_id: payload.authUserId,
      p_display_name: payload.displayName,
    }),
});
