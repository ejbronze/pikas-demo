"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, CircleUser, Home, LogOut, MonitorPlay, MoreHorizontal, ReceiptText, ShieldCheck, Users, UsersRound, Utensils, WalletCards } from "lucide-react";
import { BrandLogo } from "./brand-logo";

// Wave C: one structural shell for Platform, Account, School and Cafeteria administration.
// It renders only what the server already decided: navigation items, context, account and whether
// logout belongs here (never inside a Demo persona). No authority is derived in the browser.
const icons = { home: Home, users: Users, shield: ShieldCheck, utensils: Utensils, receipt: ReceiptText, chart: BarChart3, wallet: WalletCards, clients: Building2, team: UsersRound, demo: MonitorPlay } as const;
export type ShellIcon = keyof typeof icons;
export type ShellNavItem = { href: string; label: string; icon: ShellIcon; match: string; exact?: boolean };
export type ShellSwitcher = { id: string; name: string; label: string; value: string; options: { value: string; label: string }[] };
const tones = {
  navy: { aside: "bg-[#101c35]", active: "bg-white text-[#101c35]", idle: "text-slate-300 hover:bg-white/10", mobileActive: "bg-indigo-50 text-indigo-900" },
  teal: { aside: "bg-teal-950", active: "bg-white text-teal-950", idle: "text-white/80 hover:bg-white/10", mobileActive: "bg-teal-50 text-teal-950" },
};
export const isCurrent = (path: string, item: Pick<ShellNavItem, "match" | "exact">) => path === item.match || (!item.exact && path.startsWith(item.match + "/"));

