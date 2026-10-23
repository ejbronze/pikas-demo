// Lifecycle & Access Management: after a forced password change (or a sign-in that opens nothing), the
// next step is told truthfully from the person's OWN access summary (names and states only). A
// suspended cafetería access is not a global login suspension and is never "ya puedes iniciar sesión".
export type AccessSummary = { organization?: string | null; memberships?: { scope: string; role: string; status: string; name: string }[] } | null;
export type PostChangeAccess = { kind: "organization_suspended" | "organization_closed" | "suspended" | "inactive" | "none"; names: string[] };
export function accessState(s: AccessSummary): PostChangeAccess {
  if (s?.organization === "suspended") return { kind: "organization_suspended", names: [] };
  if (s?.organization === "closed") return { kind: "organization_closed", names: [] };
  const m = s?.memberships ?? [];
  const suspended = [...new Set(m.filter(x => x.status === "suspended").map(x => x.name))];
  if (suspended.length) return { kind: "suspended", names: suspended };
  const inactive = [...new Set(m.filter(x => x.status === "inactive").map(x => x.name))];
  if (inactive.length) return { kind: "inactive", names: inactive };
  return { kind: "none", names: [] };
}
export function afterChange(access?: { kind: string; names: string[] } | null): string {
  const names = access?.names?.join(", ") ?? "";
  if (access?.kind === "organization_suspended") return "Contraseña actualizada. El acceso de tu organización está suspendido temporalmente; comunícate con su administrador o con PIKAS.";
  if (access?.kind === "organization_closed") return "Contraseña actualizada. Tu organización está cerrada y ya no tiene acceso operativo a PIKAS.";
  if (access?.kind === "suspended") return `Contraseña actualizada. Tu acceso a ${names} está suspendido: contacta al administrador de ${access.names.length === 1 ? "la cafetería o el colegio" : "cada cafetería o colegio"} para recuperarlo. Tu usuario y tu contraseña siguen siendo válidos.`;
  if (access?.kind === "inactive") return `Contraseña actualizada. Tu acceso a ${names} fue desactivado; pide al administrador que lo reactive si aún lo necesitas.`;
  if (access?.kind === "none") return "Contraseña actualizada. Todavía no tienes un acceso asignado en PIKAS; el administrador de tu institución puede dártelo.";
  return "Contraseña actualizada. Ya puedes iniciar sesión.";
}
