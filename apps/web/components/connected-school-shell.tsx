"use client";
import { DemoEnvironmentBar } from "./demo-environment-bar";
import { AdministrativeShell, type ShellNavItem } from "./administrative-shell";
import type { SchoolContext } from "../lib/school/contracts";
const items = [["", "Resumen", "home"], ["/estudiantes", "Estudiantes", "users"], ["/pikas-cash", "PIKAS Cash", "wallet"], ["/administradores", "Administradores", "shield"], ["/cafeterias", "Cafeterías conectadas", "utensils"], ["/actividad", "Actividad", "receipt"]] as const;
const roles = { account_admin: { area: "Administración de cuenta", role: "Administrador de cuenta" }, school_admin: { area: "Administración escolar", role: "Administrador escolar" } } as const;
// role comes from the server-validated school read when one exists; otherwise the label stays neutral.
// PIKAS Cash (5D.5 report) is listed only when the server-derived wallet read grants school:wallets:read.
export function ConnectedSchoolShell({ context, schoolId, role, walletNav = false, children }: { context: SchoolContext; schoolId: string; role?: keyof typeof roles; walletNav?: boolean; children: React.ReactNode }) {
  const scope = context.schools.find(s => s.school_id === schoolId)!;
  const nav: ShellNavItem[] = items.filter(([suffix]) => walletNav || suffix !== "/pikas-cash").map(([suffix, label, icon]) => ({ href: `/admin/escuela${suffix}?school=${schoolId}`, label, icon, match: `/admin/escuela${suffix}`, exact: suffix === "" }));
  const labels = role ? roles[role] : { area: "Administración escolar", role: "Administración" };
  return <AdministrativeShell tone="navy" area={labels.area} homeHref={`/admin/escuela?school=${schoolId}`} navLabel="Administración escolar" nav={nav}
    context={{ label: "Escuela", name: scope.school_name, detail: context.pov ? "Datos ficticios" : role === "account_admin" ? scope.account_name : undefined }}
    switcher={context.pov ? undefined : { id: "workspace-school", name: "school", label: "Escuela", value: schoolId, options: context.schools.map(s => ({ value: s.school_id, label: s.school_name })) }}
    account={context.pov ? { name: context.pov.operator_name, role: "Operador de PIKAS · Demo" } : { name: context.display_name, role: labels.role }}
    logout={!context.pov}
    demo={context.pov ? <DemoEnvironmentBar pov={context.pov} /> : undefined}
    notice={!context.pov && scope.tenant_kind === "sandbox" ? <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm font-bold text-amber-950" role="status">DEMO / SANDBOX · {scope.school_name} · Datos de prueba</div> : undefined}>
    {children}
  </AdministrativeShell>;
}
