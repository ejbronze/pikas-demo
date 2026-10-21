import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";
import { CUSTOMER_ACCESS_PROVISION, grantCafeteriaAdminSchema, grantResultSchema, isProvisioningRejection } from "../../../../../lib/platform/customer-provisioning";

// Grant Administrador de cafetería to an existing customer Person (same Person and login).
export const POST = createPlatformRpcPostHandler({
  capability: CUSTOMER_ACCESS_PROVISION, schema: grantCafeteriaAdminSchema, resultSchema: grantResultSchema, rejections: isProvisioningRejection,
  invoke: (supabase, p, requestId) => supabase.rpc("platform_grant_cafeteria_admin", { p_request_id: requestId, p_account_id: p.accountId, p_person_id: p.personId, p_cafeteria_id: p.cafeteriaId }),
});
