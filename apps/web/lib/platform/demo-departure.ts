import { sessionFetch } from "../auth/session-fetch";
import type { DemoExperience } from "./demo-experiences";
import { PLATFORM_HOME } from "./demo-mode";
// Existing POS recovery journals are evidence, never Demo navigation state.
// Outside the mounted POS controller, even a saved confirmed receipt must be
// reconciled there before Demo controls can discard its tracking information.
export function hasDemoFinancialJournal(storage?: Pick<Storage, "getItem">): boolean {
  try {
    const journalStorage = storage ?? window.sessionStorage;
    return Boolean(journalStorage.getItem("pikas:connected-pos:pending:v1") || journalStorage.getItem("pikas:connected-pos:register:v1"));
  } catch { return true; }
}

export type DemoDeparture = { experience?: DemoExperience; key: string };
// The one Demo exit/switch request (UX 11): the same authoritative API, the same idempotent key.
// Exit lands on the real Platform home; a switch lands where the server says. Anything else throws
// and nothing navigates. On uncertain transport the caller may retry exactly the same attempt.
export async function requestDemoDeparture(attempt: DemoDeparture, transport: typeof fetch = sessionFetch): Promise<{ destination: string; sessionId: string | null }> {
  const response = await transport(`/api/platform/sandbox-pov/${attempt.experience ? "switch" : "exit"}`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key },
    body: JSON.stringify(attempt.experience ? { experience: attempt.experience } : {}),
  });
  if (!response.ok) throw Error("unconfirmed");
  const body = await response.json();
  const destination = attempt.experience ? body.result?.destination : PLATFORM_HOME;
  if (typeof destination !== "string" || !/^\/(admin\/(escuela|cafeteria)\?|pos$|platform$)/.test(destination)) throw Error("invalid_destination");
  return { destination, sessionId: typeof body.result?.session_id === "string" ? body.result.session_id : null };
}
