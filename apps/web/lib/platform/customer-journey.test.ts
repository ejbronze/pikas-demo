import { describe, expect, it, vi } from "vitest";
import { CustomerJourney, journeyStorageKey } from "./customer-journey";
import { schoolOnboardingDraftSchema, schoolOnboardingSchema } from "./customer-contracts";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = { schoolName: "Colegio Ficticio Atlántico", taxId: "1-01-23456-7", addressLine: "Calle Ficticia 1, Ensanche Prueba", countryCode: "DO" as const, provinceCode: "DO-25" as const,
  administratorName: "Administradora Ficticia", administratorEmail: "admin@example.invalid", administratorUsername: "admin.ficticia" };
const tenant = { account_id: uuid(1), school_id: uuid(2), location_id: uuid(3), cafeteria_id: uuid(4), school_code: "COL-0A1B2C3D4E" };
function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
describe("Agregar colegio onboarding recovery", () => {
  it("onboards the colegio without operator codes, then prepares its administrator; never sends Auth or operator authority", async () => {
    const send = vi.fn().mockResolvedValueOnce({ result: tenant }).mockResolvedValueOnce({ result: { intent_id: uuid(5), status: "pending" } });
    const journal = storage(); const job = CustomerJourney.create(draft, journal, "job", send);
    const result = await job.run();
    expect(result.tenant).toEqual(tenant); expect(result.administrator?.status).toBe("pending");
    expect(send.mock.calls[0][0]).toBe("/api/platform/schools/onboard");
    expect(send.mock.calls[0][2]).toEqual({ schoolName: draft.schoolName, taxId: "101234567", addressLine: draft.addressLine, countryCode: "DO", provinceCode: "DO-25" });
    expect(send.mock.calls[1][2]).toMatchObject({ accountId: uuid(1), intendedEmail: draft.administratorEmail, intendedUsername: "admin.ficticia", scopeKind: "account", roleCode: "account_admin", schoolId: null, cafeteriaId: null });
    expect(JSON.stringify(send.mock.calls)).not.toContain("authUserId"); job.finish(); expect(journal.getItem("job")).toBeNull();
  });
  it("an uncertain onboarding response does not claim success and reuses the key after reload", async () => {
    const journal = storage(); const send = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ result: tenant }).mockResolvedValueOnce({ result: { intent_id: uuid(5), status: "pending" } });
    const job = CustomerJourney.create(draft, journal, "job", send);
    await expect(job.run()).rejects.toThrow(); expect(job.state.tenant).toBeNull();
    const restored = CustomerJourney.restore(journal, "job", send)!; await restored.run();
    expect(send.mock.calls[0][1]).toBe(send.mock.calls[1][1]); expect(send.mock.calls[0][2]).toEqual(send.mock.calls[1][2]); expect(restored.state.tenant).toEqual(tenant);
  });
  it("partial admin failure preserves the created colegio and retries only prepare with its original key", async () => {
    const journal = storage(); const send = vi.fn().mockResolvedValueOnce({ result: tenant }).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ result: { intent_id: uuid(5), status: "pending" } });
    const job = CustomerJourney.create(draft, journal, "job", send);
    await expect(job.run()).rejects.toThrow(); expect(job.state.tenant).toEqual(tenant); expect(job.state.administrator).toBeNull();
    await CustomerJourney.restore(journal, "job", send)!.run();
    expect(send.mock.calls.map(([path]) => path)).toEqual(["/api/platform/schools/onboard", "/api/platform/customer-admins/prepare", "/api/platform/customer-admins/prepare"]);
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
  it("invalid server responses (including a missing generated code) cannot claim colegio or admin success", async () => {
    for (const result of [{ success: true }, { ...tenant, school_code: undefined }, { ...tenant, school_code: "MI-CODIGO" }]) {
      const send = vi.fn().mockResolvedValue({ result }); const job = CustomerJourney.create(draft, storage(), "job", send);
      await expect(job.run()).rejects.toThrow(); expect(job.state.tenant).toBeNull(); expect(job.state.administrator).toBeNull();
    }
  });
  it("validates RNC, locked country, canonical province, email and username; rejects operator-chosen codes", () => {
    for (const patch of [{ schoolName: " " }, { taxId: "12345" }, { taxId: "ABC123456" }, { addressLine: "" }, { countryCode: "US" }, { provinceCode: "Santiago" }, { provinceCode: "DO-99" },
      { administratorEmail: "not-email" }, { administratorUsername: "x" }]) expect(schoolOnboardingDraftSchema.safeParse({ ...draft, ...patch }).success).toBe(false);
    expect(schoolOnboardingDraftSchema.parse({ ...draft, taxId: "001-1234567-8" }).taxId).toBe("00112345678");
    expect(schoolOnboardingSchema.safeParse({ schoolName: draft.schoolName, taxId: "101234567", addressLine: "x", countryCode: "DO", provinceCode: "DO-01", schoolCode: "MINE" }).success).toBe(false);
    expect(journeyStorageKey("a")).not.toBe(journeyStorageKey("b"));
  });
});
