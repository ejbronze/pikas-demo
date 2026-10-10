import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";
import { completeAdminSchema, completeAdminResultSchema } from "../../../../../lib/platform/customer-contracts";
export const POST = createPlatformRpcPostHandler({
  capability: "platform:customer_admin:provision",
  schema: completeAdminSchema,
  resultSchema: completeAdminResultSchema,
  invoke: (supabase, payload, requestId) => supabase.rpc("platform_complete_initial_customer_admin", {
    p_request_id: requestId, p_intent_id: payload.intentId, p_display_name: payload.displayName,
  }),
});
