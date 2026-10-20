import "server-only";
import { resolvePikasIdentity } from "../auth/pikas-context";
import { createSupabaseServerClient } from "../supabase/server";
import { CUSTOMER_OPERATIONS_READ } from "./customer-operations";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
export const supportJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
// Platform customer-operations READ routes: same-origin, authenticated PIKAS employee holding
// platform:customer:operations:read. The database re-validates actor, capability and customer scope.
export async function supportReader(request: Request): Promise<{ client: Client } | { response: Response }> {
  let origin = "";
  try { origin = new URL(request.headers.get("origin") ?? "").origin; } catch { origin = ""; }
  if (origin !== new URL(request.url).origin) return { response: supportJson({ error: "same_origin_required" }, 403) };
  try {
    const client = await createSupabaseServerClient(), identity = await resolvePikasIdentity(client);
    if (identity.status === "unauthenticated") return { response: supportJson({ error: "authentication_required" }, 401) };
    if (identity.status !== "ready" || !identity.platform?.capabilities.includes(CUSTOMER_OPERATIONS_READ)) return { response: supportJson({ error: "customer_operations_authority_required" }, 403) };
    return { client };
  } catch { return { response: supportJson({ error: "authorization_unavailable" }, 503) }; }
}
// Database authority/scope refusals never reveal whether the customer or cafeteria exists.
export const supportRpcFailure = (error: { code?: string; message?: string }, known: Record<string, string>) =>
  error.code === "42501" ? supportJson({ error: "customer_operations_scope_required" }, 403)
    : error.code === "22023" && error.message && error.message in known ? supportJson({ error: error.message }, 422)
    : supportJson({ error: "support_read_unavailable" }, 502);
