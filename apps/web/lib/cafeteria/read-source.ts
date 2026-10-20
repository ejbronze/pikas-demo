import { sessionFetch } from "../auth/session-fetch";

// Where a read-only cafeteria view fetches from. Tenant screens use their own endpoints (default);
// PIKAS Backoffice Customer Management passes a Platform endpoint plus the explicit customer
// account. The server re-validates both on every call; this is transport, not authority.
export type ReadSource = { endpoint: string; accountId: string };
export function postRead(fallback: string, body: unknown, source?: ReadSource) {
  return sessionFetch(source?.endpoint ?? fallback, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(source ? { account_id: source.accountId, request: body } : body) });
}
