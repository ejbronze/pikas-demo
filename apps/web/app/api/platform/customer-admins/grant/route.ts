import { z } from "zod";
import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";

const grantSchema = z.object({ intentId: z.uuid() }).strict();

const resultSchema = z.object({
  intent_id: z.uuid(),
  membership_id: z.uuid(),
  person_id: z.uuid(),
  role_code: z.enum(["account_admin", "school_admin", "cafeteria_admin"]),
  scope_kind: z.enum(["account", "school", "cafeteria"]),
  status: z.literal("granted"),
});

export const POST = createPlatformRpcPostHandler({
  capability: "platform:customer_admin:provision",
  schema: grantSchema,
  resultSchema,
  invoke: (supabase, payload, requestId) =>
    supabase.rpc("platform_grant_customer_admin", {
      p_request_id: requestId,
      p_intent_id: payload.intentId,
    }),
});
