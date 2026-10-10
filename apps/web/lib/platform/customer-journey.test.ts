import { describe, expect, it, vi } from "vitest";
import { CustomerJourney, journeyStorageKey } from "./customer-journey";
import { customerDraftSchema } from "./customer-contracts";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = { accountCode: "TEST", accountName: "Cliente ficticio", schoolCode: "E", schoolName: "Escuela", businessTimezone: "America/Santo_Domingo", locationCode: "U", locationName: "Ubicación", cafeteriaCode: "C", cafeteriaName: "Cafetería", administratorName: "Administradora", administratorEmail: "admin@example.invalid" };
const tenant = { account_id: uuid(1), school_id: uuid(2), location_id: uuid(3), cafeteria_id: uuid(4) };
function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
describe("customer provisioning recovery", () => {
  it("uses existing atomic hierarchy and prepare contracts; never sends Auth or operator authority", async () => {
    const send = vi.fn().mockResolvedValueOnce({ result: tenant }).mockResolvedValueOnce({ result: { intent_id: uuid(5), status: "pending" } });
    const journal = storage(); const job = CustomerJourney.create(draft, journal, "job", send);
    const result = await job.run();
    expect(result.tenant).toEqual(tenant); expect(result.administrator?.status).toBe("pending");
    expect(send.mock.calls[0][2]).not.toHaveProperty("administratorEmail");
    expect(send.mock.calls[1][2]).toMatchObject({ accountId: uuid(1), intendedEmail: draft.administratorEmail, scopeKind: "account", roleCode: "account_admin", schoolId: null, cafeteriaId: null });
    expect(JSON.stringify(send.mock.calls)).not.toContain("authUserId"); job.finish(); expect(journal.getItem("job")).toBeNull();
  });
  it("an uncertain hierarchy response does not claim success and reuses the key after reload", async () => {
    const journal = storage(); const send = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ result: tenant }).mockResolvedValueOnce({ result: { intent_id: uuid(5), status: "pending" } });
    const job = CustomerJourney.create(draft, journal, "job", send);
    await expect(job.run()).rejects.toThrow(); expect(job.state.tenant).toBeNull();
    const restored = CustomerJourney.restore(journal, "job", send)!; await restored.run();
    expect(send.mock.calls[0][1]).toBe(send.mock.calls[1][1]); expect(restored.state.tenant).toEqual(tenant);
  });
  it("partial admin failure preserves created hierarchy and retries only prepare with its original key", async () => {
    const journal = storage(); const send = vi.fn().mockResolvedValueOnce({ result: tenant }).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ result: { intent_id: uuid(5), status: "pending" } });
    const job = CustomerJourney.create(draft, journal, "job", send);
    await expect(job.run()).rejects.toThrow(); expect(job.state.tenant).toEqual(tenant); expect(job.state.administrator).toBeNull();
    await CustomerJourney.restore(journal, "job", send)!.run();
    expect(send.mock.calls.map(([path]) => path)).toEqual(["/api/platform/tenants", "/api/platform/customer-admins/prepare", "/api/platform/customer-admins/prepare"]);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[2]);
  });
  it("prevents concurrent and replacement submissions", async () => {
    const journal = storage(); const send = vi.fn().mockImplementation(() => new Promise(() => {}));
    const job = CustomerJourney.create(draft, journal, "job", send); void job.run();
    await expect(job.run()).rejects.toThrow("busy"); expect(send).toHaveBeenCalledOnce();
    expect(() => CustomerJourney.create(draft, journal, "job", send)).toThrow("recovery_required");
  });
  it("requires recovery persistence before any write", () => {
    const send = vi.fn(); const journal = { ...storage(), setItem: () => { throw new Error("storage unavailable"); } };
    expect(() => CustomerJourney.create(draft, journal, "job", send)).toThrow(); expect(send).not.toHaveBeenCalled();
  });
  it("invalid server responses cannot claim hierarchy or admin success", async () => {
    const send = vi.fn().mockResolvedValue({ result: { success: true } }); const job = CustomerJourney.create(draft, storage(), "job", send);
    await expect(job.run()).rejects.toThrow(); expect(job.state.tenant).toBeNull(); expect(job.state.administrator).toBeNull();
  });
  it("validates required fields, email and timezone and separates operators' recovery journals", () => {
    for (const patch of [{ accountCode: " " }, { administratorEmail: "not-email" }, { businessTimezone: "invalid" }]) expect(customerDraftSchema.safeParse({ ...draft, ...patch }).success).toBe(false);
    expect(journeyStorageKey("a")).not.toBe(journeyStorageKey("b"));
  });
});
