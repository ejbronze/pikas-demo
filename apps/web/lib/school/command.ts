import { z } from "zod";
import { commandSchema, commandResultSchema, type SchoolCommand } from "./contracts";
export const pendingCommandSchema = z.object({ key: z.uuid(), command: commandSchema }).strict();
export type PendingCommand = z.infer<typeof pendingCommandSchema>;
export function recoveryKey(actor: string, school: string, form: string) { return `pikas:school:request:${actor}:${school}:${form}`; }
export function loadCommand(storage: Pick<Storage, "getItem">, key: string): PendingCommand | null {
  const value = storage.getItem(key);
  return value === null ? null : pendingCommandSchema.parse(JSON.parse(value));
}
export function prepareCommand(storage: Pick<Storage, "getItem" | "setItem">, storageKey: string, command: SchoolCommand): PendingCommand {
  const existing = loadCommand(storage, storageKey);
  if (existing) return existing;
  const pending = { key: crypto.randomUUID(), command: commandSchema.parse(command) };
  storage.setItem(storageKey, JSON.stringify(pending));
  return pending;
}
export async function sendCommand(pending: PendingCommand, send: typeof fetch = fetch): Promise<"success" | "rejected" | "pending-identity" | "uncertain"> {
  try {
    const response = await send("/api/school", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key }, body: JSON.stringify(pending.command) });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 422 && body.error === "confirmed_identity_pending") return "pending-identity";
      return [400, 401, 403, 422].includes(response.status) ? "rejected" : "uncertain";
    }
    const result = commandResultSchema.safeParse(body.result);
    if (!result.success) return "uncertain";
    const op = pending.command.operation;
    const expected = op === "student_create" || op === "student_update" || op === "student_status" ? "student_id" : op.startsWith("student_") ? "enrollment_id" : op === "admin_prepare" ? "invitation_id" : op.startsWith("admin_") ? "membership_id" : op === "sharing_set" ? "share_id" : "customer_id";
    return expected in result.data ? "success" : "uncertain";
  } catch { return "uncertain"; }
}
