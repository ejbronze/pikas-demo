import { z } from "zod";

// Backoffice "Usuarios y accesos": contract over platform_customer_access_read, which owns
// authority (platform:customer:access:read), customer scope and the read-only assembly. Labels and
// statuses are derived here from the returned membership/login data; nothing is stored.
export const CUSTOMER_ACCESS_READ = "platform:customer:access:read";
const id = z.guid(), when = z.string().nullable();
const register = z.object({ register_id: id, name: z.string(), code: z.string(), register_status: z.string(), assignment_status: z.string() });
const grant = z.object({ membership_id: id, scope: z.enum(["account", "school", "cafeteria"]), role_code: z.string(), status: z.string(), created_at: when, updated_at: when,
  school_id: id.nullable(), school_name: z.string().nullable(), cafeteria_id: id.nullable(), cafeteria_name: z.string().nullable(), location_name: z.string().nullable(), registers: z.array(register) });
const person = z.object({ person_id: id, display_name: z.string(), person_status: z.string(), created_at: when, has_login: z.boolean(), username: z.string().nullable(), email: z.string().nullable(),
  phone: z.string().nullable(), email_confirmed: z.boolean(), last_sign_in_at: when, must_change_password: z.boolean(), login_suspended: z.boolean(), email_change_pending: z.boolean(),
  temporary_issued_at: when, grants: z.array(grant) });
const pending = z.object({ kind: z.enum(["initial_admin", "invitation"]), request_id: id, role_code: z.string(), scope: z.string(), status: z.string(), email: z.string(), username: z.string().nullable(),
  school_name: z.string().nullable(), cafeteria_name: z.string().nullable(), created_at: when, expires_at: when, request_expired: z.boolean(), identity_state: z.string().nullable(), link_state: z.string().nullable() });
export const customerAccessSchema = z.object({ account_id: id, people: z.array(person), pending: z.array(pending) });
export type CustomerAccess = z.infer<typeof customerAccessSchema>;
export type AccessPerson = CustomerAccess["people"][number];
export type AccessGrant = AccessPerson["grants"][number];
export type PendingAccess = CustomerAccess["pending"][number];

const roleLabels: Record<string, string> = {
  account_admin: "Administrador del colegio", school_admin: "Administrador escolar", cafeteria_admin: "Administrador de cafetería",
  pos_supervisor: "Operador de caja · Supervisor", pos_cashier: "Operador de caja · Cajero", pos_operator: "Operador de caja",
};
export const roleLabel = (role: string) => roleLabels[role] ?? role;
// Cafetería roles name their cafetería; school roles their colegio. Account roles stand alone.
export const grantLabel = (g: Pick<AccessGrant, "role_code" | "scope" | "school_name" | "cafeteria_name">) =>
  g.scope === "cafeteria" && g.cafeteria_name ? `${roleLabel(g.role_code)} · ${g.cafeteria_name}` : g.scope === "school" && g.school_name ? `${roleLabel(g.role_code)} · ${g.school_name}` : roleLabel(g.role_code);
const statusLabels: Record<string, string> = { active: "Activo", suspended: "Suspendido", inactive: "Inactivo" };
export const membershipStatusLabel = (s: string) => statusLabels[s] ?? s;
// Access: the Person must be active; then any active grant gives access.
export function accessStatus(p: Pick<AccessPerson, "person_status" | "grants">): "Activo" | "Suspendido" | "Inactivo" {
  if (p.person_status !== "active") return p.person_status === "suspended" ? "Suspendido" : "Inactivo";
  if (p.grants.some(g => g.status === "active")) return "Activo";
  return p.grants.some(g => g.status === "suspended") ? "Suspendido" : "Inactivo";
}
// Login: only states the data supports, most restrictive first.
export function loginStatus(p: Pick<AccessPerson, "has_login" | "login_suspended" | "must_change_password" | "last_sign_in_at">) {
  if (!p.has_login) return "Sin inicio de sesión";
  if (p.login_suspended) return "Inicio de sesión suspendido";
  if (p.must_change_password) return "Cambio de contraseña pendiente";
  if (!p.last_sign_in_at) return "Nunca ha iniciado sesión";
  return "Activo";
}
export function pendingStatus(p: Pick<PendingAccess, "request_expired" | "identity_state" | "kind">) {
  if (p.request_expired) return "Solicitud vencida";
  if (p.identity_state === "ready") return "Contraseña guardada";
  if (p.identity_state === "unavailable") return "Requiere revisión";
  if (p.identity_state === "missing" || p.identity_state === "activation_pending") return "Pendiente de activación";
  return p.kind === "invitation" ? "Invitación pendiente" : "Pendiente de activación";
}
const linkLabels: Record<string, string> = { active: "Enlace activo", expired: "Enlace vencido", replaced: "Enlace reemplazado", none: "Sin enlace generado" };
export const linkStatus = (s: string | null) => (s ? linkLabels[s] ?? null : null);
export const supportDate = (v: string | null) => v ? new Date(v).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", day: "numeric", month: "short", year: "numeric" }) : null;
