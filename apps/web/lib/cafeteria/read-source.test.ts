import { describe, expect, it, vi } from "vitest";
const fetchMock = vi.hoisted(() => vi.fn(async () => new Response("{}")));
vi.mock("../auth/session-fetch", () => ({ sessionFetch: fetchMock }));
import { postRead } from "./read-source";
describe("read source transport", () => {
  it("tenant screens keep their endpoint and exact body", async () => {
    await postRead("/api/cafeteria/reports", { cafeteria_id: "c" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/cafeteria/reports", expect.objectContaining({ body: JSON.stringify({ cafeteria_id: "c" }) }));
  });
  it("support screens wrap the same request with the explicit account", async () => {
    await postRead("/api/cafeteria/reports", { cafeteria_id: "c" }, { endpoint: "/api/platform/customer-operations/reports", accountId: "a" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/platform/customer-operations/reports", expect.objectContaining({ body: JSON.stringify({ account_id: "a", request: { cafeteria_id: "c" } }) }));
  });
});
