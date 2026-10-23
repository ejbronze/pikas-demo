import { z } from 'zod';
import { isValidUsername, normalizeUsername } from './username';
import { provisioningUsername } from './provisioning';
import type { IdentitySummary } from './contracts';

// UX 12B: one-step POS staff access for the Cafetería Admin. Shared, UI-free rules: the username
// PIKAS suggests from a name, the non-deliverable address that stands behind a username-only
// login (owner decision: email is optional for POS roles; such a person can never recover a
// password by email), and the access state read from the existing identity summary.
export const INTERNAL_EMAIL_DOMAIN = 'cajeros.pikas.invalid';
// Unique per request (not per username): the reservation rules treat "same address" as "same human",
// so a second person with the same suggested username must NOT share the address — the username
// collision is then refused by the database instead of silently linking two people. A retry of the
// same request (same key) derives the same address, so each step replays.
export const internalEmail = (username: string, requestKey: string) => `${normalizeUsername(username)}.${requestKey.replace(/-/g, '').slice(0, 8).toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;
export const isInternalEmail = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);

// «María José Pérez García» → «maria.garcia»; one word → that word; never longer than 40, never
// invalid (an empty suggestion means the admin must type one).
export function suggestUsername(name: string): string {
  const words = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return '';
  const candidate = (words.length > 1 ? `${words[0]}.${words[words.length - 1]}` : words[0]).slice(0, 40).replace(/[._-]+$/, '');
  return isValidUsername(candidate) ? candidate : '';
}

const uuid = z.uuid();
export const staffAccessRequestSchema = z.object({
  cafeteriaId: uuid,
  display_name: z.string().trim().min(1).max(200),
  email: z.email().trim().max(254).transform(v => v.toLowerCase()).nullable().optional(),
  role: z.enum(['pos_cashier', 'pos_supervisor']),
  username: provisioningUsername,
  register_id: uuid.nullable().optional(),
}).strict();
export type StaffAccessRequest = z.infer<typeof staffAccessRequestSchema>;

export const staffAccessResultSchema = z.object({
  membership_id: uuid, person_id: uuid, display_name: z.string(), username: z.string().nullable(), role: z.enum(['pos_cashier', 'pos_supervisor']),
  email_kind: z.enum(['real', 'internal']),
  // An identity that already existed and had signed in keeps its password: no temporary credential.
  existing_identity: z.boolean(), must_change_password: z.boolean(),
  register: z.object({ register_id: uuid, assigned: z.boolean() }).nullable(),
}).strict();
export const staffAccessResponseSchema = z.object({ result: staffAccessResultSchema, temporary_password: z.string().min(10).optional() }).strict();
export type StaffAccessResult = z.infer<typeof staffAccessResultSchema>;

export const staffAccessErrors: Record<string, string> = {
  sandbox_unsupported: 'En sandbox no se crean accesos POS. Usa el flujo de activación de una identidad existente.',
  cafeteria_authority_required: 'No tienes autoridad sobre esta cafetería.',
  identity_outside_customer: 'Ese correo ya tiene una identidad que no puede recibir acceso aquí (la tuya, la de otro cliente o la de PIKAS). Usa otro correo o déjalo vacío.',
  confirmed_identity_pending: 'La identidad de esa persona no está confirmada. Revisa Accesos preparados en Personal POS.',
  existing_membership_not_active: 'Esa persona ya tiene este rol en la cafetería, pero su acceso no está activo. Reactívalo con «Cambiar acceso».',
  request_key_reused: 'Esta solicitud ya se usó con otros datos. Cierra y empieza de nuevo.',
  auth_create_failed: 'No se pudo crear el inicio de sesión. Inténtalo de nuevo.',
  auth_update_failed: 'No se pudo emitir la contraseña temporal. Emítela desde Credenciales.',
  operation_uncertain: 'No pudimos confirmar el resultado. Reintenta la misma solicitud; no crees otra.',
};

export type AccessState = { label: string; tone: 'ready' | 'pending' | 'blocked' | 'off'; detail: string };
export function accessState(summary: IdentitySummary, membershipStatus: 'active' | 'suspended' | 'inactive'): AccessState {
  if (membershipStatus === 'inactive') return { label: 'Acceso retirado', tone: 'off', detail: 'Ya no tiene este rol en la cafetería.' };
  if (membershipStatus === 'suspended') return { label: 'Acceso suspendido', tone: 'blocked', detail: 'Suspendido en esta cafetería; su inicio de sesión en PIKAS no cambia.' };
  if (summary.login_suspended) return { label: 'Inicio de sesión suspendido', tone: 'blocked', detail: 'Suspendido por PIKAS; no puede entrar.' };
  if (!summary.email_confirmed) return { label: 'Pendiente de activación', tone: 'pending', detail: 'Todavía no creó su contraseña.' };
  if (summary.must_change_password && summary.temporary_expired) return { label: 'Credencial temporal vencida', tone: 'blocked', detail: 'Venció sin usarse (15 minutos). Emite otra desde Credenciales.' };
  if (summary.must_change_password) return summary.temporary_issued_at
    ? { label: 'Credencial temporal emitida', tone: 'pending', detail: 'Vale 15 minutos. Al entrar deberá crear su propia contraseña.' }
    : { label: 'Cambio de contraseña requerido', tone: 'pending', detail: 'Falta emitir la contraseña temporal.' };
  return { label: 'Acceso listo', tone: 'ready', detail: summary.last_sign_in_at ? 'Puede iniciar sesión.' : 'Puede iniciar sesión; aún no ha entrado.' };
}
