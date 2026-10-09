import { z } from "zod";
import { createPlatformRpcPostHandler } from "../../../../../lib/auth/platform-rpc-route";

const prepareSchema = z
  .object({
    accountId: z.uuid(),
    scopeKind: z.enum(["account", "school", "cafeteria"]),
    schoolId: z.uuid().nullable(),
    cafeteriaId: z.uuid().nullable(),
    roleCode: z.enum(["account_admin", "school_admin", "cafeteria_admin"]),
    intendedEmail: z
      .string()
      .trim()
      .min(3)
      .max(254)
      .refine((value) => value.indexOf("@") > 0),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    ({ scopeKind, schoolId, cafeteriaId, roleCode }) =>
      (scopeKind === "account" &&
        roleCode === "account_admin" &&
        schoolId === null &&
        cafeteriaId === null) ||
      (scopeKind === "school" &&
        roleCode === "school_admin" &&
        schoolId !== null &&
        cafeteriaId === null) ||
      (scopeKind === "cafeteria" &&
        roleCode === "cafeteria_admin" &&
        schoolId !== null &&
        cafeteriaId !== null),
  );

const resultSchema = z.object({
  intent_id: z.uuid(),
  status: z.literal("pending"),
});

export const POST = createPlatformRpcPostHandler({
  capability: "platform:customer_admin:provision",
  schema: prepareSchema,
  resultSchema,
  invoke: (supabase, payload, requestId) =>
    supabase.rpc("platform_prepare_customer_admin", {
      p_request_id: requestId,
      p_account_id: payload.accountId,
      p_scope_kind: payload.scopeKind,
      p_school_id: payload.schoolId,
      p_cafeteria_id: payload.cafeteriaId,
      p_role_code: payload.roleCode,
      p_intended_email: payload.intendedEmail,
      p_expires_at: payload.expiresAt,
    }),
});
