import { z } from "zod";
import { DOMINICAN_REPUBLIC, provinceCodes } from "./dominican-provinces";

// Backoffice customer profile management: thin contracts over platform_update_colegio_profile and
// platform_rename_customer_structure, which own authority (platform:customer:profile:manage),
// lifecycle (active/suspended), stale-edit detection, the request journal and the audit.
export const CUSTOMER_PROFILE_MANAGE = "platform:customer:profile:manage";
export const PROFILE_EDITABLE_STATUSES = ["active", "suspended"];
const name = z.string().trim().min(1).max(200);
// Optional fields: empty clears a value; colegios provisioned before Agregar colegio may lack them.
const optional = (schema: z.ZodType<string>) => z.union([z.literal(""), schema]);
const taxId = z.string().trim().transform(v => v.replace(/[\s-]/g, "")).pipe(z.union([z.literal(""), z.string().regex(/^(\d{9}|\d{11})$/)]));
// The values the operator saw; the database rejects the edit if they changed meanwhile.
const expected = z.object({ name: z.string(), rnc: z.string().nullable(), address: z.string().nullable(), province: z.string().nullable() }).strict();
export const profileRequestSchema = z.object({
  accountId: z.guid(), schoolId: z.guid(), expected,
  name, taxId, addressLine: optional(z.string().trim().max(300)), countryCode: z.literal(DOMINICAN_REPUBLIC.code), provinceCode: optional(z.enum(provinceCodes)),
}).strict();
export type ProfileRequest = z.input<typeof profileRequestSchema>;
export const profileResultSchema = z.object({ account_id: z.guid(), school_id: z.guid(), account_renamed: z.boolean(), changed: z.array(z.string()) });
export const renameRequestSchema = z.object({ accountId: z.guid(), kind: z.enum(["location", "cafeteria"]), targetId: z.guid(), expectedName: z.string(), name }).strict();
export type RenameRequest = z.infer<typeof renameRequestSchema>;
export const renameResultSchema = z.object({ account_id: z.guid(), kind: z.enum(["location", "cafeteria"]), target_id: z.guid(), name: z.string() });
export const profileMessages: Record<string, string> = {
  invalid_customer_profile_input: "Revisa el nombre (hasta 200 caracteres), el RNC (9 u 11 dígitos) y la dirección (hasta 300 caracteres).",
  invalid_customer_structure_input: "Revisa el nombre (hasta 200 caracteres).",
  unsupported_school_region: "Selecciona una provincia de República Dominicana.",
  customer_profile_changed: "Otra persona cambió esta información mientras editabas. Cierra, revisa los datos actuales y vuelve a intentarlo.",
  customer_profile_closed: "Este cliente está cerrado: su información es solo de consulta.",
};
export const isProfileRejection = (code: unknown): code is string => typeof code === "string" && code in profileMessages;
