// Per-tab binding, never a credential or a journal field. Reauthentication may change this
// transport header without changing the original operation, payload or idempotency key.
let sessionId: string | null = null;
export function bindApplicationSession(value: string | null) { sessionId = value; }
export function sessionFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (!sessionId) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set("X-Pikas-Session-Id", sessionId);
  return fetch(input, { ...init, headers });
}
