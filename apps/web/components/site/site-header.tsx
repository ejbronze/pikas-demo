"use client";
// Public header: logo, section navigation and sign-in. On phones the sections live in a disclosure panel that
// closes on navigation, Escape or a second tap; the sign-in action stays visible at every width.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "../brand-logo";
import { site } from "./content";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return <header className="site-header">
    <div className="site-wrap site-header-row">
      <Link href="/" className="site-logo" aria-label="PIKAS, inicio"><BrandLogo priority className="h-auto w-28 sm:w-32" /></Link>
      <nav aria-label="Secciones" className="site-nav-desktop">
        {site.nav.map(item => <a key={item.href} href={item.href}>{item.label}</a>)}
      </nav>
      <div className="site-header-actions">
        <Link className="site-btn site-btn-primary site-btn-sm" href="/login">{site.signIn}</Link>
        <button ref={toggle} type="button" className="site-menu-toggle" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(o => !o)}>
          <span aria-hidden className="site-menu-icon" data-open={open || undefined}><i /><i /><i /></span>
          <span className="sr-only">{open ? "Cerrar menú" : "Abrir menú"}</span>
        </button>
      </div>
    </div>
    <nav id="site-menu" aria-label="Secciones" className="site-nav-mobile" hidden={!open}>
      <div className="site-wrap">{site.nav.map(item => <a key={item.href} href={item.href} onClick={() => setOpen(false)}>{item.label}</a>)}</div>
    </nav>
  </header>;
}
