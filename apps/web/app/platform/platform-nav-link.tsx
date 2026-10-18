"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function PlatformNavLink({href,children}:{href:string;children:React.ReactNode}) {
 const path=usePathname();
 // Every page below a destination (customer detail, Nuevo cliente) keeps that destination current.
 const active=path===href||(href!=='/platform'&&path.startsWith(href+'/'));
 return <Link href={href} aria-current={active?'page':undefined} className={`inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold ${active?'bg-indigo-50 text-indigo-900':'text-slate-700 hover:bg-slate-50'}`}>{children}</Link>;
}
