import { z } from "zod";

// Pilot Hardening support tickets (202611240006). The database owns authority, transitions and the audit trail;
// these are the shapes and the Spanish vocabulary both sides share.
export const SUPPORT_READ = "platform:support:read";
export const SUPPORT_MANAGE = "platform:support:manage";

export const categories = ["technical", "access", "pos", "pikas_cash", "report_data", "other"] as const;
export type SupportCategory = typeof categories[number];
export const categoryLabel: Record<SupportCategory, string> = {
  technical: "Técnico", access: "Acceso", pos: "Punto de venta", pikas_cash: "PIKAS Cash", report_data: "Reporte / datos", other: "Otro",
};
export const statuses = ["received", "in_review", "info_requested", "resolved", "closed"] as const;
export type SupportStatus = typeof statuses[number];
export const statusLabel: Record<SupportStatus, string> = {
  received: "Recibido", in_review: "En revisión", info_requested: "Necesitamos información", resolved: "Resuelto", closed: "Cerrado",
};
export const roleLabel: Record<string, string> = {
  account_admin: "Administrador de cuenta", school_admin: "Administrador de colegio", cafeteria_admin: "Administrador de cafetería",
  pos_supervisor: "Supervisor POS", pos_cashier: "Cajero POS", pos_operator: "Operador POS",
};
export const eventLabel: Record<string, string> = {
  created: "Reporte enviado", reporter_reply: "Respuesta del cliente", platform_reply: "Respuesta de Soporte PIKAS", internal_note: "Nota interna",
  info_requested: "Necesitamos información", review_started: "En revisión", resolved: "Resuelto", closed: "Cerrado", reopened: "Reabierto",
};

// Only a bare page path travels with a report (never a query string, fragment, token or form content).
export const pagePath = (value: string | null | undefined) => value && /^\/[A-Za-z0-9/_-]{0,199}$/.test(value) ? value : null;
// Mirrors the database screen (support_text_ok) so the reporter hears it before sending; the database decides.
export const looksLikeSecret = (text: string) => /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(text) || /bearer\s+[A-Za-z0-9._~+/-]{20,}/i.test(text)
  || /sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/i.test(text) || /(password|passwd|contrase(ñ|n)a|clave)\s*[:=]\s*\S+/i.test(text);

const scopeSchema = z.object({ account_id: z.uuid(), account_name: z.string(), school_id: z.uuid().nullable(), school_name: z.string().nullable(),
  cafeteria_id: z.uuid().nullable(), cafeteria_name: z.string().nullable(), role: z.string() });
export type SupportScope = z.infer<typeof scopeSchema>;
export const scopeLabel = (s: Pick<SupportScope, "account_name" | "school_name" | "cafeteria_name">) => s.cafeteria_name ? `${s.cafeteria_name} · ${s.school_name}` : s.school_name ?? s.account_name;
const reporterEventSchema = z.object({ kind: z.string(), body: z.string().nullable(), author: z.string(), side: z.enum(["reporter", "platform"]), to_status: z.string().nullable(), created_at: z.string() });
export const reporterTicketSchema = z.object({ id: z.uuid(), reference: z.string(), category: z.enum(categories), subject: z.string(), description: z.string(),
  status: z.enum(statuses), created_at: z.string(), updated_at: z.string(),
  scope: z.object({ account_name: z.string(), school_name: z.string().nullable(), cafeteria_name: z.string().nullable() }), events: z.array(reporterEventSchema) });
export type ReporterTicket = z.infer<typeof reporterTicketSchema>;
export const reporterContextSchema = z.object({ scopes: z.array(scopeSchema), tickets: z.array(reporterTicketSchema) });
export const reporterResultSchema = reporterTicketSchema.extend({ replayed: z.boolean() });

const text = (max: number) => z.string().trim().min(1).max(max);
export const reporterCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), account_id: z.uuid(), school_id: z.uuid().nullable(), cafeteria_id: z.uuid().nullable(), category: z.enum(categories),
    subject: z.string().trim().min(3).max(140), description: z.string().trim().min(10).max(4000), page_path: z.string().max(200).nullable() }),
  z.object({ operation: z.literal("reply"), ticket_id: z.uuid(), body: text(4000) }),
]);
export type ReporterCommand = z.infer<typeof reporterCommandSchema>;

