import type { PosAccessContext } from "@/lib/pos/access-context";
import { BrandLogo } from "./brand-logo";

export function PosAccessBanner({ context }: { context: PosAccessContext }) {
  if (!context.pov) return null;
  const scope = context.memberships[0];
  return (
    <section aria-label="Demostración sandbox activa" className="border-b-2 border-amber-400 bg-amber-50 px-4 py-3 text-amber-950">
      <p className="font-black">Modo demostración · Sandbox</p>
      <p className="font-bold">{context.actor.display_name} · Cajero</p>
      <p>{scope.account_name} · {scope.cafeteria_name}</p>
      <p className="text-sm">Demostración activa. Las operaciones POS todavía no están disponibles.</p>
    </section>
  );
}

// The existing POS surface and entry controls, with no provider, operational data or write handlers.
export function ConnectedPosDashboard({ context }: { context: PosAccessContext }) {
  const scopes = context.memberships;
  return (
    <main className="pos-surface min-h-screen overflow-x-clip bg-slate-100 pb-28 sm:pb-16">
      <div className="sticky top-0 z-30">
        <header className="flex flex-wrap items-center justify-between gap-3 bg-pikas-navy px-4 py-3 text-white">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-white p-1"><BrandLogo compact className="size-9" /></span>
            <div>
              <strong>PIKAS · {scopes.map((scope) => scope.cafeteria_name).join(" · ")}</strong>
              <p className="text-xs">{[...new Set(scopes.map((scope) => scope.account_name))].join(" · ")}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <strong>{context.actor.display_name}</strong>
            <form action="/api/auth/logout" method="post"><button className="btn">Salir</button></form>
          </div>
        </header>
        <PosAccessBanner context={context} />
        <p className="border-b bg-white px-4 py-2 text-sm font-bold">Acceso POS autorizado</p>
      </div>
      <div className="mx-auto max-w-[1440px] space-y-4 p-3 md:p-5">
        <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Espacios de trabajo POS">
          <div className="pos-workspace-tabs">
            <button className="pos-workspace-tab pos-workspace-tab-active" aria-current="page" disabled>Venta</button>
            <button className="pos-workspace-tab" disabled>Transacciones</button>
            <button className="pos-workspace-tab" disabled>Caja</button>
          </div>
          <button className="btn pos-customer-search-action" disabled>Buscar usuario PIKAS</button>
        </nav>
        <p role="status" className="rounded-xl bg-amber-50 p-4">
          Las operaciones de caja, productos, clientes, ventas y recibos todavía no están disponibles.
          No se muestran saldos ni datos de demostración local.
        </p>
        <section className="card p-6 md:p-10">
          <span className="label">Paso 1 · Cliente</span>
          <h1 className="mt-3 text-3xl font-black">¿A quién atendemos?</h1>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <button className="btn min-h-28 text-xl" disabled>Usuario PIKAS</button>
            <button className="btn-secondary min-h-28 text-xl" disabled>No usuario</button>
          </div>
        </section>
      </div>
      <footer className="pos-status-bar" aria-label="Estado de caja">
        <strong>Acceso verificado</strong>
        <span>· {context.pov ? "Sandbox · Cajero" : "POS"}</span>
        <span>· Operaciones no disponibles</span>
      </footer>
    </main>
  );
}
