import { afterEach, expect, it, vi } from "vitest";
import { bindApplicationSession, sessionFetch } from "./session-fetch";
afterEach(() => { bindApplicationSession(null); vi.unstubAllGlobals(); });
it("binds transport to this tab's Auth session without changing key or payload", async () => {
 const send=vi.fn().mockResolvedValue({});vi.stubGlobal("fetch",send);
 const body=JSON.stringify({request_key:"original",payload:{unchanged:true}});
 bindApplicationSession("00000000-0000-4000-8000-000000000001");
 await sessionFetch("/api/pos",{method:"POST",headers:{"Idempotency-Key":"original"},body});
 const sent=send.mock.calls[0][1];expect(sent.body).toBe(body);expect(sent.headers.get("Idempotency-Key")).toBe("original");expect(sent.headers.get("X-Pikas-Session-Id")).toBe("00000000-0000-4000-8000-000000000001");
});
