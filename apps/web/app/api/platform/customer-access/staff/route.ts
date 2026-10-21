import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";
import { CUSTOMER_ACCESS_PROVISION, isProvisioningRejection, staffCommandSchema, staffResultSchema } from "../../../../../lib/platform/customer-provisioning";
import { isUsernameRejection } from "../../../../../lib/identity/provisioning";

// Platform POS staff provisioning over the existing staff engine: Personal de caja (pos_cashier).
export const POST = createPlatformRpcPostHandler({
  capability: CUSTOMER_ACCESS_PROVISION, schema: staffCommandSchema, resultSchema: staffResultSchema,
  rejections: (m) => isProvisioningRejection(m) || isUsernameRejection(m),
  invoke: (supabase, p, requestId) => supabase.rpc("platform_customer_staff_command", p.operation === "staff_prepare"
    ? { p_account_id: p.accountId, p_cafeteria_id: p.cafeteriaId, p_request_id: requestId, p_operation: "staff_prepare", p_payload: { email: p.email, role: "pos_cashier" }, p_username: p.username, p_display_name: p.displayName }
    : { p_account_id: p.accountId, p_cafeteria_id: p.cafeteriaId, p_request_id: requestId, p_operation: "staff_complete", p_payload: { invitation_id: p.invitationId, display_name: p.displayName } }),
});
