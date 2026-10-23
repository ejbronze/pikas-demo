import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";
import { CUSTOMER_ACCESS_PROVISION } from "../../../../../lib/platform/customer-provisioning";
import { isLifecycleAccessRejection, membershipStatusRequestSchema, membershipStatusResultSchema } from "../../../../../lib/platform/lifecycle-access";

// Platform support over one access of one customer person (cafetería or colegio membership):
// Suspender · Desactivar · Reactivar, always naming the scope. The global login is a different
// authority (identity support) and is never touched here.
export const POST = createPlatformRpcPostHandler({
  capability: CUSTOMER_ACCESS_PROVISION,
  schema: membershipStatusRequestSchema,
  resultSchema: membershipStatusResultSchema,
  rejections: isLifecycleAccessRejection,
  invoke: (supabase, p, requestId) => supabase.rpc("platform_set_customer_membership_status", {
    p_request_id: requestId, p_account_id: p.accountId, p_scope: p.scope, p_membership_id: p.membershipId, p_expected_status: p.expectedStatus, p_status: p.status, p_reason: p.reason }),
});
