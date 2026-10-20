import { createPlatformRpcPostHandler } from "../../../../lib/auth/platform-rpc-route";
import { CUSTOMER_PROFILE_MANAGE, isProfileRejection, profileRequestSchema, profileResultSchema } from "../../../../lib/platform/customer-profile";

// Platform-only colegio profile edit. Authority, lifecycle, stale-edit detection, journal and audit
// live in platform_update_colegio_profile; the browser never sends codes or identities.
export const POST = createPlatformRpcPostHandler({
  capability: CUSTOMER_PROFILE_MANAGE,
  schema: profileRequestSchema,
  resultSchema: profileResultSchema,
  rejections: isProfileRejection,
  invoke: (supabase, payload, requestId) => supabase.rpc("platform_update_colegio_profile", {
    p_request_id: requestId, p_account_id: payload.accountId, p_school_id: payload.schoolId, p_expected: payload.expected,
    p_name: payload.name, p_tax_id: payload.taxId, p_address_line: payload.addressLine, p_country_code: payload.countryCode, p_subdivision_code: payload.provinceCode,
  }),
});
