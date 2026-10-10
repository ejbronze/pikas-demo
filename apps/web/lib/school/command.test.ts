import { describe, expect, it, vi } from "vitest";
import { commandSchema, type SchoolCommand } from "./contracts";
import { loadCommand, prepareCommand, recoveryKey, sendCommand } from "./command";
const id = "4d200000-0000-4000-8000-000000000001";
const command: SchoolCommand = { schoolId: id, operation: "admin_prepare", payload: { email: "admin@example.invalid" } };
function storage() { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }; }
describe("school command validation and recovery", () => {
  it.each(["actor_id", "persona_id", "role", "account_id", "auth_id", "membership_id"])("rejects client authority %s on admin prepare", key => { expect(commandSchema.safeParse({ ...command, payload: { ...command.payload, [key]: id } }).success).toBe(false); });
  it("isolates recovery by actor, school and action", () => { expect(recoveryKey("A", "B", "C")).not.toBe(recoveryKey("X", "B", "C")); expect(recoveryKey("A", "B", "C")).not.toBe(recoveryKey("A", "X", "C")); });
  it("duplicate clicks/reloads retain the original key and payload", () => {
    const store = storage(); const first = prepareCommand(store, "form", command);
    const second = prepareCommand(store, "form", { ...command, payload: { email: "changed@example.invalid" } });
    expect(second).toEqual(first); expect(loadCommand(store, "form")).toEqual(first);
  });
  it("corrupt recovery never generates a new request", () => { const store = storage(); store.setItem("form", "invalid"); expect(() => prepareCommand(store, "form", command)).toThrow(); });
  it("storage failure prevents preparing an operation", () => { expect(() => prepareCommand({ getItem: () => null, setItem: () => { throw new Error("blocked"); } }, "form", command)).toThrow(); });
  it("uncertain retries send identical key/body", async () => {
    const pending = prepareCommand(storage(), "form", command); const send = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ok: true, json: async () => ({ result: { invitation_id: id, status: "pending" } }) });
    expect(await sendCommand(pending, send)).toBe("uncertain"); expect(await sendCommand(pending, send)).toBe("success"); expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  });
  it.each([null, {}, { membership_id: id }, { invitation_id: "invalid" }])("invalid/wrong-operation result cannot claim success", async result => { expect(await sendCommand({ key: id, command }, vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result }) }))).toBe("uncertain"); });
  it("unconfirmed identity is honestly pending", async () => { expect(await sendCommand({ key: id, command }, vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: "confirmed_identity_pending" }) }))).toBe("pending-identity"); });
  it("conflict or server failure is never silently replaced", async () => { expect(await sendCommand({ key: id, command }, vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "conflict" }) }))).toBe("uncertain"); });
});
