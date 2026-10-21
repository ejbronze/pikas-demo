import { z } from "zod";

// PIKAS UX 2: launch readiness over platform_customer_readiness (platform:customer:operations:read).
// The database returns observable facts only; every step state, launch status and attention item
// is derived here and never stored. Lifecycle (active/suspended/closed) is a separate concept:
// readiness never changes it, and only active customers are counted in launch states.
export const READINESS_CAPABILITY = "platform:customer:operations:read";
const id = z.guid(), count = z.number().int().min(0), when = z.string().nullable();
const request = z.object({ status: z.string(), expires_at: z.string(), request_expired: z.boolean(), identity_state: z.string().nullable(), link_state: z.string().nullable() });
export const customerReadinessSchema = z.object({
  account_id: id, name: z.string(), code: z.string(), status: z.string(), created_at: z.string(),
  profile: z.object({ active_schools: count, missing_tax_id: count, missing_address: count, missing_province: count }),
  structure: z.object({ active_locations: count, operating_cafeterias: count, first_cafeteria_id: id.nullable() }),
  administrators: z.object({ active: count, requests: z.array(request) }),
  staff: z.object({ active_pos: count, pending_invitations: count, expired_invitations: count }),
  registers: z.object({ active: count, staffed: count }),
  products: z.object({ available: count }),
  sales: z.object({ first_at: when, last_at: when }),
});
export const readinessSchema = z.object({ customers: z.array(customerReadinessSchema), sandbox: z.array(z.object({ account_id: id, name: z.string(), status: z.string() })), truncated: z.boolean() });
export type CustomerReadiness = z.infer<typeof customerReadinessSchema>;
export type Readiness = z.infer<typeof readinessSchema>;

export type StepKey = "perfil" | "estructura" | "administrador" | "personal" | "cajas" | "productos" | "venta";
export type StepState = "complete" | "pending" | "attention";
export type Step = { key: StepKey; label: string; state: StepState; detail: string; action: { href: string; label: string } | null };
export type LaunchStatus = "configuring" | "ready" | "operating" | "inactive";
export const launchLabel: Record<LaunchStatus, string> = { configuring: "En configuración", ready: "Listo para operar", operating: "Operando", inactive: "Fuera de operación" };

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", day: "numeric", month: "short", year: "numeric" });
export const customerHref = (accountId: string, anchor?: string) => `/platform/clientes/${accountId}${anchor ? `#${anchor}` : ""}`;
// Same route as components/platform/customer-operations cafeteriaHref (kept here so this module stays UI-free).
const cafeteriaHref = (accountId: string, cafeteriaId: string, section: string) => `/platform/clientes/${accountId}/gestion/cafeterias/${cafeteriaId}?seccion=${section}`;

// The administrator step: an active administrator completes it; a pending request explains where
// activation stands; an expired request or link, or no request at all, needs attention.
function administratorStep(c: CustomerReadiness): Pick<Step, "state" | "detail"> {
  if (c.administrators.active > 0) return { state: "complete", detail: n(c.administrators.active, "administrador con acceso", "administradores con acceso") };
  const r = c.administrators.requests[0];
  if (!r) return { state: "attention", detail: "Sin administrador ni solicitud de acceso." };
  if (r.request_expired) return { state: "attention", detail: "La solicitud de administrador venció. Prepara una nueva." };
  if (r.identity_state === "ready" || r.status === "linked") return { state: "pending", detail: "La persona ya guardó su contraseña: falta completar el acceso." };
  if (r.link_state === "expired") return { state: "attention", detail: "El enlace de activación venció sin usarse. Genera uno nuevo." };
  if (r.link_state === "active") return { state: "pending", detail: "Enlace de activación entregado: esperando que la persona lo use." };
  return { state: "pending", detail: "Acceso preparado: falta generar el enlace de activación." };
}

