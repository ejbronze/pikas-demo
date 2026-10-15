import {z} from 'zod';
export const staffActivationStatusSchema=z.object({invitation_id:z.uuid(),account_id:z.uuid(),identity_state:z.enum(['missing','activation_pending','ready','unavailable']),link_state:z.enum(['none','active','expired','replaced']),expires_at:z.string().nullable()}).strict();
export type StaffActivationStatus=z.infer<typeof staffActivationStatusSchema>;
