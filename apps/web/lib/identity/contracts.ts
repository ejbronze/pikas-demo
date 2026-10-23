import { z } from 'zod';
import { isValidUsername, normalizeUsername } from './username';

// Phase 6A identity support contracts (Platform support and tenant-scoped credentials). The
// database decides scope; these schemas only shape requests and validate responses.
export const IDENTITY_SUPPORT_CAPABILITY = 'platform:identity:support';
const uuid = z.uuid(), reason = z.string().trim().min(3).max(500);
export const identityCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('lookup'), identifier: z.string().trim().min(3).max(254) }).strict(),
  z.object({ operation: z.literal('read'), person_id: uuid }).strict(),
  z.object({ operation: z.literal('read_membership'), membership_id: uuid }).strict(),
  z.object({ operation: z.literal('set_username'), person_id: uuid, username: z.string().transform(normalizeUsername).refine(isValidUsername), expected_version: z.number().int().min(1) }).strict(),
  z.object({ operation: z.literal('change_email'), person_id: uuid, email: z.email().max(254).transform(v => v.trim().toLowerCase()), reason }).strict(),
  z.object({ operation: z.literal('temporary_access'), person_id: uuid }).strict(),
  z.object({ operation: z.literal('set_suspended'), person_id: uuid, suspended: z.boolean(), reason }).strict(),
]);
export type IdentityCommand = z.infer<typeof identityCommandSchema>;
export const identitySummarySchema = z.object({
  person_id: uuid, display_name: z.string(), person_status: z.string(), username: z.string().nullable(), email: z.string().nullable(),
  email_confirmed: z.boolean(), last_sign_in_at: z.string().nullable(), must_change_password: z.boolean(), login_suspended: z.boolean(),
  temporary_issued_at: z.string().nullable(), temporary_expired: z.boolean().optional(), pending_email: z.string().nullable(), version: z.number().int(),
  memberships: z.array(z.object({ scope: z.enum(['account', 'school', 'cafeteria']), role: z.string(), status: z.string(), name: z.string() })),
  audit: z.array(z.object({ operation: z.string(), occurred_at: z.string(), actor_scope: z.enum(['platform', 'tenant', 'self']), actor_name: z.string(),
    metadata: z.record(z.string(), z.unknown()), reason: z.string().nullable() })),
  support_scope: z.enum(['platform', 'tenant']).optional(),
});
export type IdentitySummary = z.infer<typeof identitySummarySchema>;
export const identityResponseSchema = z.object({ result: identitySummarySchema.nullable(), temporary_password: z.string().min(10).optional() });

export const identityErrors: Record<string, string> = {
  demo_mode_active: 'Estás en modo Demo. Sal del Demo para gestionar identidades reales. No se realizó ningún cambio.',
  identity_support_required: 'No tienes permiso para gestionar el acceso de esta persona.',
  invalid_identifier: 'Escribe un correo o un usuario completo.',
  invalid_username: 'Ese usuario no es válido.',
  username_reserved: 'Ese usuario está reservado.',
  username_unavailable: 'Ese usuario ya pertenece a otra persona.',
  identity_version_changed: 'Los datos cambiaron mientras editabas. Revisa la información actual.',
  invalid_email: 'Ese correo no es válido.',
  email_unchanged: 'Ese ya es el correo de la cuenta.',
  email_unavailable: 'Ese correo ya pertenece a otra cuenta.',
  reason_required: 'Indica el motivo (al menos 3 caracteres).',
  email_change_unconfirmed: 'El correo no se pudo confirmar. No se realizó el cambio.',
  temporary_access_not_pending: 'El acceso temporal no está pendiente. Vuelve a emitirlo.',
  auth_update_failed: 'No se pudo actualizar la cuenta de acceso. El acceso queda bloqueado hasta emitirlo de nuevo.',
  auth_sync_unavailable: 'El estado quedó guardado en PIKAS, pero no se pudo sincronizar el inicio de sesión. Vuelve a intentarlo.',
  invalid_payload: 'Revisa los datos e inténtalo de nuevo.',
};
export const roleLabels: Record<string, string> = { account_admin: 'Administración de cuenta', school_admin: 'Administración escolar', cafeteria_admin: 'Administración de cafetería',
  pos_supervisor: 'Supervisión POS', pos_cashier: 'Caja POS' };
export const auditLabels: Record<string, string> = { username_set: 'Usuario asignado', username_changed: 'Usuario cambiado', email_change_requested: 'Cambio de correo solicitado',
  email_changed: 'Correo corregido', temporary_access_requested: 'Acceso temporal solicitado', temporary_access_issued: 'Contraseña temporal emitida',
  password_change_completed: 'Contraseña personal creada', login_suspended: 'Inicio de sesión suspendido', login_reactivated: 'Inicio de sesión reactivado' };