export function readinessSteps(c: CustomerReadiness): Step[] {
  const caf = c.structure.first_cafeteria_id, at = (anchor: string) => customerHref(c.account_id, anchor);
  const optional = c.profile.missing_tax_id + c.profile.missing_address + c.profile.missing_province > 0;
  const admin = administratorStep(c);
  const staff: Pick<Step, "state" | "detail"> = c.staff.active_pos > 0 ? { state: "complete", detail: n(c.staff.active_pos, "persona de caja con acceso", "personas de caja con acceso") }
    : c.staff.expired_invitations > 0 ? { state: "attention", detail: n(c.staff.expired_invitations, "invitación de personal venció", "invitaciones de personal vencieron") + " sin usarse." }
    : c.staff.pending_invitations > 0 ? { state: "pending", detail: n(c.staff.pending_invitations, "invitación esperando activación", "invitaciones esperando activación") + "." }
    : { state: "pending", detail: "Agrega al menos una persona de caja." };
  const cajas: Pick<Step, "state" | "detail"> = c.registers.staffed > 0 ? { state: "complete", detail: n(c.registers.staffed, "caja lista para vender", "cajas listas para vender") }
    : c.registers.active > 0 ? { state: "pending", detail: "Hay cajas, pero ninguna tiene personal de caja asignado." }
    : { state: "pending", detail: "Crea la primera caja." };
  return [
    { key: "perfil", label: "Perfil", ...(c.profile.active_schools > 0 ? { state: "complete", detail: optional ? "Colegio registrado. RNC, dirección o provincia sin registrar (opcional)." : "Colegio registrado." } : { state: "pending", detail: "Sin colegio activo." }),
      action: { href: at("colegio-profile"), label: "Ver perfil" } },
    { key: "estructura", label: "Estructura", ...(c.structure.operating_cafeterias > 0 ? { state: "complete", detail: n(c.structure.operating_cafeterias, "cafetería en operación", "cafeterías en operación") } : { state: "pending", detail: "Falta una sede con su cafetería activa." }),
      action: { href: at("estructura"), label: "Ver estructura" } },
    { key: "administrador", label: "Administrador", ...admin, action: { href: at("administrador-inicial"), label: "Ver administrador" } },
    { key: "personal", label: "Personal POS", ...staff, action: { href: at("customer-access"), label: "Ver usuarios y accesos" } },
    { key: "cajas", label: "Cajas", ...cajas, action: caf ? { href: cafeteriaHref(c.account_id, caf, "cajas"), label: "Ver cajas" } : { href: at("estructura"), label: "Ver estructura" } },
    { key: "productos", label: "Productos", ...(c.products.available > 0 ? { state: "complete", detail: n(c.products.available, "producto disponible", "productos disponibles") } : { state: "pending", detail: "Agrega productos disponibles para la venta." }),
      action: caf ? { href: cafeteriaHref(c.account_id, caf, "productos"), label: "Ver productos" } : { href: at("estructura"), label: "Ver estructura" } },
    { key: "venta", label: "Primera venta", ...(c.sales.first_at ? { state: "complete", detail: `Primera venta el ${shortDate(c.sales.first_at)}.` } : { state: "pending", detail: "Se completa sola con la primera venta real en el POS." }), action: null },
  ];
}

export function launchStatus(c: CustomerReadiness, steps = readinessSteps(c)): LaunchStatus {
  if (c.status !== "active") return "inactive";
  if (c.sales.first_at) return "operating";
  return steps.slice(0, 6).every(s => s.state === "complete") ? "ready" : "configuring";
}
export const completeCount = (steps: Step[]) => steps.filter(s => s.state === "complete").length;
export const nextStep = (steps: Step[]) => steps.find(s => s.state !== "complete") ?? null;

// Requiere atención: one item per active customer whose setup (steps 1–6) is incomplete. Things that
// went wrong (expired request, link or invitation, no administrator at all) lead; then the next step.
export type AttentionItem = { customer: CustomerReadiness; severity: "attention" | "pending"; step: Step; others: Step[] };
export function attentionItems(customers: CustomerReadiness[]): AttentionItem[] {
  return customers.filter(c => c.status === "active").flatMap(c => {
    const open = readinessSteps(c).slice(0, 6).filter(s => s.state !== "complete");
    if (!open.length) return [];
    const lead = open.find(s => s.state === "attention") ?? open[0];
    return [{ customer: c, severity: lead.state === "attention" ? "attention" as const : "pending" as const, step: lead, others: open.filter(s => s !== lead) }];
  }).sort((a, b) => (a.severity === b.severity ? a.customer.name.localeCompare(b.customer.name, "es") : a.severity === "attention" ? -1 : 1));
}

export function networkSummary(customers: CustomerReadiness[]) {
  const status = customers.map(c => launchStatus(c));
  return { active: status.filter(s => s !== "inactive").length, configuring: status.filter(s => s === "configuring").length,
    ready: status.filter(s => s === "ready").length, operating: status.filter(s => s === "operating").length, inactive: status.filter(s => s === "inactive").length };
}
