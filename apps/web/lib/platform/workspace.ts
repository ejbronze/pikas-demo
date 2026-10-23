// Platform Operations & Support Console (UX 15+16): the customer workspace as sections of one route.
// UI-free: section ids, hrefs (every older anchor still resolves), labels, activity grouping and the
// structure summary. Nothing here reads or decides authority.
export const workspaceSections = [
  ["resumen", "Resumen"], ["estructura", "Estructura"], ["personas", "Personas y accesos"], ["operacion", "Operación"], ["actividad", "Actividad"], ["estado", "Estado"],
] as const;
export type WorkspaceSection = typeof workspaceSections[number][0];
export const isWorkspaceSection = (v: unknown): v is WorkspaceSection => workspaceSections.some(([k]) => k === v);
export const sectionLabel = (s: WorkspaceSection) => workspaceSections.find(([k]) => k === s)![1];

// Older deep links (Inicio, Puesta en marcha steps) name anchors; each anchor lives in one section.
const anchorSections: Record<string, WorkspaceSection> = {
  "puesta-en-marcha": "resumen", "servicio-estudiantes": "resumen", "colegio-profile": "estructura", estructura: "estructura",
  "customer-access": "personas", "administrador-inicial": "personas", operacion: "operacion", "estado-cliente": "estado",
};
export function workspaceHref(accountId: string, section?: WorkspaceSection | string, anchor?: string): string {
  const resolved: WorkspaceSection = section && isWorkspaceSection(section) ? section : anchor && anchorSections[anchor] ? anchorSections[anchor] : section && anchorSections[section] ? anchorSections[section] : "resumen";
  const hash = anchor ?? (section && !isWorkspaceSection(section) && anchorSections[section] ? section : undefined);
  return `/platform/clientes/${accountId}${resolved === "resumen" ? "" : `?seccion=${resolved}`}${hash ? `#${hash}` : ""}`;
}
export const personHref = (accountId: string, personId: string) => `/platform/clientes/${accountId}?seccion=personas&persona=${personId}`;

// Pluralised structure summary with the Platform vocabulary: cliente → colegio → sede → cafetería.
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const structureSummary = (c: { school_count: number; location_count: number; cafeteria_count: number }) =>
  `${plural(c.school_count, "colegio", "colegios")} · ${plural(c.location_count, "sede", "sedes")} · ${plural(c.cafeteria_count, "cafetería", "cafeterías")}`;

// Platform audit actions in operator words. Unknown actions keep a neutral label.
export const activityLabels: Record<string, string> = {
  tenant_provisioned: "Cliente creado", customer_admin_intent_prepared: "Administrador preparado",
  customer_admin_identity_linked: "Identidad de administrador vinculada", customer_admin_membership_granted: "Acceso de administrador otorgado",
  school_location_added: "Sede agregada", sandbox_pov_entered: "Demostración iniciada", sandbox_pov_exited: "Demostración finalizada",
  customer_profile_updated: "Perfil del cliente actualizado", customer_structure_renamed: "Sede o cafetería renombrada", customer_person_renamed: "Nombre de persona corregido",
  cafeteria_admin_granted: "Administrador de cafetería asignado", customer_staff_prepared: "Personal POS preparado", customer_staff_completed: "Acceso de personal POS completado",
  customer_structure_status_changed: "Estado de sede o cafetería cambiado", customer_membership_status_changed: "Acceso de persona cambiado", customer_pos_access_granted: "Acceso POS agregado en otra cafetería",
  school_onboarded: "Colegio agregado", customer_suspended: "Cliente suspendido", customer_reactivated: "Cliente reactivado", customer_closed: "Cliente cerrado", customer_reopened: "Cliente reabierto",
};
export const activityLabel = (action: string) => activityLabels[action] ?? "Actividad de plataforma";

// "Clientes con actividad reciente": derived from the audit events PIKAS already keeps (no tracking of
// page views exists, and none is added). Most recent event per customer, newest first.
export type AuditEvent = { id: string; occurred_at: string; action: string; target_account_id?: string | null };
export function recentCustomers<E extends AuditEvent>(events: E[], limit = 5): { account_id: string; last: E }[] {
  const seen = new Map<string, E>();
  for (const e of [...events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))) if (e.target_account_id && !seen.has(e.target_account_id)) seen.set(e.target_account_id, e);
  return [...seen].slice(0, limit).map(([account_id, last]) => ({ account_id, last }));
}
export const customerActivity = <E extends AuditEvent>(events: E[], accountId: string) => events.filter(e => e.target_account_id === accountId);
