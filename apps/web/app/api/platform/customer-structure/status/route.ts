import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";
import { LIFECYCLE_MANAGE, isLifecycleAccessRejection, structureStatusRequestSchema, structureStatusResultSchema } from "../../../../../lib/platform/lifecycle-access";

// Platform-only sede / cafetería lifecycle (active · suspended · inactive). Authority, expected-state
// check, open-caja guard, journal and audit live in platform_set_customer_structure_status. Nothing is
// deleted and nothing beneath the sede or cafetería is rewritten.
export const POST = createPlatformRpcPostHandler({
  capability: LIFECYCLE_MANAGE,
  schema: structureStatusRequestSchema,
  resultSchema: structureStatusResultSchema,
  rejections: isLifecycleAccessRejection,
  invoke: (supabase, p, requestId) => supabase.rpc("platform_set_customer_structure_status", {
    p_request_id: requestId, p_account_id: p.accountId, p_kind: p.kind, p_target_id: p.targetId, p_expected_status: p.expectedStatus, p_status: p.status, p_reason: p.reason }),
});
