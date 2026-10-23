"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Banknote, ChevronRight, Grid2X2, List, WalletCards } from "lucide-react";
import type { PosAccessContext } from "@/lib/pos/access-context";
import { ConnectedSale, type SaleState } from "../lib/pos/connected-sale";
import { formatMinor, parseCash, paymentIssue, type Receipt } from "../lib/pos/contracts";
import { formatReceiptTimestamp, useCatalogView } from "../lib/pos/presentation";
import { BrandLogo } from "./brand-logo";
import { ProductImage } from "./product-image";
import { DemoEnvironmentBar } from "./demo-environment-bar";
import { PosRefunds } from "./pos-refunds";
import { TaskActions, TaskCancelButton, TaskWindow } from "./task-window";

const roleLabel = (context: PosAccessContext) => context.memberships.some((m) => m.role_code === "pos_supervisor") ? "Supervisor" : "Cajero";
const tenderName = (t: "cash" | "student_wallet") => t === "cash" ? "Efectivo" : "PIKAS Cash";

export function PosAccessBanner({ context }: { context: PosAccessContext }) {
  if (!context.pov) return null;
  return <DemoEnvironmentBar pov={context.pov} persona={context.actor.display_name} context={context.memberships[0]?.account_name} />;
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
  const [demoLeaving, setDemoLeaving] = useState(false);
  const [registerDraft, setRegisterDraft] = useState("");
  const [departureNotice, setDepartureNotice] = useState("");
  const departureArmed = useRef(false);
  // Any change to the unsent work re-arms the departure warning.
  useEffect(() => { departureArmed.current = false; }, [state.cart, state.tender, state.cash, registerDraft]);
  const [workspace, setWorkspace] = useState<"sale" | "register" | "refunds">(initialWorkspace);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [view, setView] = useCatalogView(state.context.actor.person_id);
  const [showReceipt, setShowReceipt] = useState(false);
  // Wave E: in-app confirmation before a customer change discards the order (never silent).
  const [confirmChange, setConfirmChange] = useState<null | "change" | "search">(null);
  // Sales completed in this tab only (from authoritative receipts); never a history read.
  const [recent, setRecent] = useState<Receipt[]>([]);
  const [refundReceipt, setRefundReceipt] = useState<string | undefined>(undefined);
  // Cash collection is a focused task (TaskWindow); the payment screen never expands in place.
  const [cashTask, setCashTask] = useState(false);
  const receiptId = state.receipt?.purchase_id;
  useEffect(() => { const r = sale.getSnapshot().receipt; if (r) queueMicrotask(() => setRecent((list) => list.some((x) => x.purchase_id === r.purchase_id) ? list : [r, ...list].slice(0, 5))); }, [receiptId, sale]);
  const context = state.context;
  const scopes = context.memberships;
  const session = state.bootstrap?.session;
  const products = state.bootstrap?.catalog?.products ?? [];
  const currency = state.receipt?.currency_code ?? session?.currency_code ?? "DOP";
  const money = (n: string | bigint) => formatMinor(n, currency);
  const total = state.cart.length ? sale.total() : 0n;
  const frozen = demoLeaving || state.busy || Boolean(state.pending) || Boolean(state.registerPending) || state.recoveryBlocked;
  const ready = state.bootstrap?.blocked === null;
  const pc = state.purchaseContext;
  const anonymous=state.purchaserMode==="anonymous",purchaserReady=anonymous||Boolean(state.purchaserMode==="student"&&state.customer&&pc);
  const customerName=anonymous?"No Usuario":state.customer?.display_name;
  const issue = paymentIssue(pc,total,state.tender,state.cash,anonymous);
  const categories = ["Todas", ...new Set(products.map((p) => p.category_name ?? "Otros"))];
  const visible = products.filter((p) => (category === "Todas" || (p.category_name ?? "Otros") === category) && p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const reset = async () => { await sale.reset(); setSearch(""); setQuery(""); setCategory("Todas"); setShowReceipt(false); setConfirmChange(null); };
  const inProgress = !state.receipt && state.cart.length > 0;
  const itemCount = state.cart.reduce((n, l) => n + l.quantity, 0);
  const changeCustomer = (kind: "change" | "search") => { if (inProgress) { setConfirmChange(kind); return; } if (kind === "search") { setWorkspace("sale"); sale.identify(); } else void reset(); };
  const openRefund = (receipt: string) => { setRefundReceipt(receipt); setWorkspace("refunds"); };
  const priceOf = (id: string) => BigInt(products.find((p) => p.product_id === id)?.price_minor ?? "0");
  const received = state.tender === "cash" ? parseCash(state.cash) : null;
  return (
    <main className="pos-surface min-h-screen overflow-x-clip bg-slate-100 pb-28 sm:pb-16">
      <div className="sticky top-0 z-30">
        {context.pov ? <><header className="flex h-14 min-w-0 items-center gap-2 bg-pikas-navy px-3 text-white"><strong className="min-w-0 truncate">PIKAS · {scopes[0].cafeteria_name}</strong><span className="ml-auto shrink-0 text-xs">{context.actor.display_name} · {roleLabel(context)}</span></header><DemoEnvironmentBar pov={context.pov} persona={context.actor.display_name} context={scopes[0].account_name} beforeLeave={() => {
          const current = sale.getSnapshot();
          if (current.busy || current.registerPending || current.recoveryBlocked || (current.pending && !current.receipt)) {
            setDepartureNotice("Hay una operación pendiente de confirmar. Resuélvela antes de cambiar de experiencia o salir del demo."); return false;
          }
          const dirty = (!current.receipt && (current.cart.length > 0 || current.tender !== null || current.cash !== "")) || registerDraft !== "";
          // Wave F: in-app two-step warning (was window.confirm). The first attempt only warns; repeating it discards.
          if (dirty && !departureArmed.current) { departureArmed.current = true; setDepartureNotice("Tienes trabajo sin enviar (venta, pago o conteo de caja). Si cambias de experiencia o sales del demo se descartará; no se envía nada. Vuelve a elegir la opción para continuar."); return false; }
          departureArmed.current = false;
          if (!sale.discardForDemoDeparture()) { setDepartureNotice("No se pudo cerrar el seguimiento de la venta. Resuelve la operación antes de continuar."); return false; }
          setRegisterDraft(""); setDemoLeaving(true); return true;
        }} /></> : <>        <header className="flex flex-wrap items-center justify-between gap-3 bg-pikas-navy px-4 py-3 text-white">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-white p-1"><BrandLogo compact className="size-9" /></span>
            <div><strong>PIKAS · {scopes.map((s) => s.cafeteria_name).join(" · ")}</strong><p className="text-xs">{[...new Set(scopes.map((s) => s.account_name))].join(" · ")}</p></div>
          </div>
          <div className="flex items-center gap-3"><strong>{context.actor.display_name} · {roleLabel(context)}</strong><form action="/api/auth/logout" method="post"><button className="btn">Cerrar sesión</button></form></div>
        </header>
        <PosAccessBanner context={context} />
        {scopes[0].tenant_kind === "sandbox" && <p role="status" className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm font-bold text-amber-950">DEMO / SANDBOX · {scopes[0].cafeteria_name} · Datos de prueba</p>}
        <p className="border-b bg-white px-4 py-2 text-sm font-bold">Acceso POS autorizado{session ? ` · ${session.register_name_snapshot}` : ""}</p>
</>}
      </div>
      <div className="mx-auto max-w-[1440px] space-y-4 p-3 md:p-5">
        {departureNotice && <p role="alert" className="rounded-xl bg-amber-100 p-3">{departureNotice}</p>}
        {context.pov && session && <p className="text-xs text-slate-600">Al cambiar de experiencia, la caja permanecerá abierta.</p>}
        <fieldset disabled={demoLeaving} className="min-w-0 space-y-4 border-0 p-0">
        <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Espacios de trabajo POS">
          <div className="pos-workspace-tabs max-w-full flex-wrap"><button className={workspace === "sale" ? "pos-workspace-tab pos-workspace-tab-active" : "pos-workspace-tab"} aria-current={workspace === "sale" ? "page" : undefined} onClick={() => setWorkspace("sale")}>Venta</button><button className="pos-workspace-tab" disabled>Transacciones</button><button className={workspace === "refunds" ? "pos-workspace-tab pos-workspace-tab-active" : "pos-workspace-tab"} aria-current={workspace === "refunds" ? "page" : undefined} disabled={Boolean(context.pov)} onClick={() => setWorkspace("refunds")}>Reembolsos</button><button className={workspace === "register" ? "pos-workspace-tab pos-workspace-tab-active" : "pos-workspace-tab"} aria-current={workspace === "register" ? "page" : undefined} onClick={() => setWorkspace("register")}>Caja</button></div>
          <button className="btn pos-customer-search-action" disabled={!ready || frozen} onClick={() => changeCustomer("search")}>Buscar usuario PIKAS</button>
        </nav>
        {state.notice ? <p role="alert" className="rounded-xl bg-amber-100 p-4">{state.notice}</p> : null}
        {confirmChange ? <div role="alertdialog" aria-label="Cambiar cliente" className="card space-y-3 border-amber-300 bg-amber-50 p-4"><p className="font-black">¿Cambiar de cliente? Se vaciará la venta actual.</p><p className="text-sm">{itemCount} {itemCount === 1 ? "artículo" : "artículos"} · {money(total)} para {customerName}. No se cobra nada. El nuevo cliente tendrá su propio saldo, límites y restricciones; el pago se elegirá de nuevo.</p><div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => setConfirmChange(null)}>Seguir con esta venta</button><button className="btn" disabled={frozen} onClick={() => { const kind = confirmChange; setConfirmChange(null); if (kind === "search") { setWorkspace("sale"); sale.identify(); } else void reset(); }}>Vaciar y cambiar cliente</button></div></div> : null}
        {state.recoveryBlocked ? <p role="alert">La venta pendiente pertenece a otra sesión o no se puede recuperar. Vuelve a la sesión original; no inicies otra venta.</p> : null}
        {!state.bootstrap ? <p role="status">{state.busy ? "Verificando caja y catálogo…" : "Caja y catálogo sin confirmar."}</p> : state.bootstrap.blocked ? <p role="status" className="rounded-xl bg-amber-50 p-4">{state.bootstrap.blocked}</p> : null}
        {(!state.bootstrap || state.bootstrap.blocked) && !frozen ? <button className="btn-secondary" onClick={() => void sale.refresh()}>Verificar caja y catálogo</button> : null}
        {workspace === "register" ? <ConnectedRegister sale={sale} state={state} cash={registerDraft} setCash={setRegisterDraft} /> : null}
        {workspace === "refunds" ? session && !context.pov ? <PosRefunds key={refundReceipt ?? "manual"} actorId={context.actor.person_id} currency={session.currency_code} initialReceipt={refundReceipt} /> : <p role="status" className="card p-6">Abre una caja para registrar reembolsos.</p> : null}
        <div hidden={workspace !== "sale"}>
        {state.pending && !state.receipt && !state.recoveryBlocked ? <section className="card space-y-3 border-amber-300 p-6" role="alert"><h1 className="text-2xl font-black">Venta pendiente de confirmar</h1><p className="font-bold">{money(state.pending.request.expected_total_minor)} · {tenderName(state.pending.request.tender.type)} · {state.pending.request.items.reduce((n, i) => n + i.quantity, 0)} artículos{state.pending.request.cafeteria_customer_id === null ? " · No Usuario" : ""}</p><p>No sabemos si el cobro se registró. Reintentar envía exactamente la misma venta con la misma clave: no puede cobrarse dos veces. No inicies otra venta hasta conocer el resultado.</p><button className="btn" disabled={state.busy} onClick={() => void sale.retry()}>{state.busy ? "Confirmando…" : "Reintentar la misma venta"}</button></section> : null}
        {!state.pending && !state.recoveryBlocked && state.phase === "entry" ? <section className="card p-6 md:p-10"><span className="label">Paso 1 · Cliente</span><h1 className="mt-3 text-3xl font-black">¿A quién atendemos?</h1><div className="mt-8 grid gap-4 sm:grid-cols-2"><button className="btn min-h-28 text-xl" disabled={!ready || frozen} onClick={sale.identify}>Usuario PIKAS</button><button className="btn-secondary min-h-28 text-xl" disabled={!ready || frozen} onClick={sale.anonymous}>No Usuario</button></div>{recent.length ? <RecentSales recent={recent} money={money} onRefund={context.pov || !session ? undefined : openRefund} /> : null}</section> : null}
        {!state.pending && state.phase === "identity" ? <section className="card space-y-4 p-6"><h1 className="text-3xl font-black">Buscar usuario PIKAS</h1><form className="flex gap-3" onSubmit={(e) => { e.preventDefault(); void sale.search(search.trim()); }}><input className="field" aria-label="Nombre o código del estudiante" value={search} disabled={frozen} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o código del estudiante" /><button className="btn" disabled={frozen || search.trim().length < 2 || search.trim().length > 80 || /[%_\\]/.test(search)}>Buscar</button></form><div className="space-y-3">{state.customers.map((c) => <button className="btn-secondary w-full text-left" key={c.customer_id} disabled={frozen} onClick={() => void sale.select(c)}><strong>{c.display_name}</strong><span className="block text-sm">{[c.student_code, c.grade_label, c.class_label].filter(Boolean).join(" · ")}</span></button>)}</div><button className="btn-secondary" disabled={frozen} onClick={() => void reset()}>Cancelar venta</button></section> : null}
        {!state.pending && (state.phase === "items" || state.phase === "payment") ? <div className={state.phase === "items" ? "pos-venta-columns" : "space-y-4"}>
          <div className="pos-sale-top"><section className="card pos-customer-panel flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="label">Cliente</p><h2 className="text-xl font-black">{customerName}</h2><p>{state.customer?.grade_label}</p>{pc ? <><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm"><span>PIKAS Cash {pc.wallet ? money(pc.wallet.balance_minor) : "no disponible"}{pc.wallet?.status === "frozen" ? " · Congelado" : ""}</span><span>Gastado hoy {money(pc.spent_today_minor)}</span><span>{pc.daily_limit.enabled ? `Límite diario ${money(pc.daily_limit.limit_minor!)}` : "Sin límite diario"}</span><span>{pc.per_transaction_limit.enabled ? `Límite por compra ${money(pc.per_transaction_limit.limit_minor!)}` : "Sin límite por compra"}</span><span>Disponible hoy {money(pc.available_today_minor)}</span></div>{pc.restrictions.length ? <p role="alert" className="mt-2 font-bold text-amber-900">Restricciones: {pc.restrictions.map((r) => r.label).join(" · ")}. Revisa los ingredientes y alérgenos antes de vender.</p> : null}<p className="text-xs text-slate-500">Contexto confirmado: {pc.as_of}</p></> : <p role="status">{anonymous?"Venta en efectivo sin cuenta PIKAS.":"Contexto de compra sin confirmar."}</p>}</div><div className="pos-customer-actions">{!anonymous&&<button className="btn pos-replenish-action" disabled>Recargar saldo</button>}<button className="btn-secondary pos-change-action" disabled={frozen} onClick={() => changeCustomer("change")}>Cambiar cliente</button></div></section></div>
          {state.phase === "items" ? <div className="pos-catalog-and-cart">
            <section className="card pos-catalog-panel pos-catalog-shell p-4"><div className="pos-catalog-header"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-2xl font-black">Productos</h2><p className="text-sm text-slate-500">Toca un producto para añadirlo rápidamente</p></div><div className="pos-view-toggle" aria-label="Vista del catálogo"><button aria-label="Vista de galería" className={view === "gallery" ? "pos-view-toggle-active" : "pos-view-toggle-button"} aria-pressed={view === "gallery"} onClick={() => setView("gallery")}><Grid2X2 size={18} /></button><button aria-label="Vista de lista" className={view === "list" ? "pos-view-toggle-active" : "pos-view-toggle-button"} aria-pressed={view === "list"} onClick={() => setView("list")}><List size={20} /></button></div></div><input className="field mt-3" aria-label="Buscar producto" placeholder="Buscar producto" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Categorías de productos">{categories.map((c) => <button key={c} className={category === c ? "pos-filter-active" : "pos-filter"} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div></div><div className="pos-catalog-results"><p className="mt-2 text-sm text-slate-600" role="status">{visible.length} {visible.length === 1 ? "producto" : "productos"}{query || category !== "Todas" ? " con este filtro" : ""}</p>{!visible.length ? <div className="mt-3 rounded-xl border p-4"><p className="font-bold">{products.length ? "No hay productos con esta búsqueda." : "No hay productos disponibles para vender ahora."}</p>{(query || category !== "Todas") && <button className="btn-secondary mt-2" onClick={() => { setQuery(""); setCategory("Todas"); }}>Ver todos los productos</button>}</div> : null}{view === "gallery" ? <div className="pos-product-grid mt-4">{visible.map((p) => <article className="pos-product-tile" key={p.product_id}><button className="pos-product-hit pos-gallery-hit" aria-label={`Añadir ${p.name}`} disabled={frozen || !purchaserReady} onClick={() => sale.quantity(p.product_id, 1)}><ProductImage name={p.name} /><span className="pos-gallery-info"><strong className="block">{p.name}</strong><span className="mt-1 block">{money(p.price_minor)}</span></span><span className="pos-product-quantity">{state.cart.find((l) => l.product_id === p.product_id)?.quantity ?? 0}</span></button></article>)}</div> : <div className="pos-product-list mt-4">{visible.map((p) => <article className="pos-list-row" key={p.product_id}><button className="pos-list-hit pos-connected-list-hit" aria-label={`Añadir ${p.name}`} disabled={frozen || !purchaserReady} onClick={() => sale.quantity(p.product_id, 1)}><span className="pos-connected-list-info"><strong>{p.name}</strong><span className="pos-product-quantity">{state.cart.find((l) => l.product_id === p.product_id)?.quantity ?? 0}</span></span><strong className="pos-list-price">{money(p.price_minor)}</strong><span className="pos-list-add" aria-hidden="true">+</span></button></article>)}</div>}</div></section>
            <aside className="card h-fit p-5 lg:sticky lg:top-24" aria-label="Venta actual"><h2 className="text-2xl font-black">Venta actual</h2><p className="text-sm text-slate-600">{customerName} · {itemCount} {itemCount === 1 ? "artículo" : "artículos"}</p>{state.cart.length ? <ul className="mt-2 divide-y">{state.cart.map((l) => { const name = products.find((p) => p.product_id === l.product_id)?.name; return <li className="py-3" key={l.product_id}><div className="flex items-start justify-between gap-3"><strong className="min-w-0 break-words">{name}</strong><strong className="shrink-0 tabular-nums">{money(priceOf(l.product_id) * BigInt(l.quantity))}</strong></div><p className="text-sm text-slate-600">{money(priceOf(l.product_id))} c/u</p><div className="mt-2 flex items-center gap-2"><button className="btn-secondary" aria-label={`Reducir ${name}`} disabled={frozen} onClick={() => sale.quantity(l.product_id, -1)}>−</button><span className="min-w-8 text-center font-bold" aria-label={`Cantidad de ${name}`}>{l.quantity}</span><button className="btn-secondary" aria-label={`Aumentar ${name}`} disabled={frozen || l.quantity >= 20} onClick={() => sale.quantity(l.product_id, 1)}>+</button><button className="btn-tertiary ml-auto min-h-11" aria-label={`Quitar ${name}`} disabled={frozen} onClick={() => sale.quantity(l.product_id, -l.quantity)}>Quitar</button></div></li>; })}</ul> : <p className="mt-4">La venta está vacía. Toca un producto para añadirlo.</p>}<p className="my-4 flex items-baseline justify-between text-xl font-black"><span>Total</span><span className="tabular-nums">{money(total)}</span></p><button className="btn w-full" disabled={frozen || !state.cart.length || !purchaserReady} onClick={() => void sale.review()}>Continuar al pago</button><button className="btn-secondary mt-3 w-full" disabled={frozen} onClick={() => void reset()}>Cancelar venta</button></aside>
            {state.cart.length ? <div className="pos-order-bar lg:hidden" aria-label="Resumen de la venta"><span className="min-w-0"><span className="block text-xs">{itemCount} {itemCount === 1 ? "artículo" : "artículos"}</span><strong className="text-lg tabular-nums">{money(total)}</strong></span><button className="btn" disabled={frozen || !purchaserReady} onClick={() => void sale.review()}>Continuar al pago</button></div> : null}
          </div> : <section className="card pos-payment-review mx-auto max-w-2xl space-y-4 p-6"><h1 aria-label="Validación y pago" className="text-2xl font-black">Confirmar venta</h1><div className="pos-payment-summary"><p className="label">Cliente</p><p className="font-black">{customerName}</p><div className="mt-3 divide-y">{state.cart.map((l) => { const p = products.find((p) => p.product_id === l.product_id)!; return <p key={l.product_id} className="flex justify-between gap-3 py-2 text-sm"><span>{l.quantity} × {p.name}</span><strong>{money(BigInt(p.price_minor) * BigInt(l.quantity))}</strong></p>; })}</div></div><p className="flex items-baseline justify-between text-xl font-bold"><span>Total</span><span className="tabular-nums">{money(total)}</span></p>
            <fieldset className="space-y-3"><legend className="font-bold">Método de pago</legend><p role="status" className="text-sm">{state.tender===null?"Elige cómo paga el cliente.":`Seleccionado: ${tenderName(state.tender)}`}</p><div className="grid gap-3 sm:grid-cols-2">{!anonymous&&<button className={`pos-tender-option ${state.tender==="student_wallet"?"btn":"btn-secondary"}`} disabled={frozen} aria-pressed={state.tender === "student_wallet"} onClick={() => sale.setTender("student_wallet")}><WalletCards aria-hidden size={24} className="shrink-0" /><span className="min-w-0 flex-1"><span className="block">PIKAS Cash</span><span className="block text-sm font-normal">{pc?.wallet ? pc.wallet.status === "frozen" ? "Congelado" : `Disponible hoy ${money(pc.available_today_minor)}` : "No disponible"}</span></span></button>}<button className={`pos-tender-option ${state.tender==="cash"?"btn":"btn-secondary"}`} disabled={frozen} aria-pressed={state.tender === "cash"} aria-haspopup="dialog" onClick={() => { sale.setTender("cash"); setCashTask(true); }}><Banknote aria-hidden size={24} className="shrink-0" /><span className="min-w-0 flex-1"><span className="block">Efectivo</span><span className="block text-sm font-normal">{state.tender === "cash" && received !== null ? `Recibido ${money(received)}` : "Abre el cobro en efectivo"}</span></span><ChevronRight aria-hidden size={20} className="shrink-0" /></button></div></fieldset>
            {state.tender === "student_wallet" && pc ? <dl className="grid gap-x-4 gap-y-1 rounded-xl border p-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-600">Saldo PIKAS Cash</dt><dd className="font-bold">{pc.wallet ? money(pc.wallet.balance_minor) : "No disponible"}</dd></div><div><dt className="text-slate-600">Disponible hoy</dt><dd className="font-bold">{money(pc.available_today_minor)}</dd></div><div><dt className="text-slate-600">Límite diario</dt><dd>{pc.daily_limit.enabled ? `${money(pc.daily_limit.limit_minor!)} · gastado ${money(pc.spent_today_minor)}` : "Sin límite"}</dd></div><div><dt className="text-slate-600">Límite por compra</dt><dd>{pc.per_transaction_limit.enabled ? money(pc.per_transaction_limit.limit_minor!) : "Sin límite"}</dd></div><p className="text-xs text-slate-500 sm:col-span-2">Datos confirmados por PIKAS: {pc.as_of}. El cobro los verifica de nuevo.</p></dl> : null}
            {issue && state.tender === "student_wallet" ? <p role="alert" className="rounded-xl bg-amber-100 p-4">{issue}</p> : null}
            {state.tender === "cash" ? <button className="btn pos-payment-cta w-full" disabled={frozen} aria-haspopup="dialog" onClick={() => setCashTask(true)}>Cobrar {money(total)} en efectivo</button>
              : <button className="btn pos-payment-cta w-full" disabled={frozen || Boolean(issue)} onClick={() => void sale.checkout()}>{state.busy ? "Procesando…" : state.tender === null ? "Elige un método de pago" : `Cobrar ${money(total)} con PIKAS Cash`}</button>}<button className="btn-secondary w-full" disabled={frozen} onClick={sale.back}>Volver a productos</button></section>}
          {cashTask && state.phase === "payment" && state.tender === "cash" && !state.pending && !state.receipt ? <CashTask notice={state.notice} total={total} cash={state.cash} received={received} issue={issue} busy={state.busy} frozen={frozen} money={money} setCash={(v) => sale.setCash(v)} charge={() => void sale.checkout()} onClose={() => { if (!state.busy) { sale.setCash(""); setCashTask(false); } }} /> : null}
        </div> : null}
        {state.receipt ? <section className="card mx-auto max-w-2xl space-y-4 p-6" aria-labelledby="sale-done"><div role="status" className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><h1 id="sale-done" className="flex items-center gap-2 text-3xl font-black"><span aria-hidden className="grid size-9 place-items-center rounded-full bg-white text-xl">✓</span>Venta completada</h1><p className="text-lg font-bold">Recibo #{state.receipt.purchase_number} · {formatMinor(state.receipt.total_minor, state.receipt.currency_code)} · {tenderName(state.receipt.tender_type)}</p><p>{state.receipt.cafeteria_customer_id===null?"Cliente: No Usuario":state.receipt.customer_name}</p></div>
          {state.receipt.tender_type === "cash" ? <dl className="grid grid-cols-2 gap-3 text-lg"><div><dt className="text-sm text-slate-600">Recibido</dt><dd className="font-bold">{money(state.receipt.cash_received_minor!)}</dd></div><div><dt className="text-sm text-slate-600">Cambio a entregar</dt><dd className="text-2xl font-black">{money(state.receipt.change_due_minor!)}</dd></div></dl> : <p className="text-lg">Saldo PIKAS Cash después de la compra: <strong>{money(state.receipt.wallet_balance_after_minor!)}</strong></p>}
          <button className="btn w-full" data-autofocus disabled={state.busy} onClick={() => void reset()}>Nueva venta</button><button className="btn-secondary w-full" aria-expanded={showReceipt} onClick={() => setShowReceipt(!showReceipt)}>{showReceipt ? "Ocultar recibo" : "Ver recibo"}</button>{showReceipt ? <CommittedReceipt receipt={state.receipt} /> : null}
          <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled>Imprimir recibo</button>{!context.pov && session ? <button className="btn-secondary" disabled={state.busy} onClick={() => openRefund(state.receipt!.purchase_number)}>Reembolsar esta venta</button> : null}</div><p className="text-xs text-slate-500">La impresión no está disponible en esta versión del POS.</p></section> : null}
        </div>
        </fieldset>
      </div>
      <footer className="pos-status-bar" aria-label="Estado de caja"><strong>{session ? session.register_name_snapshot : "Caja sin confirmar"}</strong><span>· {context.pov ? "Sandbox · Cajero" : "POS"}</span><span>· {state.busy ? "Verificando…" : ready ? "Conectado" : "Venta bloqueada"}</span></footer>
    </main>
  );
}

// Sales completed in this browser tab (authoritative receipts already shown to this operator).
// It is not transaction history: it disappears on reload and never reads other sales.
function RecentSales({ recent, money, onRefund }: { recent: Receipt[]; money: (n: string | bigint) => string; onRefund?: (receipt: string) => void }) {
  return <section className="mt-8 space-y-2" aria-labelledby="recent-sales"><h2 id="recent-sales" className="font-black">Ventas recientes en esta pestaña</h2><ul className="divide-y rounded-xl border">{recent.map((r) => <li key={r.purchase_id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"><span className="min-w-0"><strong>Recibo #{r.purchase_number}</strong> · {formatReceiptTimestamp(r.purchased_at, r.business_timezone)}<span className="block text-slate-600">{r.cafeteria_customer_id === null ? "No Usuario" : r.customer_name} · {tenderName(r.tender_type)}</span></span><span className="flex items-center gap-3"><strong className="tabular-nums">{money(r.total_minor)}</strong>{onRefund ? <button className="btn-secondary" aria-label={`Reembolsar recibo ${r.purchase_number}`} onClick={() => onRefund(r.purchase_number)}>Reembolsar</button> : null}</span></li>)}</ul><p className="text-xs text-slate-500">Solo las ventas de esta pestaña; se borran al recargar. Para otras ventas, busca el recibo en Reembolsos.</p></section>;
}

export function CommittedReceipt({ receipt }: { receipt: Receipt }) {
  return (<article aria-label="Recibo de compra" className="space-y-2 border-t pt-4"><h2 className="text-xl font-black">Recibo #{receipt.purchase_number}</h2><p>{receipt.cafeteria_customer_id===null?"Cliente: No Usuario":receipt.customer_name} · <time dateTime={receipt.purchased_at}>{formatReceiptTimestamp(receipt.purchased_at, receipt.business_timezone)}</time></p>{receipt.items.map((i) => <p className="flex justify-between gap-3" key={i.product_id}><span>{i.quantity} × {i.name}</span><strong>{formatMinor(i.line_total_minor, receipt.currency_code)}</strong></p>)}<strong>Total {formatMinor(receipt.total_minor, receipt.currency_code)}</strong><p>Venta confirmada · {receipt.purchase_id}</p></article>);
}

// Cash denominations offered as shortcuts (unchanged set, minor units); only those above the amount
// due are useful, plus the exact amount. Change/shortfall use the same expressions as before.
const CASH_DENOMINATIONS = [5000, 10000, 20000, 50000, 100000, 200000];
export const usefulDenominations = (total: bigint) => CASH_DENOMINATIONS.filter((n) => BigInt(n) > total).slice(0, 4);
const exactCash = (total: bigint) => `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`;
function CashTask({ notice, total, cash, received, issue, busy, frozen, money, setCash, charge, onClose }: { notice: string | null | undefined; total: bigint; cash: string; received: string | null; issue: string | null; busy: boolean; frozen: boolean;
  money: (n: string | bigint) => string; setCash: (value: string) => void; charge: () => void; onClose: () => void }) {
  const short = received !== null && BigInt(received) < total;
  // Only outcomes of this task (e.g. a definite rejection of this charge) are shown inside it.
  const [openedWith] = useState(notice);
  const canCharge = !frozen && !issue;
  return <TaskWindow title="Cobro en efectivo" context={<>Total a cobrar <strong className="tabular-nums">{money(total)}</strong></>} busy={busy} dirty={cash !== ""} onClose={onClose}
    footer={<TaskActions><TaskCancelButton>Volver</TaskCancelButton><button type="submit" form="pos-cash-task" className="btn pos-payment-cta" disabled={!canCharge}>{busy ? "Procesando…" : `Cobrar ${money(total)}`}</button></TaskActions>}>
    <form id="pos-cash-task" className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); if (canCharge) charge(); }}>
      <p className="flex items-baseline justify-between gap-3 rounded-xl border bg-slate-50 p-4 text-lg font-bold"><span>Total a cobrar</span><span className="text-2xl font-black tabular-nums">{money(total)}</span></p>
      <label className="block font-bold">Monto recibido<input className="field mt-2 text-xl tabular-nums" inputMode="decimal" autoComplete="off" data-autofocus disabled={frozen} value={cash} onChange={(e) => setCash(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Montos rápidos"><button type="button" className="btn-secondary" disabled={frozen} aria-pressed={received !== null && BigInt(received) === total} onClick={() => setCash(exactCash(total))}>Monto exacto</button>{usefulDenominations(total).map((n) => <button type="button" className="btn-secondary" key={n} disabled={frozen} aria-pressed={received !== null && BigInt(received) === BigInt(n)} onClick={() => setCash(String(n / 100))}>{money(String(n))}</button>)}</div>
      <p className="flex items-baseline justify-between rounded-xl border p-4 text-xl font-black" role="status"><span>{short ? "Faltan" : "Cambio"}</span><span className="tabular-nums">{received === null ? "—" : short ? money(total - BigInt(received)) : money(BigInt(received) - total)}</span></p>
      {notice && notice !== openedWith ? <p role="alert" className="rounded-xl bg-amber-100 p-4">{notice}</p> : null}
      {issue && cash !== "" ? <p role="alert" className="rounded-xl bg-amber-100 p-4">{issue}</p> : null}
    </form>
  </TaskWindow>;
}

function ConnectedRegister({ sale, state, cash, setCash }: { sale: ConnectedSale; state: SaleState; cash: string; setCash: (value: string) => void }) {
  const [registerId, setRegisterId] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
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
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (session && !confirmClose) { setConfirmClose(true); return; } setConfirmClose(false); const operation = session ? sale.closeRegister(cash) : sale.openRegister(selected, cash); void operation.then(() => { if (!sale.getSnapshot().registerPending) setCash(""); }); }}>
      <label className="block font-bold">{session ? "Efectivo contado al cierre" : "Fondo inicial de efectivo"}<input className="field mt-2" inputMode="decimal" value={cash} disabled={blocked} onChange={(e) => { setConfirmClose(false); setCash(e.target.value); }} /></label>
      <p className="text-sm">{session ? "Cuenta el efectivo real en caja. Cerrar impide nuevas ventas en esta sesión." : "Registra el efectivo real antes de abrir."}</p>
      {state.cart.length || state.receipt || state.pending ? <p role="alert">Finaliza o cancela la venta antes de cambiar el estado de caja.</p> : null}
      {/* Wave F: in-app confirmation (was window.confirm). The blind count is unchanged: only the typed amount is shown. */}
      {confirmClose && session && parseCash(cash) !== null ? <div role="alertdialog" aria-label="Confirmar cierre de caja" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="font-bold">¿Cerrar la caja de forma permanente con {formatMinor(parseCash(cash)!, session.currency_code)} contados?</p><p className="text-sm">Después no podrás registrar más ventas en esta sesión.</p><button type="button" className="btn-secondary w-full" onClick={() => setConfirmClose(false)}>Seguir contando</button></div> : null}
      <button className="btn w-full" disabled={blocked || !state.bootstrap || parseCash(cash) === null || (!session && !selected)}>{session ? confirmClose && parseCash(cash) !== null ? `Cerrar caja con ${formatMinor(parseCash(cash)!, session.currency_code)}` : "Cerrar caja y registrar conteo" : "Abrir caja"}</button>
    </form>
  </section>;
}
