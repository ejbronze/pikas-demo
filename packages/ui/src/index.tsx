"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
export function Brand({ compact = false }: { compact?: boolean }) { return <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-white/20 text-xl font-black">P</span>{!compact && <span className="text-xl font-black tracking-tight">PIKAS</span>}</div> }
export function Avatar({ name, className = "" }: { name: string; className?: string }) { const initials = name.split(" ").map((word) => word[0]).slice(0,2).join(""); return <span aria-hidden className={`grid size-11 shrink-0 place-items-center rounded-full bg-violet-100 font-black text-violet-700 ${className}`}>{initials}</span> }
export function EmptyState({ children }: { children: ReactNode }) { return <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div> }
export function DemoBadge() { return <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">Demostración</span> }
export function Button({ className="", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button className={`rounded-xl bg-blue-600 px-4 py-3 font-bold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:opacity-50 ${className}`} {...props} /> }

const MOCK_NOTICE_KEY = "pikas:mock-data-notice:v1";

export function MockDataNotice() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem(MOCK_NOTICE_KEY) !== "acknowledged") setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        sessionStorage.setItem(MOCK_NOTICE_KEY, "acknowledged");
        setOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  function acknowledge() {
    sessionStorage.setItem(MOCK_NOTICE_KEY, "acknowledged");
    setOpen(false);
  }

  if (!open) return null;

  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="presentation">
    <section aria-describedby="mock-notice-description" aria-labelledby="mock-notice-title" aria-modal="true" className="w-full max-w-md rounded-3xl bg-white p-6 text-slate-900 shadow-2xl" role="alertdialog">
      <div className="flex items-start gap-4">
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-100 text-2xl">⚠️</span>
        <div>
          <DemoBadge />
          <h2 className="mt-3 text-2xl font-black" id="mock-notice-title">Estás viendo datos simulados</h2>
        </div>
      </div>
      <p className="mt-4 leading-6 text-slate-600" id="mock-notice-description">Los nombres, saldos, movimientos, alergias, recargas, preórdenes y códigos QR de este sitio son ficticios. No se procesa dinero real ni debes introducir información financiera personal.</p>
      <Button autoFocus className="mt-6 w-full" onClick={acknowledge}>Entendido, continuar al demo</Button>
    </section>
  </div>;
}
