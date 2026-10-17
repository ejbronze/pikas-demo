import { z } from 'zod';
import { sessionFetch } from '../auth/session-fetch';
import { creditSchema, resultSchema, type Credit } from './contracts';
export const pendingSchema = z.object({ command: creditSchema }).strict();
export function load(storage: Pick<Storage,'getItem'>, key: string): Credit | null {
  const raw = storage.getItem(key);
  return raw === null ? null : pendingSchema.parse(JSON.parse(raw)).command;
}
export function prepare(storage: Pick<Storage,'getItem'|'setItem'>, key: string, command: Credit): Credit {
  const prior = load(storage,key);
  if (prior) return prior;
  const parsed = creditSchema.parse(command);
  storage.setItem(key,JSON.stringify({command:parsed}));
  return parsed;
}
export async function send(command: Credit, transport: typeof fetch = sessionFetch) {
  try {
    const response = await transport('/api/school/wallet',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':command.request_key},body:JSON.stringify(command)});
    const body = await response.json();
    if (!response.ok) return { outcome: [400,401,403,422].includes(response.status) ? 'rejected' as const : 'uncertain' as const };
    const parsed = resultSchema.safeParse(body.result);
    if (!parsed.success || parsed.data.request_key !== command.request_key || parsed.data.student_id !== command.student_id || parsed.data.school_id !== command.school_id || parsed.data.amount_minor !== command.amount_minor) return {outcome:'uncertain' as const};
    return {outcome:'success' as const, result:parsed.data};
  } catch { return {outcome:'uncertain' as const}; }
}
