import { createPlatformRpcPostHandler } from "../../../../lib/auth/platform-rpc-route";
import { ADD_LOCATION_CAPABILITY, addLocationRequestSchema, addLocationResultSchema, isAddLocationRejection } from "../../../../lib/platform/school-location";

// Platform-only: adds one school location + its cafeteria to an EXISTING active customer school by
// calling the existing platform_add_school_location command (authority, journal, atomicity, audit).
// The only application-layer guard is that the target is a customer (never the sandbox) and that the
// school belongs to that account, read through the existing Platform overview.
export const POST = createPlatformRpcPostHandler({
  capability: ADD_LOCATION_CAPABILITY,
  schema: addLocationRequestSchema,
  resultSchema: addLocationResultSchema,
  rejections: isAddLocationRejection,
  invoke: async (supabase, payload, requestId) => {
    const overview = await supabase.rpc("platform_get_customer_overview", { p_account_id: payload.accountId });
    if (overview.error) return { data: null, error: overview.error };
    const value = overview.data as { tenant_kind?: string; schools?: { id: string }[] } | null;
    if (value?.tenant_kind !== "customer") return { data: null, error: { code: "22023", message: "location_customer_only" } };
    if (!value.schools?.some((school) => school.id === payload.schoolId)) return { data: null, error: { code: "23503", message: "active_account_school_required" } };
    return supabase.rpc("platform_add_school_location", {
      p_request_id: requestId, p_account_id: payload.accountId, p_school_id: payload.schoolId,
      p_location_code: payload.locationCode ?? null, p_location_name: payload.locationName,
      p_cafeteria_code: payload.cafeteriaCode ?? null, p_cafeteria_name: payload.cafeteriaName,
    });
  },
});
