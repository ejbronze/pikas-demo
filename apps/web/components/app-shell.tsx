"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import type {ComponentType} from "react";
import {
  Home,
  Users,
  ReceiptText,
  Utensils,
  UserRound,
  WalletCards,
  LogOut,
} from "./icons";
import {BrandLogo} from "./brand-logo";

type ShellRole = "parent" | "student";
type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{size?: number; className?: string}>;
  match: "exact" | "prefix";
  mobile: boolean;
};

const navigation: Record<ShellRole, readonly NavItem[]> = {
  parent: [
    {href: "/familias", label: "Inicio", icon: Home, match: "exact", mobile: true},
    {href: "/familias/estudiantes", label: "Estudiantes", icon: Users, match: "prefix", mobile: true},
    {href: "/familias/transacciones", label: "Movimientos", icon: ReceiptText, match: "prefix", mobile: true},
    {href: "/familias/preordenes", label: "Preórdenes", icon: Utensils, match: "prefix", mobile: true},
    {href: "/familias/perfil", label: "Perfil", icon: UserRound, match: "prefix", mobile: true},
  ],
  student: [
    {href: "/estudiante", label: "Inicio", icon: Home, match: "exact", mobile: true},
    {href: "/estudiante/menu", label: "Menú", icon: Utensils, match: "prefix", mobile: true},
    {href: "/estudiante/preordenes", label: "Pedidos", icon: ReceiptText, match: "prefix", mobile: true},
    {href: "/estudiante/transacciones", label: "Mis compras", icon: ReceiptText, match: "prefix", mobile: true},
    {href: "/estudiante/presupuesto", label: "Mi plan", icon: WalletCards, match: "prefix", mobile: false},
    {href: "/estudiante/perfil", label: "Perfil", icon: UserRound, match: "prefix", mobile: true},
  ],
};

function isCurrent(pathname: string, item: NavItem) {
  return item.match === "exact" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavigationLink({item, pathname, studentMode, mobile = false}: {
  item: NavItem;
  pathname: string;
  studentMode: boolean;
  mobile?: boolean;
}) {
  const current = isCurrent(pathname, item);
  const Icon = item.icon;
  return <Link
    aria-current={current ? "page" : undefined}
    className={mobile
      ? `flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-bold leading-tight ${current ? studentMode ? "bg-violet-50 text-violet-800" : "bg-blue-50 text-blue-800" : "text-slate-600"}`
      : `nav-link ${current ? studentMode ? "bg-white text-violet-900 shadow-sm" : "nav-active" : "text-white/80 hover:bg-white/10"}`}
    data-nav-label={item.label}
    href={item.href}
  >
    <Icon size={mobile ? 19 : 18}/>
    <span className={mobile ? "max-w-full truncate" : undefined}>{item.label}</span>
  </Link>;
}

export function AppShell({role, children}: {role: ShellRole; children: React.ReactNode}) {
  const pathname = usePathname();
  const items = navigation[role];
  const mobileItems = items.filter(item => item.mobile);
  const studentMode = role === "student";
  const home = studentMode ? "/estudiante" : "/familias";

  return <div
    className={`min-h-screen md:grid md:grid-cols-[240px_minmax(0,1fr)] ${studentMode ? "bg-violet-50/40" : "bg-slate-50"}`}
    data-role={role}
    data-testid="app-shell"
  >
    <aside
      className={`sticky top-0 hidden h-screen min-h-0 flex-col overflow-y-auto p-5 text-white md:flex ${studentMode ? "bg-violet-900" : "bg-pikas-900"}`}
      data-testid="desktop-sidebar"
    >
      <Link href={home} className="flex min-h-11 items-center" aria-label="PIKAS, inicio"><span className="rounded-xl bg-white p-1"><BrandLogo compact className="size-9"/></span><span className="ml-2 text-lg font-black">PIKAS</span></Link>
      <p className="mt-2 text-xs font-bold uppercase tracking-widest text-white/60">{studentMode ? "Estudiante" : "Familias"}</p>
      <nav className="mt-8 space-y-1" aria-label="Navegación principal">
        {items.map(item => <NavigationLink key={item.href} item={item} pathname={pathname} studentMode={studentMode}/>) }
      </nav>
      <form action="/api/auth/logout" method="post" className="mt-auto pt-6">
        <button className="nav-link w-full text-white/70 hover:bg-white/10 hover:text-white">
          <LogOut size={18}/>
          Cerrar sesión
        </button>
      </form>
    </aside>

    <div className="min-w-0" data-testid="shell-content">
      <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-6">
        <Link href={home} className="flex min-h-11 items-center md:hidden" aria-label="PIKAS, inicio"><BrandLogo compact className="size-9"/></Link>
        <div className="hidden min-w-0 md:block">
          <span className="label">{studentMode ? "Mi espacio" : "Portal familiar"}</span>
          <p className="truncate text-sm font-bold">{studentMode ? "¡Hola, Sofi!" : "Familia Rosa"}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-950">Modo demo</span>
          <form action="/api/auth/logout" method="post" className="md:hidden">
            <button aria-label="Cerrar sesión" className="grid size-11 place-items-center rounded-xl text-slate-600 hover:bg-slate-100">
              <LogOut size={19}/>
            </button>
          </form>
        </div>
      </header>
      <main className="app-main mx-auto min-w-0 max-w-7xl p-4 sm:p-5 md:p-6" data-testid="shell-main">{children}</main>
      <nav className="mobile-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white/95 px-1 pt-1 backdrop-blur md:hidden" aria-label="Navegación móvil" data-testid="mobile-navigation">
        {mobileItems.map(item => <NavigationLink key={item.href} item={item} pathname={pathname} studentMode={studentMode} mobile/>) }
      </nav>
    </div>
  </div>;
}
