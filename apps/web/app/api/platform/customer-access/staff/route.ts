import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";
import { CUSTOMER_ACCESS_PROVISION, isProvisioningRejection, staffCommandSchema, staffResultSchema } from "../../../../../lib/platform/customer-provisioning";
import { isUsernameRejection } from "../../../../../lib/identity/provisioning";

// Platform completion of a pending link-based Personal de caja invitation (recovery only). The
// link-based preparation was retired (Lifecycle & Access Management); new Personal POS is created
// through the one-step flow at /api/platform/customer-access/staff-access.
export const POST = createPlatformRpcPostHandler({
  capability: CUSTOMER_ACCESS_PROVISION, schema: staffCommandSchema, resultSchema: staffResultSchema,
  rejections: (m) => isProvisioningRejection(m) || isUsernameRejection(m),
  invoke: (supabase, p, requestId) => supabase.rpc("platform_customer_staff_command",
    { p_account_id: p.accountId, p_cafeteria_id: p.cafeteriaId, p_request_id: requestId, p_operation: "staff_complete", p_payload: { invitation_id: p.invitationId, display_name: p.displayName } }),
});
