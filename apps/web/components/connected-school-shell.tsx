"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, ShieldCheck, Utensils, ReceiptText } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import type { SchoolContext } from "../lib/school/contracts";
const items = [["", "Resumen", Home], ["/estudiantes", "Estudiantes", Users], ["/administradores", "Administradores", ShieldCheck], ["/cafeterias", "Cafeterías conectadas", Utensils], ["/actividad", "Actividad", ReceiptText]] as const;
export function ConnectedSchoolShell({ context, schoolId, children }: { context: SchoolContext; schoolId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const scope = context.schools.find(s => s.school_id === schoolId)!;
  const nav = (mobile = false) => items.map(([suffix, label, Icon]) => {
    const path = `/admin/escuela${suffix}`;
    const active = pathname === path;
    return <Link key={path} href={`${path}?school=${schoolId}`} aria-current={active ? "page" : undefined} className={mobile ? `flex flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] ${active ? "text-indigo-700" : "text-slate-500"}` : `nav-link flex items-center gap-3 rounded-xl p-3 ${active ? "bg-white/15 text-white" : "text-slate-300"}`}><Icon size={mobile ? 18 : 20} />{label}</Link>;
  });
  return <div className="min-h-screen bg-slate-50 md:grid md:grid-cols-[250px_minmax(0,1fr)]">
    <aside className="sticky top-0 hidden h-screen flex-col bg-[#101c35] p-5 text-white md:flex"><BrandLogo compact /><p className="my-6 text-xs font-bold uppercase tracking-widest text-slate-400">PIKAS Admin</p><nav className="space-y-2">{nav()}</nav></aside>
    <div className="min-w-0 pb-20 md:pb-0"><header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-4 py-3 md:px-6"><div><p className="font-bold">{scope.school_name}</p><p className="text-xs text-slate-500">{scope.account_name} · {context.display_name}</p></div><form method="get"><label className="sr-only" htmlFor="workspace-school">Escuela</label><select className="field" id="workspace-school" name="school" defaultValue={schoolId}>{context.schools.map(s => <option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}</select><button className="btn-secondary ml-2" type="submit">Cambiar</button></form><form method="post" action="/api/auth/logout"><button className="btn-secondary">Salir</button></form></header>
    {scope.tenant_kind === "sandbox" && <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm font-bold text-amber-950" role="status">DEMO / SANDBOX · {scope.school_name} · Datos de prueba</div>}
    <main className="app-main mx-auto max-w-7xl space-y-5 p-4 sm:p-5 md:p-6">{children}</main></div>
    <nav className="fixed inset-x-0 bottom-0 z-40 grid min-h-16 grid-cols-5 border-t bg-white/95 md:hidden">{nav(true)}</nav>
  </div>;
}
