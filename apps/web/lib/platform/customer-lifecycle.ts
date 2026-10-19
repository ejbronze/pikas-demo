import { z } from "zod";

// Platform customer lifecycle (Activo / Suspendido / Cerrado). The database (accounts.status) is
// authoritative; these contracts only shape requests and responses for Platform operators.
export const LIFECYCLE_MANAGE = "platform:tenant:lifecycle:manage";
export type CustomerStatus = "active" | "suspended" | "closed";
export const lifecycleActionSchema = z.enum(["suspend", "reactivate", "close", "reopen"]);
export type LifecycleAction = z.infer<typeof lifecycleActionSchema>;
export const lifecycleRequestSchema = z.object({ accountId: z.uuid(), expectedStatus: z.enum(["active", "suspended", "closed"]), action: lifecycleActionSchema,
  reason: z.string().trim().min(3).max(500) }).strict();
export const lifecycleResultSchema = z.object({ account_id: z.uuid(), status: z.enum(["active", "suspended", "closed"]), previous_status: z.string() });
export const lifecycleHistorySchema = z.object({ events: z.array(z.object({ occurred_at: z.string(), action: z.enum(["customer_suspended", "customer_reactivated", "customer_closed", "customer_reopened"]),
  from: z.string().nullable(), to: z.string().nullable(), reason: z.string().nullable(), actor_name: z.string().nullable() })) });
export const lifecycleRejections = ["lifecycle_reason_required", "lifecycle_state_changed", "invalid_lifecycle_transition", "lifecycle_customer_only"] as const;
export const isLifecycleRejection = (code: unknown): code is string => typeof code === "string" && (lifecycleRejections as readonly string[]).includes(code);
// Valid transitions from each state (mirrors platform_set_customer_lifecycle; the database decides).
export const actionsFor = (status: string): LifecycleAction[] => status === "active" ? ["suspend", "close"] : status === "suspended" ? ["reactivate", "close"] : status === "closed" ? ["reopen"] : [];
export const actionLabels: Record<LifecycleAction, string> = { suspend: "Suspender", reactivate: "Reactivar", close: "Cerrar cliente", reopen: "Reabrir cliente" };
export const eventLabels: Record<string, string> = { customer_suspended: "Cliente suspendido", customer_reactivated: "Cliente reactivado", customer_closed: "Cliente cerrado", customer_reopened: "Cliente reabierto" };
export const lifecycleErrorMessages: Record<string, string> = {
  lifecycle_reason_required: "Indica el motivo (de 3 a 500 caracteres).",
  lifecycle_state_changed: "El estado del cliente cambió mientras revisabas. Actualiza la página para ver el estado actual.",
  invalid_lifecycle_transition: "Ese cambio no es válido para el estado actual del cliente.",
  lifecycle_customer_only: "Los entornos sandbox no tienen ciclo de vida de cliente.",
};
