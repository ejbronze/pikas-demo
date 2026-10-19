import { randomInt } from 'node:crypto';
// Phase 6A temporary passwords: 14 characters from an unambiguous alphabet, cryptographically random.
// Generated per issuance on the server and never logged, stored or audited.
const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const temporaryPassword = () => Array.from({ length: 14 }, () => alphabet[randomInt(alphabet.length)]).join('');
