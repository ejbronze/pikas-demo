"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Grid2X2, List } from "lucide-react";
import type { PosAccessContext } from "@/lib/pos/access-context";
import { ConnectedSale, type SaleState } from "../lib/pos/connected-sale";
import { formatMinor, parseCash, paymentIssue, type Receipt } from "../lib/pos/contracts";
import { formatReceiptTimestamp, useCatalogView } from "../lib/pos/presentation";
import { BrandLogo } from "./brand-logo";
import { ProductImage } from "./product-image";

export function PosAccessBanner({ context }: { context: PosAccessContext }) {
  if (!context.pov) return null;
  const scope = context.memberships[0];
  return (
    <section aria-label="Demostración sandbox activa" className="border-b-2 border-amber-400 bg-amber-50 px-4 py-2 text-amber-950 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <p className="font-black">Modo demostración · Sandbox</p>
      <p className="font-bold">{context.actor.display_name} · Cajero</p>
      <p>{scope.account_name} · {scope.cafeteria_name}</p>
    </section>
  );
}

export function ConnectedPosDashboard({ context, initialWorkspace = "sale" }: { context: PosAccessContext; initialWorkspace?: "sale" | "register" }) {
  const [sale] = useState(() => new ConnectedSale(context));
  const state = useSyncExternalStore(sale.subscribe, sale.getSnapshot, sale.getSnapshot);
  useEffect(() => { void sale.start({
    getItem: (key) => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: (key) => window.sessionStorage.removeItem(key),
  }); }, [sale]);
  return <ConnectedPosView sale={sale} state={state} initialWorkspace={initialWorkspace} />;
}

