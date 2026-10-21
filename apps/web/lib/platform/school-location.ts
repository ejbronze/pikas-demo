import { z } from "zod";

// Platform "Agregar sede": a thin contract over public.platform_add_school_location, which owns
// authority (platform:tenant:provision), validation, the request journal, atomic creation of the
// location + its cafeteria, and the audit. Nothing here duplicates that logic.
export const ADD_LOCATION_CAPABILITY = "platform:tenant:provision";
const code = z.string().trim().min(1).max(64), name = z.string().trim().min(1).max(200);
// Codes are optional: when omitted PIKAS assigns SEDE-NN / CAF-NN in the database. The UI never sends them.
export const addLocationRequestSchema = z.object({ accountId: z.uuid(), schoolId: z.uuid(), locationCode: code.optional(), locationName: name, cafeteriaCode: code.optional(), cafeteriaName: name }).strict();
export type AddLocationRequest = z.infer<typeof addLocationRequestSchema>;
export const addLocationResultSchema = z.object({ account_id: z.uuid(), school_id: z.uuid(), location_id: z.uuid(), cafeteria_id: z.uuid(), location_code: z.string().optional(), cafeteria_code: z.string().optional() });
export const addLocationRejections = ["invalid_school_location_input", "active_account_school_required", "platform_tenant_code_conflict", "location_customer_only"] as const;
export const isAddLocationRejection = (code: unknown): code is string => typeof code === "string" && (addLocationRejections as readonly string[]).includes(code);
export const addLocationMessages: Record<string, string> = {
  invalid_school_location_input: "Revisa los nombres (hasta 200 caracteres).",
  active_account_school_required: "Solo se pueden agregar sedes a un cliente y una escuela activos.",
  platform_tenant_code_conflict: "No se pudo asignar un código único. Inténtalo de nuevo.",
  location_customer_only: "Las sedes solo se agregan a clientes; los entornos sandbox no se modifican aquí.",
};
