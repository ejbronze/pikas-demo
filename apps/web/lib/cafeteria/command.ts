import { commandSchema, commandResultSchema, type CafeteriaCommand } from './contracts';
import { z } from 'zod';
export const pendingSchema = z.object({ key: z.uuid(), command: commandSchema }).strict();
export type Pending = z.infer<typeof pendingSchema>;
export const recoveryKey = (actor: string, cafeteria: string) => `pikas:cafeteria:request:${actor}:${cafeteria}`;
export function load(storage: Pick<Storage,'getItem'>, key: string): Pending | null {
 const value = storage.getItem(key); return value === null ? null : pendingSchema.parse(JSON.parse(value));
}
export function prepare(storage: Pick<Storage,'getItem'|'setItem'>, key: string, command: CafeteriaCommand): Pending {
 const existing = load(storage,key); if (existing) return existing;
 const pending = { key: crypto.randomUUID(), command: commandSchema.parse(command) };
 storage.setItem(key,JSON.stringify(pending)); return pending;
}
export async function send(pending: Pending, fetcher: typeof fetch = fetch): Promise<'success'|'rejected'|'pending-identity'|'uncertain'> {
 try {
  const response = await fetcher('/api/cafeteria',{ method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':pending.key},body:JSON.stringify(pending.command) });
  const body = await response.json();
  if (!response.ok) {
   if (response.status === 422 && body.error === 'confirmed_identity_pending') return 'pending-identity';
   return [400,401,403,422].includes(response.status) ? 'rejected' : 'uncertain';
  }
  const result = commandResultSchema.safeParse(body.result);
  return result.success && result.data.request_id === pending.key && result.data.operation === pending.command.operation ? 'success' : 'uncertain';
 } catch { return 'uncertain'; }
}
export function mustPreserve(recovery: boolean, outcome: Awaited<ReturnType<typeof send>>) { return outcome === 'uncertain' || (recovery && outcome !== 'success'); }
