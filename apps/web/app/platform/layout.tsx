import Link from "next/link";
import { PlatformNavLink } from "./platform-nav-link";
import { BrandLogo } from "@/components/brand-logo";
import { requirePlatform } from "@/lib/platform/customer-console";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { identity, capabilities } = await requirePlatform();
  return <div className="admin-ux min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b bg-white px-5 py-4"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
      <Link href="/platform" aria-label="PIKAS Platform, inicio"><BrandLogo /></Link>
      <div className="flex min-w-0 flex-wrap items-center gap-3"><span className="min-w-0 break-words text-sm">{identity.person.displayName} · Plataforma</span>
        <form action="/api/auth/logout" method="post"><button className="btn-secondary">Cerrar sesión</button></form></div>
    </div></header>
    <nav aria-label="Plataforma" className="border-b bg-white"><div className="mx-auto flex max-w-6xl flex-wrap gap-1 px-3 py-2 sm:px-5">
      <PlatformNavLink href="/platform">Inicio</PlatformNavLink>
      {capabilities.includes("platform:tenant:lifecycle:read") && <PlatformNavLink href="/platform/clientes">Clientes</PlatformNavLink>}
      {capabilities.includes("platform:tenant:provision") && capabilities.includes("platform:customer_admin:provision") && <PlatformNavLink href="/platform/clientes/nuevo">Crear cliente</PlatformNavLink>}
      {capabilities.includes("platform:team:manage") && <PlatformNavLink href="/platform/equipo">Equipo de PIKAS</PlatformNavLink>}
      {capabilities.includes("platform:sandbox:pov:enter") && <PlatformNavLink href="/platform/demostracion">Demo</PlatformNavLink>}
    </div></nav>
    <main className="mx-auto max-w-6xl space-y-6 p-5 sm:p-8">{children}</main>
  </div>;
}
