import { z } from 'zod';
export const TEAM_CAPABILITY = 'platform:team:manage';
const handle = z.string().regex(/^[0-9a-f]{32}$/);
export const teamCommandSchema = z.discriminatedUnion('operation', [
 z.object({operation:z.literal('prepare'),payload:z.object({name:z.string().trim().min(1).max(200),email:z.email().trim().max(254),demo:z.boolean()}).strict()}).strict(),
 z.object({operation:z.literal('complete'),payload:z.object({handle}).strict()}).strict(),
 z.object({operation:z.literal('demo'),payload:z.object({handle,enabled:z.boolean()}).strict()}).strict(),
]);
export type TeamCommand = z.infer<typeof teamCommandSchema>;
export const teamResultSchema = z.object({request_id:z.uuid(),operation:z.enum(['prepare','complete','demo']),status:z.literal('confirmed')}).strict();
const status = z.enum(['active','suspended','inactive']);
export const teamReadSchema = z.object({actor_handle:handle,
 operators:z.array(z.object({handle,name:z.string(),email:z.string().nullable(),person_status:status,admin_status:z.enum(['active','suspended','inactive','none']),demo:z.boolean()}).strict()),
 prepared:z.array(z.object({handle,name:z.string(),email:z.string(),demo:z.boolean(),status:z.enum(['pending','completed','expired'])}).strict()),
}).strict();
export type TeamRead = z.infer<typeof teamReadSchema>;
