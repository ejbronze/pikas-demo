import {z} from 'zod';
export const delegationReadSchema=z.object({self_status:z.enum(['active','suspended','inactive']).nullable(),administrators:z.array(z.object({name:z.string(),status:z.string()}).strict()),invitations:z.array(z.object({id:z.uuid(),email:z.email(),status:z.string(),identity:z.enum(['missing','ready','activation_pending','unavailable']),link_state:z.enum(['none','active','expired','replaced'])}).strict())}).strict();
export type DelegationRead=z.infer<typeof delegationReadSchema>;