// Presentation retains the existing POS classes, steps and controls. All connected actions use the
// authenticated adapter; it never imports the demo provider, financial helpers, history or printing.
export function ConnectedPosView({ sale, state, initialWorkspace = "sale" }: { sale: ConnectedSale; state: SaleState; initialWorkspace?: "sale" | "register" }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [view, setView] = useCatalogView(state.context.actor.person_id);
  const [showReceipt, setShowReceipt] = useState(false);
  const context = state.context;
  const scopes = context.memberships;
  const session = state.bootstrap?.session;
  const products = state.bootstrap?.catalog?.products ?? [];
  const currency = state.receipt?.currency_code ?? session?.currency_code ?? "DOP";
  const money = (n: string | bigint) => formatMinor(n, currency);
  const total = state.cart.length ? sale.total() : 0n;
  const frozen = state.busy || Boolean(state.pending) || Boolean(state.registerPending) || state.recoveryBlocked;
  const ready = state.bootstrap?.blocked === null;
  const pc = state.purchaseContext;
  const issue = pc ? paymentIssue(pc, total, state.tender, state.cash) : "No hay contexto de compra confirmado.";
  const categories = ["Todas", ...new Set(products.map((p) => p.category_name ?? "Otros"))];
  const visible = products.filter((p) => (category === "Todas" || (p.category_name ?? "Otros") === category) && p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const reset = async () => { await sale.reset(); setSearch(""); setQuery(""); setCategory("Todas"); setShowReceipt(false); };
  return (
    <main className="pos-surface min-h-screen overflow-x-clip bg-slate-100 pb-28 sm:pb-16">
      <div className="sticky top-0 z-30">
        <header className="flex flex-wrap items-center justify-between gap-3 bg-pikas-navy px-4 py-3 text-white">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-white p-1"><BrandLogo compact className="size-9" /></span>
            <div><strong>PIKAS · {scopes.map((s) => s.cafeteria_name).join(" · ")}</strong><p className="text-xs">{[...new Set(scopes.map((s) => s.account_name))].join(" · ")}</p></div>
          </div>
          <div className="flex items-center gap-3"><strong>{context.actor.display_name}</strong>{context.pov ? <a className="text-sm underline" href="/platform">Volver a Backoffice</a> : null}<form action="/api/auth/logout" method="post"><button className="btn">Salir</button></form></div>
        </header>
        <PosAccessBanner context={context} />
        <p className="border-b bg-white px-4 py-2 text-sm font-bold">Acceso POS autorizado{session ? ` · ${session.register_name_snapshot}` : ""}</p>
      </div>
      <div className="mx-auto max-w-[1440px] space-y-4 p-3 md:p-5">
        <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Espacios de trabajo POS">
          <div className="pos-workspace-tabs"><button className={workspace === "sale" ? "pos-workspace-tab pos-workspace-tab-active" : "pos-workspace-tab"} aria-current={workspace === "sale" ? "page" : undefined} onClick={() => setWorkspace("sale")}>Venta</button><button className="pos-workspace-tab" disabled>Transacciones</button><button className={workspace === "register" ? "pos-workspace-tab pos-workspace-tab-active" : "pos-workspace-tab"} aria-current={workspace === "register" ? "page" : undefined} onClick={() => setWorkspace("register")}>Caja</button></div>
          <button className="btn pos-customer-search-action" disabled={!ready || frozen} onClick={() => { setWorkspace("sale"); sale.identify(); }}>Buscar usuario PIKAS</button>
        </nav>
        {state.notice ? <p role="alert" className="rounded-xl bg-amber-100 p-4">{state.notice}</p> : null}
        {state.recoveryBlocked ? <p role="alert">La venta pendiente pertenece a otra sesión o no se puede recuperar. Vuelve a la sesión original; no inicies otra venta.</p> : null}
        {!state.bootstrap ? <p role="status">{state.busy ? "Verificando caja y catálogo…" : "Caja y catálogo sin confirmar."}</p> : state.bootstrap.blocked ? <p role="status" className="rounded-xl bg-amber-50 p-4">{state.bootstrap.blocked}</p> : null}
        {(!state.bootstrap || state.bootstrap.blocked) && !frozen ? <button className="btn-secondary" onClick={() => void sale.refresh()}>Verificar caja y catálogo</button> : null}
        {workspace === "register" ? <ConnectedRegister sale={sale} state={state} /> : null}
        <div hidden={workspace !== "sale"}>
        {state.pending && !state.receipt && !state.recoveryBlocked ? <section className="card space-y-3 p-6"><h1 className="text-2xl font-black">Confirmar venta pendiente</h1><p>Reintentar conserva la misma clave y el mismo cobro. No inicies otra venta hasta conocer el resultado.</p><button className="btn" disabled={state.busy} onClick={() => void sale.retry()}>Reintentar misma venta</button></section> : null}
        {!state.pending && !state.recoveryBlocked && state.phase === "entry" ? <section className="card p-6 md:p-10"><span className="label">Paso 1 · Cliente</span><h1 className="mt-3 text-3xl font-black">¿A quién atendemos?</h1><div className="mt-8 grid gap-4 sm:grid-cols-2"><button className="btn min-h-28 text-xl" disabled={!ready || frozen} onClick={sale.identify}>Usuario PIKAS</button><button className="btn-secondary min-h-28 text-xl" disabled>No usuario</button></div></section> : null}
        {!state.pending && state.phase === "identity" ? <section className="card space-y-4 p-6"><h1 className="text-3xl font-black">Buscar usuario PIKAS</h1><form className="flex gap-3" onSubmit={(e) => { e.preventDefault(); void sale.search(search.trim()); }}><input className="field" aria-label="Nombre o código del estudiante" value={search} disabled={frozen} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o código del estudiante" /><button className="btn" disabled={frozen || search.trim().length < 2 || search.trim().length > 80 || /[%_\\]/.test(search)}>Buscar</button></form><div className="space-y-3">{state.customers.map((c) => <button className="btn-secondary w-full text-left" key={c.customer_id} disabled={frozen} onClick={() => void sale.select(c)}><strong>{c.display_name}</strong><span className="block text-sm">{[c.student_code, c.grade_label, c.class_label].filter(Boolean).join(" · ")}</span></button>)}</div><button className="btn-secondary" disabled={frozen} onClick={() => void reset()}>Cancelar venta</button></section> : null}
        {!state.pending && (state.phase === "items" || state.phase === "payment") ? <div className={state.phase === "items" ? "pos-venta-columns" : "space-y-4"}>
          <div className="pos-sale-top"><section className="card pos-customer-panel flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="label">Cliente</p><h2 className="text-xl font-black">{state.customer?.display_name}</h2><p>{state.customer?.grade_label}</p>{pc ? <><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm"><span>Saldo PIKAS {pc.wallet ? money(pc.wallet.balance_minor) : "no disponible"}{pc.wallet?.status === "frozen" ? " · Congelado" : ""}</span><span>Gastado hoy {money(pc.spent_today_minor)}</span><span>{pc.daily_limit.enabled ? `Límite diario ${money(pc.daily_limit.limit_minor!)}` : "Sin límite diario"}</span><span>{pc.per_transaction_limit.enabled ? `Límite por compra ${money(pc.per_transaction_limit.limit_minor!)}` : "Sin límite por compra"}</span><span>Disponible hoy {money(pc.available_today_minor)}</span></div>{pc.restrictions.length ? <p role="alert" className="mt-2 font-bold text-amber-900">Restricciones: {pc.restrictions.map((r) => r.label).join(" · ")}. Revisa los ingredientes y alérgenos antes de vender.</p> : null}<p className="text-xs text-slate-500">Contexto confirmado: {pc.as_of}</p></> : <p role="status">Contexto de compra sin confirmar.</p>}</div><div className="pos-customer-actions"><button className="btn pos-replenish-action" disabled>Recargar saldo</button><button className="btn-secondary pos-change-action" disabled={frozen} onClick={() => void reset()}>Cambiar cliente</button></div></section></div>
          {state.phase === "items" ? <div className="pos-catalog-and-cart">
            <section className="card pos-catalog-panel pos-catalog-shell p-4"><div className="pos-catalog-header"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-2xl font-black">Productos</h2><p className="text-sm text-slate-500">Toca un producto para añadirlo rápidamente</p></div><div className="pos-view-toggle" aria-label="Vista del catálogo"><button aria-label="Vista de galería" className={view === "gallery" ? "pos-view-toggle-active" : "pos-view-toggle-button"} aria-pressed={view === "gallery"} onClick={() => setView("gallery")}><Grid2X2 size={18} /></button><button aria-label="Vista de lista" className={view === "list" ? "pos-view-toggle-active" : "pos-view-toggle-button"} aria-pressed={view === "list"} onClick={() => setView("list")}><List size={20} /></button></div></div><input className="field mt-3" aria-label="Buscar producto" placeholder="Buscar producto" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Categorías de productos">{categories.map((c) => <button key={c} className={category === c ? "pos-filter-active" : "pos-filter"} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div></div><div className="pos-catalog-results">{view === "gallery" ? <div className="pos-product-grid mt-4">{visible.map((p) => <article className="pos-product-tile" key={p.product_id}><button className="pos-product-hit pos-gallery-hit" aria-label={`Añadir ${p.name}`} disabled={frozen || !pc} onClick={() => sale.quantity(p.product_id, 1)}><ProductImage name={p.name} /><span className="pos-gallery-info"><strong className="block">{p.name}</strong><span className="mt-1 block">{money(p.price_minor)}</span></span><span className="pos-product-quantity">{state.cart.find((l) => l.product_id === p.product_id)?.quantity ?? 0}</span></button></article>)}</div> : <div className="pos-product-list mt-4">{visible.map((p) => <article className="pos-list-row" key={p.product_id}><button className="pos-list-hit pos-connected-list-hit" aria-label={`Añadir ${p.name}`} disabled={frozen || !pc} onClick={() => sale.quantity(p.product_id, 1)}><span className="pos-connected-list-info"><strong>{p.name}</strong><span className="pos-product-quantity">{state.cart.find((l) => l.product_id === p.product_id)?.quantity ?? 0}</span></span><strong className="pos-list-price">{money(p.price_minor)}</strong><span className="pos-list-add" aria-hidden="true">+</span></button></article>)}</div>}</div></section>
            <aside className="card h-fit p-5 lg:sticky lg:top-24"><h2 className="text-2xl font-black">Venta actual</h2>{state.cart.length ? state.cart.map((l) => <div className="border-b py-3" key={l.product_id}><strong>{products.find((p) => p.product_id === l.product_id)?.name}</strong><div className="mt-2 flex items-center gap-3"><button className="btn-secondary" aria-label="Reducir cantidad" disabled={frozen} onClick={() => sale.quantity(l.product_id, -1)}>−</button><span>{l.quantity}</span><button className="btn-secondary" aria-label="Aumentar cantidad" disabled={frozen || l.quantity >= 20} onClick={() => sale.quantity(l.product_id, 1)}>+</button></div></div>) : <p className="mt-4">La venta está vacía.</p>}<p className="my-4 text-xl font-black">Total {money(total)}</p><button className="btn w-full" disabled={frozen || !state.cart.length || !pc} onClick={() => void sale.review()}>Continuar al pago</button><button className="btn-secondary mt-3 w-full" disabled={frozen} onClick={() => void reset()}>Cancelar venta</button></aside>
          </div> : <section className="card pos-payment-review mx-auto max-w-2xl space-y-4 p-6"><h1 aria-label="Validación y pago" className="text-2xl font-black">Confirmar venta</h1><div className="pos-payment-summary"><p className="label">Cliente</p><p className="font-black">{state.customer?.display_name}</p><div className="mt-3 divide-y">{state.cart.map((l) => { const p = products.find((p) => p.product_id === l.product_id)!; return <p key={l.product_id} className="flex justify-between gap-3 py-2 text-sm"><span>{l.quantity} × {p.name}</span><strong>{money(BigInt(p.price_minor) * BigInt(l.quantity))}</strong></p>; })}</div></div><p className="text-xl font-bold">Total {money(total)}</p><div className="flex flex-wrap gap-3"><button className="btn-secondary" disabled={frozen} aria-pressed={state.tender === "student_wallet"} onClick={() => sale.setTender("student_wallet")}>Saldo PIKAS</button><button className="btn-secondary" disabled={frozen} aria-pressed={state.tender === "cash"} onClick={() => sale.setTender("cash")}>Elegir efectivo</button></div>{state.tender === "cash" ? <><label className="block font-bold">Efectivo recibido ({currency})<input className="field mt-2" inputMode="decimal" disabled={frozen} value={state.cash} onChange={(e) => sale.setCash(e.target.value)} /></label><div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={frozen} onClick={() => sale.setCash(`${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`)}>Monto exacto</button>{[5000, 10000, 20000, 50000, 100000, 200000].map((n) => <button className="btn-secondary" key={n} disabled={frozen} onClick={() => sale.setCash(String(n / 100))}>{money(String(n))}</button>)}</div><p className="text-xl font-black">Cambio: {money(BigInt(parseCash(state.cash) ?? "0") >= total ? BigInt(parseCash(state.cash) ?? "0") - total : 0n)}</p></> : null}{issue ? <p role="alert" className="rounded-xl bg-amber-100 p-4">{issue}</p> : null}<button className="btn pos-payment-cta w-full" disabled={frozen || Boolean(issue)} onClick={() => void sale.checkout()}>{state.busy ? "Procesando…" : `Cobrar ${money(total)}`}</button><button className="btn-secondary w-full" disabled={frozen} onClick={sale.back}>Volver a productos</button></section>}
        </div> : null}
        {state.receipt ? <section className="card mx-auto max-w-2xl space-y-4 p-6"><h1 className="text-3xl font-black">Compra completada</h1><p>#{state.receipt.purchase_number} · {state.receipt.customer_name}</p><p role="status">{state.receipt.tender_type === "cash" ? "Efectivo" : "Saldo PIKAS"} · {formatMinor(state.receipt.total_minor, state.receipt.currency_code)}</p>{state.receipt.tender_type === "cash" ? <p>Recibido {money(state.receipt.cash_received_minor!)} · Cambio {money(state.receipt.change_due_minor!)}</p> : <p>Saldo después de la compra {money(state.receipt.wallet_balance_after_minor!)}</p>}<button className="btn w-full" disabled={state.busy} onClick={() => void reset()}>Nueva transacción</button><button className="btn-secondary w-full" onClick={() => setShowReceipt(!showReceipt)}>Ver recibo</button>{showReceipt ? <CommittedReceipt receipt={state.receipt} /> : null}<button className="btn-secondary" disabled>Imprimir recibo</button></section> : null}
        </div>
      </div>
      <footer className="pos-status-bar" aria-label="Estado de caja"><strong>{session ? session.register_name_snapshot : "Caja sin confirmar"}</strong><span>· {context.pov ? "Sandbox · Cajero" : "POS"}</span><span>· {state.busy ? "Verificando…" : ready ? "Conectado" : "Venta bloqueada"}</span></footer>
    </main>
  );
}

export function CommittedReceipt({ receipt }: { receipt: Receipt }) {
  return (<article aria-label="Recibo de compra" className="space-y-2 border-t pt-4"><h2 className="text-xl font-black">Recibo #{receipt.purchase_number}</h2><p>{receipt.customer_name} · <time dateTime={receipt.purchased_at}>{formatReceiptTimestamp(receipt.purchased_at, receipt.business_timezone)}</time></p>{receipt.items.map((i) => <p className="flex justify-between gap-3" key={i.product_id}><span>{i.quantity} × {i.name}</span><strong>{formatMinor(i.line_total_minor, receipt.currency_code)}</strong></p>)}<strong>Total {formatMinor(receipt.total_minor, receipt.currency_code)}</strong><p>Venta confirmada · {receipt.purchase_id}</p></article>);
}

function ConnectedRegister({ sale, state }: { sale: ConnectedSale; state: SaleState }) {
  const [registerId, setRegisterId] = useState("");
  const [cash, setCash] = useState("");
  const session = state.bootstrap?.session;
  const registers = state.bootstrap?.registers ?? [];
  const selected = registerId || registers[0]?.register_id || "";
  const pending = state.registerPending;
  const blocked = state.busy || state.recoveryBlocked || Boolean(state.pending) || Boolean(pending) || Boolean(state.receipt) || Boolean(state.cart.length);
  return <section className="card mx-auto max-w-2xl space-y-4 p-6">
    <h1 className="text-3xl font-black">Caja</h1>
    {!state.bootstrap ? <p role="status">Estado de caja sin confirmar.</p> : session ? <><p className="font-bold">Caja abierta · {session.register_name_snapshot}</p><p>Fondo inicial: {formatMinor(session.opening_cash_minor, session.currency_code)}</p><p className="text-sm">La sesión existente se recuperó automáticamente.</p></> : <p>{registers.length ? "Abre una caja asignada para comenzar a vender." : "No tienes cajas operables asignadas. Solicita una asignación antes de vender."}</p>}
    {pending ? <><p role="alert">Operación de caja pendiente de confirmar. Reintentar conserva la misma clave y los mismos importes.</p><button className="btn" disabled={state.busy || state.recoveryBlocked} onClick={() => void sale.retryRegister()}>Reintentar misma operación de caja</button></> : null}
    {!session ? <label className="block font-bold">Caja asignada<select className="field mt-2" value={selected} disabled={blocked} onChange={(e) => setRegisterId(e.target.value)}>{registers.map((r) => <option key={r.register_id} value={r.register_id}>{r.display_name} · {r.register_code}</option>)}</select></label> : null}
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const operation = session ? sale.closeRegister(cash) : sale.openRegister(selected, cash); void operation.then(() => { if (!sale.getSnapshot().registerPending) setCash(""); }); }}>
      <label className="block font-bold">{session ? "Efectivo contado al cierre" : "Fondo inicial de efectivo"}<input className="field mt-2" inputMode="decimal" value={cash} disabled={blocked} onChange={(e) => setCash(e.target.value)} /></label>
      <p className="text-sm">{session ? "Cuenta el efectivo real en caja. Cerrar impide nuevas ventas en esta sesión." : "Registra el efectivo real antes de abrir."}</p>
      {state.cart.length || state.receipt || state.pending ? <p role="alert">Finaliza o cancela la venta antes de cambiar el estado de caja.</p> : null}
      <button className="btn w-full" disabled={blocked || !state.bootstrap || parseCash(cash) === null || (!session && !selected)}>{session ? "Cerrar caja y registrar conteo" : "Abrir caja"}</button>
    </form>
  </section>;
}
