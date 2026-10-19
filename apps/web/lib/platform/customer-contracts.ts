import { provisioningUsername } from "../identity/provisioning";
import { z } from "zod";

export const lifecycleStatus = z.enum(["active", "suspended", "inactive"]);
export const statusLabel: Record<string, string> = {
  active: "Activo", suspended: "Suspendido", inactive: "Inactivo",
  pending: "Identidad pendiente", linked: "Identidad vinculada", granted: "Acceso otorgado",
  expired: "Solicitud vencida", revoked: "Solicitud revocada",
};
// Read projections accept any well-formed identifier (as other connected reads do): the database
// is authoritative, and one fixture row with a non-RFC-4122 UUID must not blank the whole list.
const entity = z.object({ id: z.guid(), name: z.string(), code: z.string(), status: lifecycleStatus });
export const customerListSchema = z.object({
  customers: z.array(entity.extend({ tenant_kind: z.enum(["customer", "sandbox"]),
    school_count: z.number().int().nonnegative(), location_count: z.number().int().nonnegative(), cafeteria_count: z.number().int().nonnegative() })),
  next_cursor: z.guid().nullable(),
});
export const customerOverviewSchema = z.object({
  account: entity,
  tenant_kind: z.enum(["customer", "sandbox"]),
  schools: z.array(entity.extend({ business_timezone: z.string(), locations: z.array(entity.extend({ cafeterias: z.array(entity) })) })),
  customer_admin_onboarding: z.array(z.object({ intent_id: z.uuid(), role: z.string(), scope: z.string(), status: z.string(), person: z.object({ id: z.guid(), display_name: z.string() }).nullable() })),
  administrators: z.array(z.object({ display_name: z.string(), status: lifecycleStatus, person_status: lifecycleStatus })),
  administrator_intents: z.array(z.object({ id: z.uuid(), email: z.string(), status: z.enum(["pending", "linked", "granted", "expired", "revoked"]),
    expires_at: z.string(), role_code: z.string(), scope_kind: z.string(), display_name: z.string().nullable() })),
});
const name = z.string().trim().min(1).max(200);
const code = z.string().trim().min(1).max(64);
export const customerDraftSchema = z.object({
  accountCode: code, accountName: name, schoolCode: code, schoolName: name,
  businessTimezone: z.string().trim().min(1).max(100).refine((value) => {
    try { new Intl.DateTimeFormat("es", { timeZone: value }); return true; } catch { return false; }
  }), locationCode: code, locationName: name, cafeteriaCode: code, cafeteriaName: name,
  administratorName: name, administratorEmail: z.email().trim().max(254),
  // Phase 6A: reserved at preparation; optional only so journeys saved before it still restore.
  administratorUsername: provisioningUsername.optional(),
}).strict();
export const provisionResultSchema = z.object({ account_id: z.uuid(), school_id: z.uuid(), location_id: z.uuid(), cafeteria_id: z.uuid() });
export const prepareResultSchema = z.object({ intent_id: z.uuid(), status: z.literal("pending") });
export const completeAdminSchema = z.object({ intentId: z.uuid(), displayName: name }).strict();
export const completeAdminResultSchema = z.object({ intent_id: z.uuid(), membership_id: z.uuid(), person_id: z.uuid(), role_code: z.literal("account_admin"), scope_kind: z.literal("account"), status: z.literal("granted") });
export type CustomerDraft = z.infer<typeof customerDraftSchema>;
export type CustomerOverview = z.infer<typeof customerOverviewSchema>;
