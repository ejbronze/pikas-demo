"use client";
import { useEffect, useRef, useState } from "react";
import { Grid2X2, List, Search } from "lucide-react";
import {
  CASH_DENOMINATIONS_MINOR,
  parseMoney,
  quickAccess,
  checkoutCustomer,
  validateCashPurchase,
  validateGeneralCashPurchase,
  validatePosPurchase,
  posValidationMessage,
  type PosCartLine,
  type PosPurchaseRecord,
} from "@pikas/data-access";
import { BrandLogo } from "./brand-logo";
import { ProductImage } from "./product-image";
import { usePosDemo } from "./demo-provider";
import { PosHistory, PurchaseDetail, posMoney as money } from "./pos-tools";
import { PosCalculator } from "./pos-calculator";
const cartKey = "pikas:pos-cart:v1";
type Step = "entry" | "identity" | "items" | "payment" | "completed";
type CatalogView = "gallery" | "list";
export function PosDashboard({ demo }: { demo: boolean }) {
  const {
    state,
    connection,
    retryConnection,
    lookupStudentForPos,
    searchPosCustomers,
    selectPosCustomer,
    posCustomer,
    checkoutPos,
    recoverCheckout,
    replenishPos,
    voidPos,
  } = usePosDemo();
  const [step, setStep] = useState<Step>("entry"),
    [studentId, setStudentId] = useState<string | null>(null),
    [general, setGeneral] = useState(false);
  const playSaleSound = () => { try { const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 880; gain.gain.setValueAtTime(0.05, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16); oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.16); } catch {} };
  const [code, setCode] = useState(""),
    [cart, setCart] = useState<PosCartLine[]>([]),
    [mode, setMode] = useState<"student_wallet" | "cash">("student_wallet");
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("Todos"),
    [catalogView, setCatalogView] = useState<CatalogView>("gallery"),
    [notice, setNotice] = useState(""),
    [lookupError, setLookupError] = useState("");
  const [cash, setCash] = useState(""),
    [replenish, setReplenish] = useState(false),
    [amount, setAmount] = useState("500"),
    [history, setHistory] = useState(false);
  const [completed, setCompleted] = useState<PosPurchaseRecord | null>(null),
    [receipt, setReceipt] = useState(false),
    [ready, setReady] = useState(false),
    [dark, setDark] = useState(false),
    [busy, setBusy] = useState(false);
  const recovery = useRef(recoverCheckout);
  const key = useRef(""),
    replenishKey = useRef(""),
    submitting = useRef(false);
  useEffect(() => {
    let active = true;
    const restore = async () => {
      key.current = crypto.randomUUID();
      replenishKey.current = crypto.randomUUID();
      try {
        const saved = localStorage.getItem(cartKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.cart)) setCart(parsed.cart);
          if (typeof parsed.key === "string" && parsed.key.length > 0)
            key.current = parsed.key;
          if (parsed.mode === "cash") setMode("cash");
          if (parsed.cart?.length && demo) {
            const recovered = await recovery.current(key.current);
            if (!active) return;
            if (recovered.ok && recovered.purchase) {
              setCompleted(recovered.purchase);
              setCart([]);
              key.current = crypto.randomUUID();
              setStep("completed");
            } else if (!recovered.ok) setNotice(recovered.message);
          }
        }
        setDark(localStorage.getItem("pikas:pos-theme") === "dark");
        const savedView = sessionStorage.getItem("pikas:pos-catalog-view");
        if (savedView === "gallery" || savedView === "list")
          setCatalogView(savedView);
      } catch {
        setNotice("No se pudo recuperar el carrito guardado.");
      }
      if (active) setReady(true);
    };
    void restore();
    return () => {
      active = false;
    };
  }, [demo]);
  useEffect(() => {
    if (ready)
      try {
        sessionStorage.setItem("pikas:pos-catalog-view", catalogView);
      } catch {}
  }, [catalogView, ready]);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(
          cartKey,
          JSON.stringify({ cart, mode, key: key.current }),
        );
      } catch {}
  }, [cart, mode, ready]);
  const operator = state.administration.users.find((u) => u.id === "pos-1");
  const student = studentId ? posCustomer(studentId) : null,
    posStudent = student ? checkoutCustomer(student, mode) : null;
  const total = cart.reduce(
    (sum, line) =>
      sum +
      (state.menuItems.find((i) => i.id === line.itemId)?.priceMinor ?? 0) *
        line.quantity,
    0,
  );
  const cashMinor = parseMoney(cash),
    policy = state.posPolicy;
  const scopeMissing = Boolean(studentId && !posStudent);
  const validation = posStudent
    ? (mode === "cash" ? validateCashPurchase : validatePosPurchase)(
        posStudent,
        state.menuItems,
        cart,
      )
    : validateGeneralCashPurchase(state.menuItems, cart);
  const recommendations = studentId
    ? student?.scopes.includes("restrictions")
      ? quickAccess(
          state.menuItems,
          student.scopes.includes("transactions")
            ? state.purchases
            : state.purchases.map((p) => ({ ...p, studentId: null })),
          {
            id: student.id,
            preferredName: student.preferredName,
            grade: student.grade,
            code: student.code,
            school: "",
            status: student.status,
            walletStatus: "active",
            balanceMinor: 0,
            dailyLimitMinor: 0,
            perTransactionLimitMinor: 0,
            spentTodayMinor: 0,
            allergies: student.allergies!,
            blockedProducts: student.blockedProducts!,
            blockedProductIds: student.blockedProductIds!,
          },
          "cafeteria-demo",
          "principal",
          new Date().toISOString(),
        )
      : { cafeteria: [], customer: [] }
    : quickAccess(
        state.menuItems,
        state.purchases,
        undefined,
        "cafeteria-demo",
        "principal",
        new Date().toISOString(),
      );
  const categories = [
    "Todos",
    ...(student ? ["Frecuentes"] : []),
    ...new Set(state.menuItems.map((i) => i.category)),
  ];
  const quickItems = recommendations.cafeteria;
  const frequentIds = new Set(recommendations.customer.map((i) => i.id));
  const visibleItems = state.menuItems.filter(
    (item) =>
      (category === "Todos" ||
        (category === "Frecuentes" && frequentIds.has(item.id)) ||
        item.category === category) &&
      item.name.toLowerCase().includes(query.toLowerCase()),
  );
  const alphabeticalItems = [...visibleItems].sort((a, b) =>
    a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
  );
  const letterGroups = alphabeticalItems.reduce<
    Array<{ letter: string; items: typeof alphabeticalItems }>
  >((groups, item) => {
    const letter = item.name.charAt(0).toLocaleUpperCase("es");
    const group = groups.find((current) => current.letter === letter);
    if (group) group.items.push(item);
    else groups.push({ letter, items: [item] });
    return groups;
  }, []);
  const shift = state.purchases.filter(
    (p) =>
      p.cashierId === "pos-1" &&
      p.posStationId === "caja-1" &&
      p.createdAt >= state.shiftStartedAt,
  );
  const reset = () => {
    setStep("entry");
    setStudentId(null);
    setGeneral(false);
    setCart([]);
    setCash("");
    setNotice("");
    setCode("");
    setCompleted(null);
    setReceipt(false);
    setReplenish(false);
    setMode("student_wallet");
    setHistory(false);
    key.current = crypto.randomUUID();
  };
  const select = (rawCode: string) => {
    const result = lookupStudentForPos(rawCode);
    if (!result.ok) {
      setLookupError(
        result.reason === "ambiguous_code"
          ? "Código ambiguo. Solicita un código único a la escuela."
          : "No encontramos un estudiante activo autorizado con ese código.",
      );
      return;
    }
    setStudentId(result.student.id);
    setGeneral(false);
    setLookupError("");
    setNotice("");
    setStep("items");
  };
  const selectId = (id: string) => {
    const selected = selectPosCustomer(id);
    if (!selected) {
      setLookupError("Cliente no autorizado.");
      return;
    }
    setStudentId(selected.id);
    setGeneral(false);
    setLookupError("");
    setNotice("");
    setStep("items");
  };
  const changeCustomer = () => {
    setStep("entry");
    setStudentId(null);
    setGeneral(false);
    setCode("");
    setNotice("");
  };
  const add = (id: string) => {
    setCart((current) => {
      const line = current.find((l) => l.itemId === id);
      return line
        ? current.map((l) =>
            l.itemId === id
              ? { ...l, quantity: Math.min(20, l.quantity + 1) }
              : l,
          )
        : [...current, { itemId: id, quantity: 1 }];
    });
    setNotice("");
  };
  const reconnect = async () => {
    await retryConnection();
    if (cart.length) {
      const result = await recoverCheckout(key.current);
      if (result.ok && result.purchase) {
        setCompleted(result.purchase);
        setCart([]);
        key.current = crypto.randomUUID();
        setStep("completed");
        setNotice("");
      } else if (!result.ok) setNotice(result.message);
    }
  };
  const complete = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    const result = await checkoutPos(
      studentId,
      cart,
      key.current,
      mode,
      cashMinor ?? undefined,
      general,
    );
    if (result.ok) {
      setCompleted(result.purchase);
      key.current = crypto.randomUUID();
      setCart([]);
      setStep("completed");
      setNotice("");
      playSaleSound();
    } else setNotice(result.message);
    setBusy(false);
    submitting.current = false;
  };
  const restriction = (id: string) => {
    if (studentId && !student?.scopes.includes("restrictions"))
      return "Sin permiso para verificar restricciones. No se puede añadir este producto.";
    const item = state.menuItems.find((i) => i.id === id)!;
    const v = student
      ? validateCashPurchase(
          {
            id: student.id,
            preferredName: student.preferredName,
            code: student.code,
            grade: student.grade,
            school: "",
            status: student.status,
            walletStatus: "active",
            balanceMinor: 0,
            dailyLimitMinor: 0,
            spentTodayMinor: 0,
            allergies: student.allergies!,
            blockedProducts: student.blockedProducts!,
            blockedProductIds: student.blockedProductIds!,
            dailyLimitEnabled: false,
            perTransactionLimitMinor: Number.MAX_SAFE_INTEGER,
          },
          [item],
          [{ itemId: id, quantity: 1 }],
        )
      : validateGeneralCashPurchase([item], [{ itemId: id, quantity: 1 }]);
    return v.ok ? null : posValidationMessage(v);
  };
  return (
    <main
      className={`pos-surface min-h-screen overflow-x-clip pb-28 sm:pb-16 ${dark ? "pos-dark" : "bg-slate-100"}`}
    >
      <div className="sticky top-0 z-30">
        <header className="flex flex-wrap items-center justify-between gap-3 bg-pikas-navy px-4 py-3 text-white">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-white p-1">
              <BrandLogo compact className="size-9" />
            </span>
            <div>
              <strong>PIKAS · {state.administration.cafeteria.name}</strong>
              <p className="text-xs">
                {state.administration.cafeteria.location}
                {policy.showRegister ? " · Caja 1" : ""}
              </p>
            </div>
          </div>
          <details className="relative">
            <summary className="min-h-11 cursor-pointer py-3 font-bold">
              {operator?.name ?? "Caja Demo"}
            </summary>
            <div className="absolute right-0 z-40 w-64 rounded-xl border bg-white p-4 text-slate-900 shadow-lg">
              <p>Operador POS{policy.showRegister ? " · Caja 1" : ""}</p>
              <button
                className="btn-secondary mt-3 w-full"
                onClick={() => {
                  setDark(!dark);
                  localStorage.setItem(
                    "pikas:pos-theme",
                    dark ? "light" : "dark",
                  );
                }}
              >
                {dark ? "Modo claro" : "Modo oscuro"}
              </button>
              <form action="/api/auth/logout" method="post">
                <button className="btn mt-3 w-full">Salir</button>
              </form>
            </div>
          </details>
        </header>
        <p className="border-b bg-white px-4 py-2 text-sm font-bold">
          {step === "completed"
            ? "Transacción completada"
            : step === "payment"
              ? `${mode === "cash" ? "Pago en efectivo" : "Saldo PIKAS"} · ${money(total)} por pagar`
              : student
                ? `Usuario PIKAS: ${student.preferredName} · ${cart.reduce((n, l) => n + l.quantity, 0)} artículos · ${money(total)}`
                : general
                  ? `No usuario · ${cart.reduce((n, l) => n + l.quantity, 0)} artículos · ${money(total)}`
                  : "Nueva transacción"}
        </p>
      </div>
      <div className="mx-auto max-w-[1440px] space-y-4 p-3 md:p-5">
        {!demo ? (
          <section className="card p-6">
            <h1 className="text-2xl font-black">POS Supabase en integración</h1>
            <p>
              Operaciones financieras remotas deshabilitadas hasta verificar
              persistencia y autorización.
            </p>
          </section>
        ) : !ready ? (
          <p>Preparando caja…</p>
        ) : operator?.status !== "active" ? (
          <h1 className="card p-6 text-2xl font-black">
            Acceso de caja suspendido
          </h1>
        ) : (
          <>
            <nav
              className="flex flex-wrap items-center justify-between gap-3"
              aria-label="Espacios de trabajo POS"
            >
              <div className="pos-workspace-tabs">
                <button
                  className={
                    history
                      ? "pos-workspace-tab"
                      : "pos-workspace-tab pos-workspace-tab-active"
                  }
                  aria-current={history ? undefined : "page"}
                  onClick={() => setHistory(false)}
                >
                  Venta
                </button>
                <button
                  className={
                    history
                      ? "pos-workspace-tab pos-workspace-tab-active"
                      : "pos-workspace-tab"
                  }
                  aria-current={history ? "page" : undefined}
                  onClick={() => setHistory(true)}
                >
                  Transacciones
                </button>
              </div>
              <div className="pos-tool-actions"><button className="btn pos-customer-search-action" aria-label="Buscar usuario PIKAS" onClick={()=>{setCode("");setLookupError("");setNotice("");setStep("identity")}}><Search size={18} aria-hidden="true" />Buscar usuario PIKAS</button><PosCalculator /></div>
            </nav>
            {connection !== "Online" ? (
              <p
                role="alert"
                className="rounded-xl bg-amber-100 p-4 text-amber-950"
              >
                No se puede confirmar el estado financiero. Las operaciones
                están bloqueadas.{" "}
                <button
                  className="btn-secondary ml-2"
                  onClick={() => {
                    void reconnect();
                  }}
                >
                  Reintentar conexión
                </button>
              </p>
            ) : null}
            {history ? (
              <PosHistory />
            ) : (
              <>
                {step === "entry" ? (
                  <section className="card p-6 md:p-10">
                    <span className="label">Paso 1 · Cliente</span>
                    <h1 className="mt-3 text-3xl font-black">
                      ¿A quién atendemos?
                    </h1>
                    <div className="mt-6 grid gap-4 sm:grid-cols-2">
                      <button
                        className="btn min-h-28 text-xl"
                        onClick={() => {
                          setMode("student_wallet");
                          setStep("identity");
                        }}
                      >
                        Usuario PIKAS
                      </button>
                      <button
                        className="btn-secondary min-h-28 text-xl"
                        onClick={() => {
                          setGeneral(true);
                          setStudentId(null);
                          setMode("cash");
                          setStep("items");
                        }}
                      >
                        No usuario
                      </button>
                    </div>
                    {cart.length ? (
                      <p className="mt-4">
                        Carrito conservado:{" "}
                        {cart.reduce((n, l) => n + l.quantity, 0)} artículos ·{" "}
                        {money(total)}
                      </p>
                    ) : null}
                  </section>
                ) : null}
                {step === "identity" ? (
                  <section className="card p-6">
                    <h1 className="text-2xl font-black">
                      Buscar usuario PIKAS
                    </h1>
                    <form
                      className="mt-4 max-w-xl space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        select(code);
                      }}
                    >
                      <label className="block font-bold" htmlFor="student-code">
                        Nombre o código estudiantil
                      </label>
                      <input
                        autoFocus
                        id="student-code"
                        aria-label="Código estudiantil / NFC"
                        className="field"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="Sofi o PK-10982"
                      />
                      <button
                        className="btn"
                        disabled={connection !== "Online"}
                      >
                        Comprobar estudiante
                      </button>
                      {lookupError ? (
                        <p id="lookup-error" role="alert">
                          {lookupError}
                        </p>
                      ) : null}
                    </form>
                    <div className="mt-4 grid gap-2">
                      {searchPosCustomers(code).map((s) => (
                        <button
                          className="btn-secondary justify-start"
                          key={s.id}
                          onClick={() => selectId(s.id)}
                        >
                          {s.name} · {s.grade} · •••{s.code.slice(-3)}
                        </button>
                      ))}
                    </div>
                    <button
                      className="btn-secondary mt-4"
                      onClick={changeCustomer}
                    >
                      Cambiar cliente
                    </button>
                  </section>
                ) : null}
                {step === "items" || step === "payment" ? (
                  <>
                    <div className="pos-venta-columns">
                    <div className="pos-sale-top">
                      <section className="card pos-customer-panel flex flex-wrap items-center justify-between gap-3 p-4">
                        <div>
                          <p className="label">Cliente</p>
                          <h2 className="text-xl font-black">
                            {student?.preferredName ?? "No usuario"}
                          </h2>
                          {student ? (
                            <>
                              <p>{student.grade}</p>
                              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                <span>
                                  {student.scopes.includes("balance")
                                    ? `Saldo PIKAS ${money(student.balanceMinor!)}`
                                    : "Saldo no disponible"}
                                </span>
                                {student.scopes.includes("limits") ? (
                                  <span>
                                    {student.dailyLimitEnabled === false
                                      ? "Sin límite diario"
                                      : `Permitido hoy: ${money(Math.max(0, student.dailyLimitMinor! - student.spentTodayMinor!))}`}
                                  </span>
                                ) : null}
                              </div>
                              {scopeMissing ? (
                                <p role="alert">
                                  Faltan permisos de la conexión para este pago.
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <p>Venta general en efectivo</p>
                          )}
                        </div>
                        <div className="pos-customer-actions">
                          {step === "items" &&
                          student?.scopes.includes("balance") ? (
                            <button
                              className="btn pos-replenish-action"
                              onClick={() => setReplenish(!replenish)}
                            >
                              Recargar saldo
                            </button>
                          ) : null}
                          <button className="btn-secondary pos-change-action" onClick={changeCustomer}>Cambiar cliente</button>
                        </div>
                      </section>
                      {step === "items" && quickItems.length ? (
                        <section className="card pos-popular-panel p-4">
                          <section>
                            <div className="pos-popular-heading"><h2 aria-label="Top 5 cafetería" className="text-lg font-black">Popular · Top 5</h2><span aria-hidden="true">→</span></div>
                            <div className="pos-popular-list mt-3">
                              {quickItems.map((i) => (
                                <button
                                  className="pos-popular-item"
                                  key={i.id}
                                  onClick={() => add(i.id)}
                                >
                                  <span
                                    className="pos-popular-thumb"
                                    aria-hidden="true"
                                  >
                                    {i.name.slice(0, 1)}
                                  </span>
                                  <span className="min-w-0 flex-1 text-left">
                                    <strong className="block truncate">
                                      {i.name}
                                    </strong>
                                    <span className="block text-sm">
                                      {money(i.priceMinor)}
                                    </span>
                                  </span>
                                  <span className="pos-product-quantity">
                                    {cart.find((line) => line.itemId === i.id)
                                      ?.quantity ?? 0}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </section>
                        </section>
                      ) : null}
                    </div>
                    {step === "items" ? (
                      <div className="pos-catalog-and-cart">
                        <section className="card pos-catalog-panel pos-catalog-shell p-4">
                          <div className="pos-catalog-header">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <h2 className="text-2xl font-black">Productos</h2>
                              <p className="text-sm text-slate-500">
                                Toca un producto para añadirlo rápidamente
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="chip">
                                {visibleItems.length} productos
                              </span>
                              <div
                                className="pos-view-toggle"
                                aria-label="Vista del catálogo"
                              >
                                <button
                                  className={
                                    catalogView === "gallery"
                                      ? "pos-view-toggle-active"
                                      : "pos-view-toggle-button"
                                  }
                                  aria-label="Vista de galería"
                                  aria-pressed={catalogView === "gallery"}
                                  title="Vista de galería"
                                  onClick={() => setCatalogView("gallery")}
                                >
                                  <Grid2X2 size={18} aria-hidden="true" />
                                </button>
                                <button
                                  className={
                                    catalogView === "list"
                                      ? "pos-view-toggle-active"
                                      : "pos-view-toggle-button"
                                  }
                                  aria-label="Vista de lista"
                                  aria-pressed={catalogView === "list"}
                                  title="Vista de lista"
                                  onClick={() => setCatalogView("list")}
                                >
                                  <List size={20} aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                            </div>
                            <input
                            className="field mt-3"
                            aria-label="Buscar producto"
                            placeholder="Buscar producto"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            />
                            <div
                            className="mt-3 flex gap-2 overflow-x-auto pb-1"
                            aria-label="Categorías de productos"
                          >
                            {categories.map((c) => (
                              <button
                                className={
                                  category === c
                                    ? "pos-filter-active"
                                    : "pos-filter"
                                }
                                aria-pressed={category === c}
                                key={c}
                                onClick={() => setCategory(c)}
                              >
                                {c}
                              </button>
                            ))}
                            </div>
                          </div>
                          <div className="pos-catalog-results">
                          {catalogView === "gallery" ? (
                            <div className="pos-product-grid mt-4">
                              {visibleItems.map((item) => {
                                const blocked = restriction(item.id),
                                  line = cart.find(
                                    (current) => current.itemId === item.id,
                                  ),
                                  stateLabel = !item.available
                                    ? "No disponible"
                                    : blocked
                                      ? "Restringido"
                                      : null;
                                return (
                                  <article
                                    className={`pos-product-tile ${stateLabel ? "pos-product-tile-disabled" : ""}`}
                                    key={item.id}
                                  >
                                    <button
                                      aria-label="Añadir al carrito"
                                      title={blocked ?? item.name}
                                      className="pos-product-hit pos-gallery-hit"
                                      disabled={
                                        Boolean(blocked) || !item.available
                                      }
                                      onClick={() => add(item.id)}
                                    >
                                      <ProductImage
                                        src={item.imageUrl}
                                        name={item.name}
                                      />
                                      <span className="min-w-0 flex-1 text-left">
                                        <strong className="block">
                                          {item.name}
                                        </strong>
                                        <span className="mt-1 block text-sm font-bold">
                                          {money(item.priceMinor)}
                                        </span>
                                        <span className="block text-xs text-slate-500">
                                          {item.category}
                                        </span>
                                        {stateLabel ? (
                                          <>
                                            <span
                                              className={`pos-product-state ${blocked ? "pos-product-state-restricted" : "pos-product-state-unavailable"}`}
                                              title={blocked ?? stateLabel}
                                            >
                                              {stateLabel}
                                            </span>
                                            {blocked ? (
                                              <span className="sr-only">
                                                {blocked}
                                              </span>
                                            ) : null}
                                          </>
                                        ) : null}
                                      </span>
                                      <span className="pos-product-quantity">
                                        {line?.quantity ?? 0}
                                      </span>
                                    </button>
                                  </article>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="pos-product-list mt-4">
                              {letterGroups.map((group) => (
                                <section
                                  key={group.letter}
                                  className="pos-letter-group"
                                >
                                  <h3 className="pos-letter-heading">
                                    {group.letter}
                                  </h3>
                                  {group.items.map((item) => {
                                    const blocked = restriction(item.id),
                                      line = cart.find(
                                        (current) => current.itemId === item.id,
                                      ),
                                      stateLabel = !item.available
                                        ? "No disponible"
                                        : blocked
                                          ? "Restringido"
                                          : null;
                                    return (
                                      <article
                                        className={`pos-list-row ${stateLabel ? "pos-product-tile-disabled" : ""}`}
                                        key={item.id}
                                      >
                                        <button
                                          aria-label="Añadir al carrito"
                                          title={blocked ?? item.name}
                                          className="pos-list-hit"
                                          disabled={
                                            Boolean(blocked) || !item.available
                                          }
                                          onClick={() => add(item.id)}
                                        >
                                          <span className="min-w-0 flex-1 text-left">
                                            <strong className="block">
                                              {item.name}
                                            </strong>
                                            <span className="block text-xs text-slate-500">
                                              {item.category}
                                            </span>
                                            {stateLabel ? (
                                              <span
                                                className={`pos-product-state ${blocked ? "pos-product-state-restricted" : "pos-product-state-unavailable"}`}
                                                title={blocked ?? stateLabel}
                                              >
                                                {stateLabel}
                                              </span>
                                            ) : null}
                                            {blocked ? (
                                              <span className="sr-only">
                                                {blocked}
                                              </span>
                                            ) : null}
                                          </span>
                                          <strong className="pos-list-price">
                                            {money(item.priceMinor)}
                                          </strong>
                                          <span className="pos-product-quantity">
                                            {line?.quantity ?? 0}
                                          </span>
                                          <span
                                            className="pos-list-add"
                                            aria-hidden="true"
                                          >
                                            +
                                          </span>
                                        </button>
                                      </article>
                                    );
                                  })}
                                </section>
                              ))}
                            </div>
                          )}
                          </div>
                        </section>
                        <aside className="card h-fit p-5 lg:sticky lg:top-24">
                          <h2
                            aria-label="Carrito persistente"
                            className="text-2xl font-black"
                          >
                            Venta actual
                          </h2>
                          {cart.length ? (
                            cart.map((line) => (
                              <div className="border-b py-3" key={line.itemId}>
                                <strong>
                                  {state.menuItems.find(
                                    (i) => i.id === line.itemId,
                                  )?.name ?? "Producto no disponible"}
                                </strong>
                                <div className="mt-2 flex items-center gap-3">
                                  <button
                                    className="btn-secondary"
                                    aria-label="Reducir cantidad"
                                    onClick={() =>
                                      setCart(
                                        cart.flatMap((l) =>
                                          l.itemId === line.itemId
                                            ? l.quantity > 1
                                              ? [
                                                  {
                                                    ...l,
                                                    quantity: l.quantity - 1,
                                                  },
                                                ]
                                              : []
                                            : [l],
                                        ),
                                      )
                                    }
                                  >
                                    −
                                  </button>
                                  <span>{line.quantity}</span>
                                  <button
                                    className="btn-secondary"
                                    aria-label="Aumentar cantidad"
                                    onClick={() => add(line.itemId)}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="mt-4">La venta está vacía.</p>
                          )}
                          <p className="my-4 text-xl font-black">
                            Total {money(total)}
                          </p>
                          {cart.length && scopeMissing ? (
                            <p role="alert">
                              Faltan permisos de la conexión para este pago.
                            </p>
                          ) : cart.length && !validation.ok ? (
                            <p
                              className="mb-4 font-bold text-amber-900"
                              role="alert"
                            >
                              {posValidationMessage(validation)}
                            </p>
                          ) : null}
                          <button
                            className="btn w-full"
                            disabled={!cart.length}
                            onClick={() => {
                              setStep("payment");
                              setNotice("");
                            }}
                          >
                            Continuar al pago
                          </button>
                          <button
                            className="btn-secondary mt-3 w-full"
                            disabled={busy}
                            onClick={async () => {
                              if (!cart.length) {
                                reset();
                                return;
                              }
                              setBusy(true);
                              const result = await voidPos(
                                `Carrito cancelado: ${cart.length} líneas, ${total} unidades menores`,
                                key.current,
                              );
                              if (result.ok) reset();
                              else setNotice(result.message);
                              setBusy(false);
                            }}
                          >
                            Cancelar venta
                          </button>
                        </aside>
                      </div>
                    ) : null}
                    </div>
                    {step === "payment" ? (
                      <section className="card pos-payment-review mx-auto max-w-2xl space-y-4 p-6">
                        <h1 aria-label="Validación y pago" className="text-2xl font-black">
                          Confirmar venta
                        </h1>
                        <div className="pos-payment-summary"><p className="label">Cliente</p><p className="font-black">{student?.preferredName ?? "No usuario"}</p><p className="text-sm text-slate-500">{mode === "cash" ? "Efectivo" : "Saldo PIKAS"}</p><div className="mt-3 divide-y">{cart.map(line=>{const item=state.menuItems.find(i=>i.id===line.itemId);return item?<p className="flex justify-between gap-3 py-2 text-sm" key={line.itemId}><span>{line.quantity} × {item.name}</span><strong>{money(item.priceMinor*line.quantity)}</strong></p>:null})}</div></div>
                        <p className="text-xl font-bold">
                          Total {money(total)}
                        </p>
                        {student ? (
                          <div className="flex flex-wrap gap-3">
                            <button
                              className="btn-secondary"
                              aria-pressed={mode === "student_wallet"}
                              onClick={() => setMode("student_wallet")}
                            >
                              Saldo PIKAS
                            </button>
                            <button
                              className="btn-secondary"
                              aria-pressed={mode === "cash"}
                              onClick={() => setMode("cash")}
                            >
                              Elegir efectivo
                            </button>
                          </div>
                        ) : null}
                        {scopeMissing ? (
                          <p role="alert">
                            Faltan permisos de la conexión para este pago.
                          </p>
                        ) : !validation.ok ? (
                          <p
                            role="alert"
                            className="rounded-xl bg-amber-100 p-4 text-amber-950"
                          >
                            {posValidationMessage(validation)}
                          </p>
                        ) : (
                          <p className="font-bold text-emerald-800">
                            Validación correcta
                          </p>
                        )}
                        {student?.scopes.includes("balance") &&
                        mode === "student_wallet" &&
                        student.balanceMinor! < total ? (
                          <section className="rounded-xl border p-4">
                            <p>Saldo actual {money(student!.balanceMinor!)}</p>
                            <p>Total de compra {money(total)}</p>
                            <p>Falta {money(total - student!.balanceMinor!)}</p>
                            <button
                              className="btn-secondary mt-3"
                              onClick={() => setReplenish(true)}
                            >
                              Recargar saldo
                            </button>
                          </section>
                        ) : null}
                        {mode === "cash" ? (
                          <>
                            <label className="block font-bold">
                              Efectivo recibido (RD$)
                              <input
                                className="field mt-2"
                                inputMode="decimal"
                                value={cash}
                                onChange={(e) => setCash(e.target.value)}
                              />
                            </label>
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="btn-secondary"
                                onClick={() => setCash(String(total / 100))}
                              >
                                Monto exacto
                              </button>
                              {CASH_DENOMINATIONS_MINOR.map((n) => (
                                <button
                                  className="btn-secondary"
                                  key={n}
                                  onClick={() => setCash(String(n / 100))}
                                >
                                  {money(n)}
                                </button>
                              ))}
                            </div>
                            <p className="text-xl font-black">
                              Cambio:{" "}
                              {money(Math.max(0, (cashMinor ?? 0) - total))}
                            </p>
                            {cashMinor === null || cashMinor < total ? (
                              <p role="alert">
                                Pendiente:{" "}
                                {money(Math.max(0, total - (cashMinor ?? 0)))}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                        <button
                          className="btn pos-payment-cta w-full"
                          aria-label="Confirmar venta"
                          disabled={
                            busy ||
                            scopeMissing ||
                            !validation.ok ||
                            connection !== "Online" ||
                            (mode === "cash" &&
                              (cashMinor === null || cashMinor < total))
                          }
                          onClick={complete}
                        >
                            {busy ? "Procesando…" : `Cobrar ${money(total)}`}
                        </button>
                        <button
                          className="btn-secondary w-full"
                          onClick={() => setStep("items")}
                        >
                          Volver a productos
                        </button>
                      </section>
                    ) : null}
                  </>
                ) : null}
                {step === "completed" && completed ? (
                  <section className="card mx-auto max-w-2xl space-y-4 p-6">
                    <h1 className="text-3xl font-black">Compra completada</h1>
                    <p role="status">
                      {completed.studentAssociation === "general_sale"
                        ? "Cash — General sale"
                        : completed.paymentMethod === "cash"
                          ? "Cash — Student-linked"
                          : "Cashless / PIKAS account"}{" "}
                      · {money(completed.totalMinor)}
                    </p>
                    {completed.paymentMethod === "cash" ? (
                      <p className="text-xl">
                        Recibido {money(completed.cashReceivedMinor ?? 0)} ·
                        Cambio {money(completed.changeProvidedMinor ?? 0)}
                      </p>
                    ) : null}
                    <button className="btn w-full" onClick={reset}>
                      Nueva transacción
                    </button>
                    <button
                      className="btn-secondary w-full"
                      onClick={() => setReceipt(!receipt)}
                    >
                      Ver recibo
                    </button>
                    {receipt ? <PurchaseDetail purchase={completed} /> : null}
                  </section>
                ) : null}
              </>
            )}
            {replenish && student?.scopes.includes("balance") ? (
              <form
                className="card space-y-3 p-5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (submitting.current) return;
                  submitting.current = true;
                  setBusy(true);
                  const result = await replenishPos(
                    student.id,
                    parseMoney(amount) ?? 0,
                    replenishKey.current,
                  );
                  setNotice(
                    result.ok
                      ? "Recarga completada. El límite diario no cambia."
                      : result.message,
                  );
                  if (result.ok) {
                    setReplenish(false);
                    replenishKey.current = crypto.randomUUID();
                  }
                  setBusy(false);
                  submitting.current = false;
                }}
              >
                <h2 className="text-xl font-black">
                  Recargar saldo · {student.preferredName}
                </h2>
                <p>
                  Evento separado, recibido en efectivo. Saldo actual{" "}
                  {money(student!.balanceMinor!)}.
                </p>
                <label className="block font-bold">
                  Monto de recarga (RD$)
                  <input
                    className="field mt-2"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <p>
                  Nuevo saldo{" "}
                  {money(student.balanceMinor! + (parseMoney(amount) ?? 0))}
                </p>
                <button
                  className="btn"
                  disabled={busy || connection !== "Online"}
                >
                  Confirmar recarga
                </button>
                <button
                  type="button"
                  className="btn-secondary ml-3"
                  onClick={() => setReplenish(false)}
                >
                  Cerrar recarga
                </button>
              </form>
            ) : null}
            {notice ? (
              <p role="alert" className="card p-4 font-bold">
                {notice}
              </p>
            ) : null}
          </>
        )}
      </div>
      <footer className="pos-status-bar" aria-label="Estado de caja">
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span
            aria-hidden="true"
            className="pos-status-dot"
            data-state={connection}
          />
          <strong aria-live="polite">{connection}</strong>
        </span>
        <span>· {demo ? "Demo local" : "POS"}</span>
        {ready && policy.showShiftStart ? (
          <span data-testid="shift-start">
            · Turno{" "}
            {new Date(state.shiftStartedAt).toLocaleTimeString("es-DO", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : null}
        {policy.showCount ? (
          <span data-testid="shift-count">
            · {shift.length}{" "}
            {shift.length === 1 ? "transacción" : "transacciones"}
          </span>
        ) : null}
        {policy.showSales ? (
          <span data-testid="shift-sales">
            · Ventas {money(shift.reduce((sum, p) => sum + p.totalMinor, 0))}
          </span>
        ) : null}
      </footer>
    </main>
  );
}
