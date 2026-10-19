import { z } from "zod";

// Platform "Agregar sede": a thin contract over public.platform_add_school_location, which owns
// authority (platform:tenant:provision), validation, the request journal, atomic creation of the
// location + its cafeteria, and the audit. Nothing here duplicates that logic.
export const ADD_LOCATION_CAPABILITY = "platform:tenant:provision";
const code = z.string().trim().min(1).max(64), name = z.string().trim().min(1).max(200);
export const addLocationRequestSchema = z.object({ accountId: z.uuid(), schoolId: z.uuid(), locationCode: code, locationName: name, cafeteriaCode: code, cafeteriaName: name }).strict();
export type AddLocationRequest = z.infer<typeof addLocationRequestSchema>;
export const addLocationResultSchema = z.object({ account_id: z.uuid(), school_id: z.uuid(), location_id: z.uuid(), cafeteria_id: z.uuid() });
export const addLocationRejections = ["invalid_school_location_input", "active_account_school_required", "platform_tenant_code_conflict", "location_customer_only"] as const;
export const isAddLocationRejection = (code: unknown): code is string => typeof code === "string" && (addLocationRejections as readonly string[]).includes(code);
export const addLocationMessages: Record<string, string> = {
  invalid_school_location_input: "Revisa los códigos (hasta 64 caracteres) y nombres (hasta 200 caracteres).",
  active_account_school_required: "Solo se pueden agregar sedes a un cliente y una escuela activos.",
  platform_tenant_code_conflict: "Ya existe una sede con ese código en esta escuela o una cafetería con ese código en la sede. Usa códigos distintos.",
  location_customer_only: "Las sedes solo se agregan a clientes; los entornos sandbox no se modifican aquí.",
};
