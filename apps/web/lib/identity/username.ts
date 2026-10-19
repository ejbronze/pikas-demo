// Phase 6A PIKAS usernames. Mirrors pikas_private.normalize_username/valid_username; the database
// remains authoritative (uniqueness, reserved names). A username can never be an email.
export const USERNAME_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
export const normalizeUsername = (value: string) => value.trim().toLowerCase();
export const isValidUsername = (value: string) => value.length >= 3 && value.length <= 40 && USERNAME_PATTERN.test(value);
export const isEmailIdentifier = (value: string) => value.includes('@');
export const usernameRules = 'De 3 a 40 caracteres: letras minúsculas, números y . _ - (sin empezar ni terminar con ellos, ni repetirlos seguidos).';
