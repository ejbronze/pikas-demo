import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { requirePlatform } from "@/lib/platform/customer-console";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { identity, capabilities } = await requirePlatform();
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b bg-white px-5 py-4"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
      <Link href="/platform" aria-label="PIKAS Platform, inicio"><BrandLogo /></Link>
      <div className="flex items-center gap-4"><span className="text-sm">{identity.person.displayName} · Plataforma</span>
        <form action="/api/auth/logout" method="post"><button className="btn-outline">Cerrar sesión</button></form></div>
    </div></header>
    <nav aria-label="Plataforma" className="border-b bg-white"><div className="mx-auto flex max-w-6xl flex-wrap gap-5 px-5 py-3">
      <Link href="/platform">Inicio</Link>
      {capabilities.includes("platform:tenant:lifecycle:read") && <Link href="/platform/clientes">Clientes</Link>}
      {capabilities.includes("platform:tenant:provision") && capabilities.includes("platform:customer_admin:provision") && <Link href="/platform/clientes/nuevo">Nuevo cliente</Link>}
      {capabilities.includes("platform:sandbox:pov:enter") && <Link href="/platform/demostracion">Demostración</Link>}
    </div></nav>
    <main className="mx-auto max-w-6xl space-y-6 p-5 sm:p-8">{children}</main>
  </div>;
}
