import { z } from 'zod';
import { provisioningUsername } from '../identity/provisioning';
import { staffAccessErrors } from '../identity/staff-access';

// UX 15: Platform one-step Personal POS access. Same request shape as the Cafetería's (UX 12B),
// plus the explicit customer; the role is always Personal de caja (pos_cashier) on the Platform.
const uuid = z.uuid();
export const platformStaffAccessSchema = z.object({
  accountId: uuid, cafeteriaId: uuid,
  display_name: z.string().trim().min(1).max(200),
  email: z.email().trim().max(254).transform(v => v.toLowerCase()).nullable().optional(),
  username: provisioningUsername,
  register_id: uuid.nullable().optional(),
}).strict();
export type PlatformStaffAccessRequest = z.infer<typeof platformStaffAccessSchema>;

export const platformStaffAccessErrors: Record<string, string> = {
  ...staffAccessErrors,
  customer_access_provision_required: 'No tienes permiso para dar accesos a este cliente.',
  identity_support_required: 'El acceso se creó, pero tu rol no puede emitir la contraseña temporal. Emítela desde Credenciales con un operador que tenga soporte de identidad.',
  customer_provisioning_inactive: 'Solo se puede dar acceso nuevo a clientes activos.',
  inactive_cafeteria: 'La cafetería no está activa.',
  demo_mode_active: 'Estás en modo Demo. Sal del Demo para trabajar con clientes reales. No se realizó ningún cambio.',
};
