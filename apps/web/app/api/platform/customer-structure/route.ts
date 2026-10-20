import { createPlatformRpcPostHandler } from "../../../../lib/auth/platform-rpc-route";
import { CUSTOMER_PROFILE_MANAGE, isProfileRejection, renameRequestSchema, renameResultSchema } from "../../../../lib/platform/customer-profile";

// Platform-only rename of one sede or cafetería; platform_rename_customer_structure owns the rules.
export const POST = createPlatformRpcPostHandler({
  capability: CUSTOMER_PROFILE_MANAGE,
  schema: renameRequestSchema,
  resultSchema: renameResultSchema,
  rejections: isProfileRejection,
  invoke: (supabase, payload, requestId) => supabase.rpc("platform_rename_customer_structure", {
    p_request_id: requestId, p_account_id: payload.accountId, p_kind: payload.kind, p_target_id: payload.targetId,
    p_expected_name: payload.expectedName, p_name: payload.name,
  }),
});
