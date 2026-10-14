import { z } from "zod";
import { bulkRequestSchema, bulkCommitSchema, bulkValidationSchema, bulkPayloadLimit } from "./bulk-contracts";
import { sessionFetch } from "../auth/session-fetch";
import { recoveryKey } from "./command";
const commit = bulkRequestSchema.options[1];
export const pendingBulkSchema = z.object({ key: z.uuid(), command: commit }).strict();
export type PendingBulk = z.infer<typeof pendingBulkSchema>;
export type BulkValidation = z.infer<typeof bulkValidationSchema>;
export const bulkRecoveryKey = (actor: string, school: string) => recoveryKey(actor, school, "student-bulk-v1");
export function loadBulk(storage: Pick<Storage, "getItem">, key: string, school: string): PendingBulk | null {
 const raw = storage.getItem(key); if (!raw) return null;
 const pending = pendingBulkSchema.parse(JSON.parse(raw));
 if (pending.command.schoolId !== school) throw new Error("Invalid recovery scope");
 return pending;
}
export function prepareBulk(storage: Pick<Storage, "getItem" | "setItem">, key: string, command: PendingBulk["command"]): PendingBulk {
 const parsed = commit.parse(command);
 const prior = loadBulk(storage, key, parsed.schoolId); if (prior) return prior;
 const canonical = { ...parsed, rows: [...parsed.rows].sort((a, b) => Number((a as { source_row: number }).source_row) - Number((b as { source_row: number }).source_row)), included_rows: [...parsed.included_rows].sort((a,b) => a-b) };
 if (new TextEncoder().encode(JSON.stringify(canonical)).length > bulkPayloadLimit) throw new Error("La solicitud supera 1 MiB.");
 const pending = { key: crypto.randomUUID(), command: canonical }; storage.setItem(key, JSON.stringify(pending)); return pending;
}
export async function validateBulk(schoolId: string, rows: unknown[], send: typeof fetch = sessionFetch): Promise<BulkValidation> {
 const command = bulkRequestSchema.parse({ action: "validate", schoolId, rows });
 if (new TextEncoder().encode(JSON.stringify(command)).length > bulkPayloadLimit) throw new Error("La solicitud supera 1 MiB.");
 const response = await send("/api/school/students/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
 if (!response.ok) throw new Error(response.status === 413 ? "Se excede el límite de 200 filas / 1 MiB." : "No se pudo validar con la sesión y permisos actuales.");
 const result = bulkValidationSchema.parse((await response.json()).result);
 if (result.school_id !== schoolId || result.rows.length !== rows.length || result.rows.some(r => !rows.some(x => (x as { source_row: number }).source_row === r.source_row)) || new Set(result.rows.map(r => r.source_row)).size !== rows.length) throw new Error("Respuesta de validación inválida.");
 return result;
}
// Always validate the full file. An explicitly excluded duplicate may be resolved
// by a second authoritative read of the selected subset; excluded errors remain visible.
export async function validateSelection(schoolId: string, rows: unknown[], included: number[], send: typeof fetch = sessionFetch): Promise<BulkValidation> {
 const full = await validateBulk(schoolId, rows, send);
 if (!included.length || included.length === rows.length) return full;
 const selected = rows.filter(row => included.includes((row as { source_row: number }).source_row));
 const checked = await validateBulk(schoolId, selected, send);
 return { ...full, rows: full.rows.map(row => checked.rows.find(r => r.source_row === row.source_row) ?? row) };
}
export async function sendBulk(pending: PendingBulk, send: typeof fetch = sessionFetch) {
 try {
  const response = await send("/api/school/students/import", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key }, body: JSON.stringify(pending.command) });
  if (!response.ok) return { status: "uncertain" } as const;
  const parsed = bulkCommitSchema.safeParse((await response.json()).result);
  if (!parsed.success || parsed.data.school_id !== pending.command.schoolId || parsed.data.request_id !== pending.key) return { status: "uncertain" } as const;
  if (parsed.data.status === "committed" && (parsed.data.created.length !== pending.command.included_rows.length || new Set(parsed.data.created.map(r => r.source_row)).size !== parsed.data.created.length || parsed.data.created.some(r => !pending.command.included_rows.includes(r.source_row)))) return { status: "uncertain" } as const;
  return parsed.data;
 } catch { return { status: "uncertain" } as const; }
}
