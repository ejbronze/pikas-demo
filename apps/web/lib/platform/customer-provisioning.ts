import { z } from "zod";

// Platform customer provisioning: thin contracts over the provisioning commands, which own the
// authority (platform:customer:access:provision), customer scope, lifecycle, journals and audit.
export const CUSTOMER_ACCESS_PROVISION = "platform:customer:access:provision";
const id = z.guid(), personName = z.string().trim().min(1).max(200);
export const grantCafeteriaAdminSchema = z.object({ accountId: id, personId: id, cafeteriaId: id }).strict();
export const grantResultSchema = z.object({ membership_id: id, person_id: id, cafeteria_id: id, already_granted: z.boolean() });
// Platform provisions Personal de caja only (canonical role pos_cashier). Lifecycle & Access Management:
// the link-based staff_prepare operation was retired from this contract (no runtime caller since the
// one-step flow, lib/identity/staff-access-flow); staff_complete stays to finish pending link invitations.
export const staffCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("staff_complete"), accountId: id, cafeteriaId: id, invitationId: id, displayName: personName }).strict(),
]);
export type StaffCommand = z.input<typeof staffCommandSchema>;
export const staffResultSchema = z.object({ request_id: z.guid(), operation: z.enum(["staff_prepare", "staff_complete"]), target_id: z.guid().nullable() }).loose();
export const renamePersonSchema = z.object({ accountId: id, personId: id, expectedName: z.string(), name: personName }).strict();
export const renamePersonResultSchema = z.object({ person_id: id, display_name: z.string() });
export const staffActivationSchema = z.object({ accountId: id, cafeteriaId: id, invitationId: id }).strict();
export const provisioningMessages: Record<string, string> = {
  "demo_mode_active": "Estás en modo Demo. Sal del Demo para trabajar con clientes reales. No se realizó ningún cambio.",
  customer_person_required: "Esta persona no pertenece solo a este cliente; no se puede modificar desde aquí.",
  active_confirmed_pos_identity_required: "La persona debe tener un inicio de sesión activo y confirmado antes de recibir este acceso.",
  existing_membership_not_active: "Ya tiene ese acceso, pero inactivo. Reactivarlo no forma parte de esta acción.",
  customer_provisioning_inactive: "Solo se puede dar acceso nuevo a clientes activos.",
  inactive_cafeteria: "La cafetería no está activa.",
  invalid_customer_staff_input: "Revisa el nombre, el correo y el usuario.",
  customer_person_changed: "El nombre cambió mientras editabas. Cierra, revisa el nombre actual y vuelve a intentarlo.",
  invalid_customer_person_name: "Escribe un nombre de hasta 200 caracteres.",
  confirmed_identity_pending: "La persona aún no ha guardado su contraseña con el enlace de activación.",
};
export const isProvisioningRejection = (code: unknown): code is string => typeof code === "string" && code in provisioningMessages;
