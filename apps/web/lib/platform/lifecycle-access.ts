import { z } from "zod";

// Lifecycle & Access Management: thin contracts over the Platform lifecycle commands (migration
// 202611160001) and the shared vocabulary. Authority, expected-state checks, journals and audit live in
// the database. Words are locked: Suspender (temporary, reversible) · Desactivar (kept, unavailable) ·
// Cerrar (ended, history read-only) · never Eliminar for records with history.
export const LIFECYCLE_MANAGE = "platform:tenant:lifecycle:manage";
const id = z.guid(), reason = z.string().trim().min(3).max(500);

export const structureStatusRequestSchema = z.object({ accountId: id, kind: z.enum(["location", "cafeteria"]), targetId: id, expectedStatus: z.string().min(1), status: z.enum(["active", "suspended", "inactive"]), reason }).strict()
  .refine(r => r.kind === "cafeteria" || r.status !== "suspended", { message: "location_status" });
export type StructureStatusRequest = z.input<typeof structureStatusRequestSchema>;
export const structureStatusResultSchema = z.object({ account_id: id, kind: z.enum(["location", "cafeteria"]), target_id: id, status: z.string(), previous_status: z.string() });

export const membershipStatusRequestSchema = z.object({ accountId: id, scope: z.enum(["cafeteria", "school"]), membershipId: id, expectedStatus: z.string().min(1), status: z.enum(["active", "suspended", "inactive"]), reason }).strict();
export type MembershipStatusRequest = z.input<typeof membershipStatusRequestSchema>;
export const membershipStatusResultSchema = z.object({ account_id: id, scope: z.string(), membership_id: id, person_id: id, role_code: z.string(), status: z.string(), previous_status: z.string() });

export const posAccessRequestSchema = z.object({ accountId: id, personId: id, cafeteriaId: id, roleCode: z.enum(["pos_cashier", "pos_supervisor"]), registerId: id.nullable().optional() }).strict();
export type PosAccessRequest = z.input<typeof posAccessRequestSchema>;
export const posAccessResultSchema = z.object({ membership_id: id, person_id: id, cafeteria_id: id, role_code: z.string(), already_granted: z.boolean(), register: z.object({ register_id: id, assigned: z.boolean() }).nullable().optional() });

export const assignmentRequestSchema = z.object({ accountId: id, cafeteriaId: id, membershipId: id, registerId: id, status: z.enum(["active", "inactive"]) }).strict();
export type AssignmentRequest = z.input<typeof assignmentRequestSchema>;
export const assignmentResultSchema = z.object({ membership_id: id, register_id: id, status: z.enum(["active", "inactive"]) });

export const lifecycleRejections = ["lifecycle_reason_required", "lifecycle_state_changed", "invalid_lifecycle_transition", "lifecycle_customer_only", "customer_lifecycle_inactive", "open_register_sessions_block_lifecycle",
  "location_inactive", "invalid_structure_status_input", "invalid_membership_status_input", "customer_provisioning_inactive", "customer_person_required", "active_confirmed_pos_identity_required",
  "existing_membership_not_active", "inactive_cafeteria", "invalid_pos_access_grant", "customer_access_scope_required", "cafeteria_state_invalid", "assignment_not_found"] as const;
export const isLifecycleAccessRejection = (code: unknown): code is string => typeof code === "string" && (lifecycleRejections as readonly string[]).includes(code);
export const lifecycleAccessMessages: Record<string, string> = {
  lifecycle_reason_required: "Indica el motivo (de 3 a 500 caracteres).",
  lifecycle_state_changed: "El estado cambió mientras revisabas. Actualiza la página para ver el estado actual.",
  invalid_lifecycle_transition: "Ese cambio no es válido para el estado actual.",
  lifecycle_customer_only: "Los entornos sandbox no tienen ciclo de vida.",
  customer_lifecycle_inactive: "El cliente está cerrado: su estructura no se cambia hasta reabrirlo desde Estado.",
  open_register_sessions_block_lifecycle: "Hay una caja con sesión abierta. Debe cerrarse en el POS antes de este cambio; así se conserva su cierre y su conciliación.",
  location_inactive: "La sede está inactiva. Reactiva la sede antes de reactivar la cafetería.",
  invalid_structure_status_input: "Revisa el estado elegido.",
  invalid_membership_status_input: "Revisa el estado elegido.",
  customer_provisioning_inactive: "Solo se cambian accesos de clientes activos o suspendidos.",
  customer_person_required: "Esta persona no pertenece solo a este cliente; no se puede modificar desde aquí.",
  active_confirmed_pos_identity_required: "La persona necesita un inicio de sesión activo y confirmado para reactivar este acceso.",
  existing_membership_not_active: "Ya tiene ese acceso, pero no está activo. Reactívalo desde sus accesos en lugar de agregarlo.",
  inactive_cafeteria: "La cafetería no está activa.",
  invalid_pos_access_grant: "Revisa la cafetería y el rol.",
  customer_access_scope_required: "Ese acceso no pertenece a este cliente.",
  cafeteria_state_invalid: "La cafetería rechazó el cambio de caja: revisa que la caja y el acceso estén activos.",
  assignment_not_found: "No encontramos esa asignación de caja; actualiza la página.",
  demo_mode_active: "Estás en modo Demo. Sal del Demo para trabajar con clientes reales. No se realizó ningún cambio.",
};

