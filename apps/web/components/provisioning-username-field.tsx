'use client';
import { isValidUsername, normalizeUsername, usernameRules } from '../lib/identity/username';

// Phase 6A: the username chosen at provisioning. It is reserved while the access is pending and
// becomes the person's username on completion; they then sign in with it or with their email.
export const usernameProblem = (value: string) => { const v = normalizeUsername(value); return !v ? 'Escribe el usuario.' : isValidUsername(v) ? null : 'Ese usuario no cumple las reglas.'; };
export function ProvisioningUsernameField({ value, onChange, name, autoFocus = false }: { value?: string; onChange?: (value: string) => void; name?: string; autoFocus?: boolean }) {
  const problem = value !== undefined && value.trim() ? usernameProblem(value) : null;
  return <label className="block font-bold">Usuario PIKAS *
    <input className="field mt-1 w-full" name={name} value={value} onChange={onChange && (e => onChange(e.target.value))} required minLength={3} maxLength={40} pattern="\s*[A-Za-z0-9]+([._\-][A-Za-z0-9]+)*\s*" title="Letras, números y . _ - (sin empezar ni terminar con ellos)" autoCapitalize="none" spellCheck={false} autoComplete="off" data-autofocus={autoFocus || undefined} aria-describedby="provisioning-username-rules" />
    <span id="provisioning-username-rules" className="mt-1 block text-sm font-normal text-slate-600">{usernameRules} Queda reservado mientras el acceso está pendiente; después podrá entrar con el usuario o con su correo.</span>
    {problem && <span role="alert" className="mt-1 block text-sm font-normal text-red-800">{problem}</span>}
  </label>;
}
