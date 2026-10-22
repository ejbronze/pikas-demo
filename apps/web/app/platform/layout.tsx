import { AdministrativeShell, type ShellNavItem } from "../../components/administrative-shell";
import { DemoEnvironmentBar } from "../../components/demo-environment-bar";
import { requirePlatform } from "@/lib/platform/customer-console";
import { DEMO_HOME } from "../../lib/platform/demo-mode";
import { experienceLabel } from "../../lib/platform/sandbox-pov";

// Destinations are decided here, on the server, from Platform capabilities; each page enforces them again.
// UX 11: while the operator has a current Demo POV the shell switches into Demo mode: real-operation
// destinations leave the navigation, the persistent "Demo activo" bar appears, and exit is global.
// Pages intercept real routes themselves (requirePlatform), so hidden navigation is never the only guard.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { identity, capabilities, demo } = await requirePlatform({ demo: "allow" });
  if (demo) {
    const nav: ShellNavItem[] = [{ href: DEMO_HOME, label: "Inicio Demo", icon: "demo", match: DEMO_HOME }];
    return <AdministrativeShell tone="navy" area="Plataforma · Demo" homeHref={DEMO_HOME} navLabel="Demo" nav={nav}
      context={{ label: "Demo activo", name: demo.accountName, detail: experienceLabel[demo.povCode] }}
      account={{ name: identity.person.displayName, role: "Operador de PIKAS · Demo" }} logout
      demo={<DemoEnvironmentBar pov={{ session_id: demo.sessionId, pov_code: demo.povCode }} context={demo.cafeteriaName} />}>
      {children}
    </AdministrativeShell>;
  }
  const nav: ShellNavItem[] = [
    { href: "/platform", label: "Inicio", icon: "home", match: "/platform", exact: true },
    ...(capabilities.includes("platform:tenant:lifecycle:read") ? [{ href: "/platform/clientes", label: "Clientes", icon: "clients", match: "/platform/clientes" } as const] : []),
    ...(capabilities.includes("platform:team:manage") ? [{ href: "/platform/equipo", label: "Equipo", icon: "team", match: "/platform/equipo" } as const] : []),
    ...(capabilities.includes("platform:finance:read") ? [{ href: "/platform/finanzas", label: "Finanzas", icon: "wallet", match: "/platform/finanzas" } as const] : []),
    ...(capabilities.includes("platform:identity:support") ? [{ href: "/platform/identidades", label: "Identidades", icon: "shield", match: "/platform/identidades" } as const] : []),
    ...(capabilities.includes("platform:sandbox:pov:enter") ? [{ href: "/platform/demostracion", label: "Demo", icon: "demo", match: "/platform/demostracion" } as const] : []),
  ];
  return <AdministrativeShell tone="navy" area="Plataforma" homeHref="/platform" navLabel="Plataforma" nav={nav}
    context={{ label: "PIKAS Admin", name: "Plataforma PIKAS" }}
    account={{ name: identity.person.displayName, role: "Operador de PIKAS" }} logout>
    {children}
  </AdministrativeShell>;
}
