import { z } from "zod";
import { sandboxPovCodeSchema, type SandboxPovCode } from "./sandbox-pov";

// Demo Lab (Platform): sandbox customers, their personas and the baseline, as platform_demo_lab_read
// returns them. The sandbox is a real customer with tenant_kind='sandbox'; a persona is opened only
// through the UX 11 POV ("Abrir como…"). Nothing here grants anything: the database decides.
export const SANDBOX_MANAGE = "platform:sandbox:manage";
const id = z.uuid();
export const demoPersonaSchema = z.object({
  persona_id: id, pov_code: sandboxPovCodeSchema, display_name: z.string(), school_id: id.nullish(), cafeteria_id: id, cafeteria_name: z.string(),
  location_name: z.string(), membership_status: z.string().nullish(), valid: z.boolean(), registers: z.array(z.string()),
});
export const demoSandboxSchema = z.object({
  account_id: id, name: z.string(), code: z.string(), status: z.string(), baseline: z.string(),
  school: z.object({ school_id: id, name: z.string(), status: z.string() }).nullish(),
  locations: z.array(z.object({ location_id: id, name: z.string(), status: z.string(), cafeterias: z.array(z.object({
    cafeteria_id: id, name: z.string(), status: z.string(), registers: z.array(z.object({ register_id: id, name: z.string(), code: z.string(), status: z.string() })),
    products: z.number().int(), staff: z.number().int(), purchases: z.number().int(), open_sessions: z.number().int() })) })),
  students: z.number().int(), eligible_students: z.number().int(),
  personas: z.array(demoPersonaSchema),
  sandbox_staff: z.array(z.object({ person_id: id, display_name: z.string(), role_code: z.string(), status: z.string(), cafeteria_name: z.string(), username: z.string().nullish(), has_login: z.boolean() })),
  last_reset: z.object({ at: z.string(), actor_name: z.string().nullish() }).nullish(),
  last_entered: z.string().nullish(),
});
export const demoLabSchema = z.object({ can_reset: z.boolean(), active: z.unknown().nullable(), sandboxes: z.array(demoSandboxSchema) });
export type DemoLab = z.infer<typeof demoLabSchema>;
export type DemoSandbox = z.infer<typeof demoSandboxSchema>;
export type DemoPersona = z.infer<typeof demoPersonaSchema>;

export const resetRequestSchema = z.object({ accountId: id }).strict();
export type ResetRequest = z.infer<typeof resetRequestSchema>;
export const resetResultSchema = z.object({
  request_id: id, account_id: id, baseline: z.string(), deleted: z.record(z.string(), z.number().int()), seeded: z.record(z.string(), z.unknown()),
  auth_user_ids: z.array(id), reset_at: z.string(), auth_purged: z.number().int().optional(), auth_failed: z.number().int().optional(),
}).loose();
export type ResetResult = z.infer<typeof resetResultSchema>;
export const resetRejections = ["sandbox_required", "demo_mode_active", "invalid_sandbox_reset_request"] as const;
export const isResetRejection = (code: unknown): code is string => typeof code === "string" && (resetRejections as readonly string[]).includes(code);
export const resetMessages: Record<string, string> = {
  sandbox_required: "Solo se restaura un entorno de demostración (sandbox). Un cliente real nunca se restaura desde aquí.",
  demo_mode_active: "Sal del Demo antes de restaurar el escenario: la restauración termina todas las sesiones Demo del sandbox.",
  invalid_sandbox_reset_request: "Revisa la solicitud.",
  platform_authorization_required: "Restaurar el escenario requiere autoridad de administrador de la plataforma.",
};

// Persona words (owner vocabulary) and the role each persona exercises in the real application.
export const personaRole: Record<SandboxPovCode, { role: string; experience: string; verb: string }> = {
  school_admin: { role: "Administradora escolar", experience: "Administración escolar", verb: "Entra a la administración del colegio: estudiantes, compartición, elegibilidad y PIKAS Cash en modo consulta." },
  cafeteria_admin: { role: "Administrador de cafetería", experience: "Administración de cafetería", verb: "Entra a la cafetería: cajas, Personal POS, productos, menús, Hoy, transacciones y reportes." },
  cashier: { role: "Cajero", experience: "Caja / POS", verb: "Entra al POS con su caja asignada y vende a los estudiantes ficticios." },
};
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
export const statusWord = (status: string) => ({ active: "Activo", suspended: "Suspendido", inactive: "Inactivo", closed: "Cerrado" })[status] ?? status;
// A sandbox is "ready to sell" when every operational piece of the baseline is in place.
export function sandboxReadiness(s: DemoSandbox): { ready: boolean; label: string } {
  const cafeterias = s.locations.flatMap(l => l.cafeterias);
  const ready = s.status === "active" && cafeterias.some(c => c.status === "active" && c.registers.some(r => r.status === "active") && c.products > 0) && s.eligible_students > 0 && s.personas.every(p => p.valid);
  return { ready, label: ready ? "Listo para demostrar" : s.personas.some(p => !p.valid) ? "Personas no disponibles" : "En configuración" };
}
