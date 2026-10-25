import { createPlatformRpcPostHandler } from "../../../../lib/auth/platform-rpc-route";
import { SUPPORT_MANAGE, platformCommandSchema, platformResultSchema, supportRejections } from "../../../../lib/support/contracts";
// Soporte / Tickets: reply, internal note, request information, review, resolve, close, reopen. The Idempotency-Key is
// the database request key; the database re-checks authority and the ticket's status after its lock.
export const POST = createPlatformRpcPostHandler({ capability: SUPPORT_MANAGE, schema: platformCommandSchema, resultSchema: platformResultSchema,
  invoke: (client, c, key) => client.rpc("platform_support_act", { p_request_key: key, p_ticket_id: c.ticket_id, p_action: c.action, p_body: c.body || null }),
  rejections: message => !!message && supportRejections.has(message),
});