function ContextSwitcher({ switcher, compact = false }: { switcher: ShellSwitcher; compact?: boolean }) {
  return <form method="get" className={`flex min-w-0 items-center gap-2 ${compact ? "w-full" : "max-w-sm"}`}>
    <label className="sr-only" htmlFor={`${switcher.id}${compact ? "-menu" : ""}`}>{switcher.label}</label>
    <select className="field min-w-0 flex-1" id={`${switcher.id}${compact ? "-menu" : ""}`} name={switcher.name} defaultValue={switcher.value}>{switcher.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    <button className="btn-secondary shrink-0" type="submit">Cambiar</button>
  </form>;
}

export function AdministrativeShell({ tone, area, homeHref, context, switcher, nav, navLabel, account, logout, demo, notice, children }: {
  tone: keyof typeof tones; area: string; homeHref: string;
  context?: { label: string; name: string; detail?: string };
  switcher?: ShellSwitcher; nav: ShellNavItem[]; navLabel: string;
  account: { name: string; role: string }; logout: boolean;
  demo?: React.ReactNode; notice?: React.ReactNode; children: React.ReactNode;
}) {
  const path = usePathname();
  const t = tones[tone];
  const canSwitch = !!switcher && switcher.options.length > 1;
  const overflow = nav.length > 5;
  const primary = overflow ? nav.slice(0, 4) : nav, extra = overflow ? nav.slice(4) : [];
  const extraCurrent = extra.find(item => isCurrent(path, item));
  const closeOnEscape = (event: React.KeyboardEvent<HTMLDetailsElement>) => {
    const details = event.currentTarget;
    if (event.key === "Escape" && details.open) { details.open = false; details.querySelector("summary")?.focus(); }
  };
  const link = (item: ShellNavItem, variant: "side" | "mobile" | "menu") => {
    const Icon = icons[item.icon], current = isCurrent(path, item);
    const className = variant === "side" ? `nav-link ${current ? t.active : t.idle}`
      : variant === "menu" ? `nav-link ${current ? t.mobileActive : "text-slate-700 hover:bg-slate-50"}`
      : `flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-bold leading-tight ${current ? t.mobileActive : "text-slate-600"}`;
    return <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined} className={className}
      onClick={variant === "menu" ? event => event.currentTarget.closest("details")?.removeAttribute("open") : undefined}>
      <Icon aria-hidden className="shrink-0" size={18} /><span className={variant === "mobile" ? "max-w-full hyphens-auto text-center" : "min-w-0 break-words"}>{item.label}</span></Link>;
  };
  const logoutForm = (className: string) => <form method="post" action="/api/auth/logout"><button className={className}><LogOut aria-hidden size={18} />Cerrar sesión</button></form>;
  return <div className="admin-ux min-h-screen bg-slate-50 md:grid md:grid-cols-[216px_minmax(0,1fr)] lg:grid-cols-[248px_minmax(0,1fr)]" data-testid="admin-shell">
    <aside className={`sticky top-0 hidden h-screen flex-col overflow-y-auto p-3 text-white md:flex lg:p-4 ${t.aside}`}>
      <Link href={homeHref} className="flex min-h-11 items-center gap-2 rounded-xl"><span className="rounded-xl bg-white p-1"><BrandLogo compact className="size-8" /></span><span className="font-black">PIKAS Admin</span></Link>
      <p className="mt-2 px-1 text-xs font-bold uppercase tracking-widest text-white/70">{area}</p>
      <nav className="mt-6 space-y-1" aria-label={navLabel}>{nav.map(item => link(item, "side"))}</nav>
      <div className="mt-auto space-y-2 border-t border-white/15 pt-3">
        <p className="flex items-start gap-2 px-1 text-sm"><CircleUser aria-hidden className="mt-0.5 shrink-0" size={18} /><span className="min-w-0 break-words"><span className="block font-bold">{account.name}</span><span className="block text-xs text-white/70">{account.role}</span></span></p>
        {logout && logoutForm(`nav-link w-full ${t.idle}`)}
      </div>
    </aside>
    <div className="min-w-0">
      <header className={`${demo ? "" : "sticky top-0 z-30 "}flex h-14 min-w-0 items-center gap-3 border-b bg-white/95 px-3 md:px-6`}>
        <Link href={homeHref} aria-label="PIKAS Admin, inicio" className="grid min-h-11 min-w-11 shrink-0 place-items-center md:hidden"><BrandLogo compact className="size-8" /></Link>
        {context && <div className="min-w-0 flex-1 leading-tight"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{context.label}</p><p className="truncate text-sm font-bold">{context.name}{context.detail && <span className="font-normal text-slate-500"> · {context.detail}</span>}</p></div>}
        {!context && <div className="flex-1" />}
        {canSwitch && <div className="hidden md:block"><ContextSwitcher switcher={switcher} /></div>}
        <details className="relative md:hidden" onKeyDown={closeOnEscape}>
          <summary aria-label="Cuenta y sesión" className="grid size-11 cursor-pointer list-none place-items-center rounded-xl text-slate-700 [&::-webkit-details-marker]:hidden"><CircleUser aria-hidden size={22} /></summary>
          <div className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.5rem)] space-y-3 rounded-xl border bg-white p-3 shadow-lg">
            <p className="text-sm"><span className="block font-bold">{account.name}</span><span className="text-slate-500">{account.role}</span></p>
            {canSwitch && <ContextSwitcher switcher={switcher} compact />}
            {logout && logoutForm("btn-secondary w-full")}
          </div>
        </details>
      </header>
      {demo}
      {notice}
      <main className="app-main mx-auto min-w-0 max-w-7xl space-y-5 break-words p-4 sm:p-5 md:p-6">{children}</main>
    </div>
    <nav className="mobile-nav fixed inset-x-0 bottom-0 z-30 grid gap-1 border-t bg-white/95 p-1 md:hidden" style={{ gridTemplateColumns: `repeat(${primary.length + (overflow ? 1 : 0)}, minmax(0, 1fr))` }} aria-label={`${navLabel} (móvil)`}>
      {primary.map(item => link(item, "mobile"))}
      {overflow && <details className="relative min-w-0" onKeyDown={closeOnEscape}>
        <summary aria-label={extraCurrent ? `Más destinos · Actual: ${extraCurrent.label}` : "Más destinos"} className={`flex min-h-14 cursor-pointer list-none flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center text-[11px] font-bold leading-tight [&::-webkit-details-marker]:hidden ${extraCurrent ? t.mobileActive : "text-slate-600"}`}><MoreHorizontal aria-hidden size={18} /><span className="max-w-full hyphens-auto">{extraCurrent ? extraCurrent.label : "Más"}</span></summary>
        <div className="absolute bottom-full right-0 mb-2 w-72 max-w-[calc(100vw-1rem)] rounded-xl border bg-white p-2 shadow-lg">{extra.map(item => link(item, "menu"))}</div>
      </details>}
    </nav>
  </div>;
}
