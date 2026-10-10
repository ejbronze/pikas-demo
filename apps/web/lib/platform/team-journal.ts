import { z } from 'zod';
import { teamCommandSchema,teamResultSchema,type TeamCommand } from './team-contracts';
import { postPlatform } from './customer-journey';
const pendingSchema=z.object({key:z.uuid(),command:teamCommandSchema}).strict();
export type TeamPending=z.infer<typeof pendingSchema>;
type StorageJournal=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const teamJournalKey=(actorHandle:string)=>`pikas:team:v1:${actorHandle}`;
export function restoreTeam(storage:StorageJournal,key:string):TeamPending|null {
 const saved=storage.getItem(key);return saved===null?null:pendingSchema.parse(JSON.parse(saved));
}
export function prepareTeam(storage:StorageJournal,key:string,command:TeamCommand):TeamPending {
 const saved=restoreTeam(storage,key);if(saved)return saved;
 const pending={key:crypto.randomUUID(),command:teamCommandSchema.parse(command)};
 storage.setItem(key,JSON.stringify(pending));return pending;
}
// Every unsuccessful retry preserves the exact request. Only matched authoritative success clears it.
export async function confirmTeam(storage:StorageJournal,key:string,pending:TeamPending,send=postPlatform) {
 const response=z.object({result:teamResultSchema}).parse(await send('/api/platform/team',pending.key,pending.command));
 if(response.result.request_id!==pending.key||response.result.operation!==pending.command.operation)throw Error('unresolved');
 storage.removeItem(key);
}