const platformRowSchema = z.object({ id: z.uuid(), reference: z.string(), category: z.enum(categories), subject: z.string(), status: z.enum(statuses),
  account_id: z.uuid(), account_name: z.string(), school_name: z.string().nullable(), cafeteria_name: z.string().nullable(),
  reporter_name: z.string(), reporter_role: z.string(), created_at: z.string(), updated_at: z.string() });
export type PlatformTicketRow = z.infer<typeof platformRowSchema>;
export const platformListSchema = z.object({ counts: z.record(z.string(), z.number()).nullable(), rows: z.array(platformRowSchema) });
export const platformTicketSchema = platformRowSchema.extend({ description: z.string(), page_path: z.string().nullable(), can_manage: z.boolean(),
  events: z.array(z.object({ kind: z.string(), visibility: z.enum(["reporter", "internal"]), body: z.string().nullable(), author: z.string(), side: z.enum(["reporter", "platform"]),
    from_status: z.string().nullable(), to_status: z.string().nullable(), created_at: z.string() })) });
export type PlatformTicket = z.infer<typeof platformTicketSchema>;
export const platformResultSchema = platformTicketSchema.extend({ replayed: z.boolean() });

export const platformActions = ["reply", "note", "request_info", "review", "resolve", "close", "reopen"] as const;
export type PlatformAction = typeof platformActions[number];
export const platformCommandSchema = z.object({ ticket_id: z.uuid(), action: z.enum(platformActions), body: z.string().trim().max(4000).nullable() });
export const platformFiltersSchema = z.object({
  estado: z.enum(["open", "all", ...statuses]).default("open"), categoria: z.enum(categories).optional(), q: z.string().trim().max(100).default(""),
});
// Which actions each status offers (the database enforces the same transitions).
export const actionsFor = (status: SupportStatus): PlatformAction[] => status === "closed" ? ["note", "reopen"]
  : status === "resolved" ? ["reply", "note", "close", "reopen"]
  : ["reply", "request_info", ...(status === "in_review" ? [] : ["review"] as const), "note", "resolve", "close"];
export const actionLabel: Record<PlatformAction, string> = {
  reply: "Responder", note: "Nota interna", request_info: "Pedir información", review: "Marcar en revisión", resolve: "Resolver", close: "Cerrar", reopen: "Reabrir",
};
export const bodyRequired = (action: PlatformAction) => ["reply", "note", "request_info", "resolve", "reopen"].includes(action);

export const supportRejections = new Set(["support_secret_detected", "support_scope_required", "support_ticket_closed", "support_ticket_not_found", "invalid_transition",
  "body_required", "support_rate_limited", "invalid_category", "invalid_subject", "invalid_description", "invalid_body", "invalid_page_path", "demo_mode_active"]);
export const supportMessage = (code: string | undefined) => ({
  support_secret_detected: "Parece que el texto incluye una contraseña o un token. Quítalo: Soporte PIKAS nunca los necesita.",
  support_scope_required: "No tienes acceso a ese colegio o cafetería.",
  support_ticket_closed: "Este reporte está cerrado. Si el problema continúa, envía un reporte nuevo.",
  support_ticket_not_found: "No encontramos ese reporte.",
  invalid_transition: "El reporte cambió de estado. Recarga para ver su estado actual.",
  body_required: "Escribe un mensaje.",
  support_rate_limited: "Enviaste muchos reportes hoy. Espera o escribe a Soporte PIKAS por el canal de contacto.",
  demo_mode_active: "En Demo no se envían reportes ni se gestionan tickets.",
  request_key_conflict: "Ese envío ya se registró con otro contenido. Recarga e inténtalo de nuevo.",
  platform_operation_conflict: "Ese envío ya se registró con otro contenido. Recarga e inténtalo de nuevo.",
  platform_authorization_required: "No tienes permiso para gestionar tickets de soporte.",
  authentication_required: "Tu sesión terminó. Vuelve a iniciar sesión.",
}[code ?? ""] ?? "Revisa los datos e inténtalo de nuevo.");
