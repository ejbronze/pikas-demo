import { z } from "zod";
import { readSchema } from "../cafeteria/contracts";

// Backoffice Customer Management (M1: read-only cafeteria operations). PIKAS employees inspect an
// explicitly selected customer's operations as themselves; the customer is context, never identity.
export const CUSTOMER_OPERATIONS_READ = "platform:customer:operations:read";
const id = z.guid();
const status = z.string().min(1);
export const operationsOverviewSchema = z.object({
  account: z.object({ id, name: z.string(), code: z.string(), status }),
  schools: z.array(z.object({ id, name: z.string(), status, locations: z.array(z.object({ id, name: z.string(), status,
    cafeterias: z.array(z.object({ id, name: z.string(), code: z.string(), status })) })) })),
});
export type OperationsOverview = z.infer<typeof operationsOverviewSchema>;
// Same operational data the tenant read returns; the scope says it is a PIKAS support read.
export const supportCafeteriaReadSchema = readSchema.omit({ scope: true }).extend({
  scope: z.object({ cafeteria_id: id, cafeteria_name: z.string(), cafeteria_status: status, account_id: id, account_name: z.string(), account_status: status,
    school_name: z.string(), location_name: z.string(), tenant_kind: z.literal("customer"), actor_id: id, membership_id: z.null(),
    capabilities: z.array(z.string()).length(0), support: z.literal(true) }).strict(),
}).strict();
export type SupportCafeteriaRead = z.infer<typeof supportCafeteriaReadSchema>;
export const supportRequestSchema = <T extends z.ZodTypeAny>(request: T) => z.object({ account_id: id, request }).strict();
export const lifecycleNotice: Record<string, string> = {
  suspended: "Cliente suspendido: su personal no tiene acceso. Puedes consultar su operación como apoyo.",
  closed: "Cliente cerrado: solo consulta histórica.",
};
