import { z } from 'zod';
import { isValidUsername, normalizeUsername, usernameRules } from './username';

// Phase 6A: username chosen at provisioning. Same normalization/rules as active identities; the
// database reserves it on the pending invitation/intent and attaches it to the Person on completion.
export const provisioningUsername = z.string().max(80).transform(normalizeUsername).refine(isValidUsername);
const messages: Record<string, string> = {
  username_unavailable: 'Ese usuario ya pertenece a otra persona o está reservado en otro acceso pendiente. Elige otro.',
  identity_has_username: 'Esta persona ya tiene otro usuario PIKAS. Usa ese mismo usuario.',
  email_has_other_username: 'Este correo tiene otro acceso pendiente con un usuario distinto. Usa el mismo usuario.',
  invalid_username: `El usuario no cumple las reglas. ${usernameRules}`,
  username_reserved: 'Ese usuario está reservado. Elige otro.',
  sandbox_username_unsupported: 'En sandbox no se reservan usuarios.',
};
export const isUsernameRejection = (code: unknown): code is string => typeof code === 'string' && code in messages;
export const usernameRejectionMessage = (code: string) => messages[code] ?? 'Ese usuario no está disponible. Elige otro.';
export type UsernameOutcome = `username:${string}`;
export const usernameOutcome = (code: string): UsernameOutcome => `username:${code}`;
export const outcomeMessage = (outcome: string) => outcome.startsWith('username:') ? usernameRejectionMessage(outcome.slice(9)) : null;