// Vocabulary and consequences, in the owner's locked words.
export const statusWord: Record<string, string> = { active: "Activa", suspended: "Suspendida", inactive: "Inactiva" };
export const membershipWord: Record<string, string> = { active: "Activo", suspended: "Suspendido", inactive: "Desactivado" };
export type StructureKind = "location" | "cafeteria";
export const structureNoun = (kind: StructureKind) => kind === "location" ? "sede" : "cafetería";
export function structureTransitions(kind: StructureKind, current: string): { status: "active" | "suspended" | "inactive"; label: string }[] {
  if (kind === "location") return current === "active" ? [{ status: "inactive", label: "Desactivar sede" }] : [{ status: "active", label: "Reactivar sede" }];
  if (current === "active") return [{ status: "suspended", label: "Suspender cafetería" }, { status: "inactive", label: "Desactivar cafetería" }];
  if (current === "suspended") return [{ status: "active", label: "Reactivar cafetería" }, { status: "inactive", label: "Desactivar cafetería" }];
  return [{ status: "active", label: "Reactivar cafetería" }];
}
// What stops, what remains, whether it is reversible, who loses access.
export function structureConsequences(kind: StructureKind, name: string, status: "active" | "suspended" | "inactive"): string[] {
  if (status === "active") return kind === "location"
    ? [`Las cafeterías de ${name} vuelven a estar disponibles con su propio estado (una cafetería desactivada sigue desactivada).`, "Nada se recrea: cajas, personal, productos e historial son los mismos."]
    : [`${name} vuelve a operar: su administración, su POS y sus cajas quedan disponibles para el personal con acceso activo.`, "Nada se recrea: cajas, personal, productos e historial son los mismos."];
  const stops = kind === "location"
    ? [`Todas las cafeterías de ${name} dejan de estar disponibles: su administración, su POS y sus cajas no pueden usarse mientras la sede esté inactiva.`]
    : [`${name} deja de estar disponible: su administración, su POS y sus cajas no pueden usarse${status === "suspended" ? " mientras esté suspendida" : ""}.`, "El personal de la cafetería pierde el acceso operativo a esta cafetería; su usuario, su inicio de sesión y sus otros accesos no cambian."];
  return [...stops,
    "Se conservan cajas, personal, productos, transacciones, reembolsos, historial de PIKAS Cash, compartición con el colegio y auditoría. Nada se elimina.",
    "Los reportes y la consulta desde PIKAS siguen disponibles como historial.",
    "Una caja con sesión abierta bloquea el cambio: debe cerrarse primero en el POS.",
    status === "suspended" ? "Es temporal y reversible desde este mismo lugar." : "Es reversible: puede reactivarse desde este mismo lugar; la sede debe estar activa para reactivar una cafetería."];
}
export function membershipTransitions(current: string): { status: "active" | "suspended" | "inactive"; label: (where: string) => string }[] {
  if (current === "active") return [{ status: "suspended", label: w => `Suspender acceso a ${w}` }, { status: "inactive", label: w => `Desactivar acceso a ${w}` }];
  if (current === "suspended") return [{ status: "active", label: w => `Reactivar acceso a ${w}` }, { status: "inactive", label: w => `Desactivar acceso a ${w}` }];
  return [{ status: "active", label: w => `Reactivar acceso a ${w}` }];
}
export function membershipConsequences(where: string, status: "active" | "suspended" | "inactive", pos: boolean): string[] {
  if (status === "active") return [`La persona recupera su acceso a ${where} con el mismo rol.`, "Requiere un inicio de sesión activo y confirmado.", "Sus cajas asignadas vuelven a estar disponibles si siguen activas."];
  return [`La persona pierde ${status === "suspended" ? "temporalmente " : ""}su acceso a ${where}${pos ? ": no podrá abrir cajas ni vender allí" : ""}.`,
    "Solo afecta este acceso: su usuario, su inicio de sesión en PIKAS y sus accesos en otros lugares no cambian.",
    "Se conservan sus asignaciones de caja, sus sesiones, sus ventas y su historial.",
    status === "suspended" ? "Es temporal y reversible desde aquí." : "La persona sigue existiendo en PIKAS; el acceso puede reactivarse desde aquí si vuelve a necesitarlo."];
}
