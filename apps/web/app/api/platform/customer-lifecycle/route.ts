import { createPlatformRpcPostHandler } from "../../../../lib/auth/platform-rpc-route";
import { LIFECYCLE_MANAGE, isLifecycleRejection, lifecycleRequestSchema, lifecycleResultSchema } from "../../../../lib/platform/customer-lifecycle";

// Platform-only customer lifecycle transition. Authority, expected-state check, journal and audit
// live in platform_set_customer_lifecycle; it never touches people, memberships or money.
export const POST = createPlatformRpcPostHandler({
  capability: LIFECYCLE_MANAGE,
  schema: lifecycleRequestSchema,
  resultSchema: lifecycleResultSchema,
  rejections: isLifecycleRejection,
  invoke: (supabase, payload, requestId) => supabase.rpc("platform_set_customer_lifecycle", {
    p_request_id: requestId, p_account_id: payload.accountId, p_expected_status: payload.expectedStatus, p_action: payload.action, p_reason: payload.reason }),
});
