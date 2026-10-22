import { AdministrativeShell, type ShellNavItem } from "../../components/administrative-shell";
import { requirePlatform } from "@/lib/platform/customer-console";

// Destinations are decided here, on the server, from Platform capabilities; each page enforces them again.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { identity, capabilities } = await requirePlatform();
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
