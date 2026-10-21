import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";
import { CUSTOMER_ACCESS_PROVISION, isProvisioningRejection, renamePersonResultSchema, renamePersonSchema } from "../../../../../lib/platform/customer-provisioning";

// Correct a customer Person's display name (same Person, login, username and memberships).
export const POST = createPlatformRpcPostHandler({
  capability: CUSTOMER_ACCESS_PROVISION, schema: renamePersonSchema, resultSchema: renamePersonResultSchema, rejections: isProvisioningRejection,
  invoke: (supabase, p, requestId) => supabase.rpc("platform_rename_customer_person", { p_request_id: requestId, p_account_id: p.accountId, p_person_id: p.personId, p_expected_name: p.expectedName, p_name: p.name }),
});
