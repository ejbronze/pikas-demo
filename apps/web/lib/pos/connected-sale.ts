import { sessionFetch } from "../auth/session-fetch";
import { z } from "zod";
import type { PosAccessContext } from "./access-context";
import { bootstrapSchema, checkoutSchema, customerSchema, parseCash, paymentIssue, purchaseContextSchema, receiptSchema,
  registerOperationSchema, registerResultSchema, type RegisterOperation, type Bootstrap, type Customer, type PosOperation, type PurchaseContext, type Receipt } from "./contracts";

export class PosRequestError extends Error {
  constructor(message: string, public definite = false) { super(message); }
}
const messages: Record<string, string> = {
  PRODUCT_STALE: "El precio o producto cambió. Actualiza la venta.", TOTAL_STALE: "El total cambió. Actualiza la venta.",
  INSUFFICIENT_BALANCE: "Saldo PIKAS insuficiente.", WALLET_FROZEN: "Saldo PIKAS no disponible.",
  TRANSACTION_LIMIT_EXCEEDED: "Límite por compra excedido.", DAILY_LIMIT_EXCEEDED: "Límite diario excedido.",
  SESSION_CLOSED: "La caja ya está cerrada.", NO_ACTIVE_SERVICE: "No hay servicio de venta activo.",
  pos_access_required: "El acceso POS ya no está disponible. Verifica tu sesión.", pos_authority_required: "No tienes autoridad para esta operación.",
  register_already_has_open_session: "La caja ya tiene una sesión abierta. Verifica el estado de caja.",
  operator_already_has_open_session: "Ya tienes una caja abierta. Se recuperará la sesión existente.",
  register_or_operator_already_has_open_session: "La caja o el cajero ya tiene una sesión abierta.",
  stale_register_session_version: "El estado de caja cambió. Verifica la sesión antes de continuar.",
  register_session_already_closed: "La caja ya se cerró con otra operación.",
  register_not_ready: "No hay una caja abierta y autorizada.", CUSTOMER_INELIGIBLE: "El estudiante ya no está habilitado para comprar.",
};
export async function requestPos(operation: PosOperation): Promise<unknown> {
  if (!navigator.onLine) throw new PosRequestError("Conéctate para continuar. No se permiten ventas sin conexión.");
  const response = await sessionFetch("/api/pos", { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(operation.operation === "checkout" ? { "Idempotency-Key": operation.request.request_key } : "request_key" in operation ? { "Idempotency-Key": operation.request_key } : {}) },
    body: JSON.stringify(operation), signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok) throw new PosRequestError(messages[body.error] ?? "No se pudo confirmar la operación.", body.definite === true);
  return body.result;
}
const pendingSchema = z.object({ actor: z.uuid(), auth_user: z.uuid().optional(), pov: z.uuid().nullable(), request: checkoutSchema }).strict();
const registerPendingSchema = z.object({ actor: z.uuid(), auth_user: z.uuid().optional(), pov: z.uuid().nullable(), request: registerOperationSchema }).strict();
type RegisterPending = z.infer<typeof registerPendingSchema>;
const registerStorageKey = "pikas:connected-pos:register:v1";
type Pending = z.infer<typeof pendingSchema>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const storageKey = "pikas:connected-pos:pending:v1";
export type SaleState = {
  context: PosAccessContext; bootstrap: Bootstrap | null; phase: "entry" | "identity" | "items" | "payment" | "completed";
  busy: boolean; notice: string; customers: Customer[]; customer: Customer | null; purchaseContext: PurchaseContext | null;
  purchaserMode: "student" | "anonymous" | null; cart: { product_id: string; quantity: number }[]; tender: "student_wallet" | "cash" | null; cash: string;
  registerPending: RegisterPending | null; receipt: Receipt | null; pending: Pending | null; recoveryBlocked: boolean;
};

// Only the unresolved exact request is journaled, never a wallet balance or an offline write queue.
export class ConnectedSale {
  private listeners = new Set<() => void>();
  private started = false;
  private storage: Storage | null = null;
  private state: SaleState;
  constructor(context: PosAccessContext, private send: (operation: PosOperation) => Promise<unknown> = requestPos,
    private key: () => string = () => crypto.randomUUID()) {
    this.state = { context, bootstrap: null, phase: "entry", busy: false, notice: "", customers: [], customer: null,
      purchaseContext: null, purchaserMode: null, cart: [], tender: null, cash: "", receipt: null, pending: null, registerPending: null, recoveryBlocked: false };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<SaleState>) { this.state = { ...this.state, ...value }; this.listeners.forEach((fn) => fn()); }
  private sameOwner(pending: Pick<Pending, "actor" | "pov" | "auth_user">) {
    // A renewed POV for the same effective cashier may recover an old sale. The DB still verifies
    // the original register session's scope; a different actor or ordinary/POV mode cannot retry it.
    const realUser = this.state.context.authenticated_user_id;
    // Legacy POV journals lack a real operator binding: retain them, but do not execute them.
    if (realUser && (pending.auth_user ? pending.auth_user !== realUser : Boolean(pending.pov))) return false;
    return pending.actor === this.state.context.actor.person_id && Boolean(pending.pov) === Boolean(this.state.context.pov);
  }
  async start(storage: Storage) {
    if (this.started) return;
    this.started = true; this.storage = storage;
    try {
      const savedRegister = storage.getItem(registerStorageKey);
      if (savedRegister) {
        const registerPending = registerPendingSchema.parse(JSON.parse(savedRegister));
        this.update({ registerPending, recoveryBlocked: !this.sameOwner(registerPending), notice: "Hay una operación de caja pendiente de confirmar." });
      }
      const saved = storage.getItem(storageKey);
      if (saved) {
        const pending = pendingSchema.parse(JSON.parse(saved));
        this.update({ pending, recoveryBlocked: !this.sameOwner(pending), notice: "Hay una venta pendiente de confirmar." });
      }
    } catch { this.update({ recoveryBlocked: true, notice: "La recuperación de la venta no está disponible. No inicies una venta nueva." }); }
    if (this.state.pending && this.state.registerPending) this.update({ recoveryBlocked: true });
    await this.refresh();
  }
  async refresh() {
    if (this.state.busy || (this.state.cart.length && !this.state.pending && !this.state.receipt)) return;
    this.update({ busy: true });
    try {
      const bootstrap = bootstrapSchema.parse(await this.send({ operation: "bootstrap" }));
      this.update({ bootstrap, context: bootstrap.context });
      if ((this.state.pending && !this.sameOwner(this.state.pending)) || (this.state.registerPending && !this.sameOwner(this.state.registerPending))) this.update({ recoveryBlocked: true });
    } catch (error) { this.update({ bootstrap: null, notice: this.error(error) }); }
    finally { this.update({ busy: false }); }
  }
  private error(error: unknown) { return error instanceof PosRequestError ? error.message : "No se pudo confirmar la operación. Verifica la conexión."; }
  private operable() { return !this.state.busy && !this.state.pending && !this.state.registerPending && !this.state.recoveryBlocked && this.state.bootstrap?.blocked === null; }
  private hasPurchaser() { return this.state.purchaserMode==="anonymous"||(this.state.purchaserMode==="student"&&Boolean(this.state.customer&&this.state.purchaseContext)); }
  identify = () => { if (this.operable()) this.update({ phase: "identity", purchaserMode:null, customer:null, purchaseContext:null, customers:[], cart:[], tender:null, cash:"", notice: "" }); };
  anonymous = () => { if(this.operable())this.update({phase:"items",purchaserMode:"anonymous",customer:null,purchaseContext:null,customers:[],cart:[],tender:null,cash:"",notice:""}); };
  async search(query: string) {
    if (!this.operable()) return;
    this.update({ busy: true, customers: [], notice: "" });
    try {
      const customers = z.array(customerSchema).parse(await this.send({ operation: "search", query }));
      this.update({ customers, notice: customers.length ? "" : "No se encontraron estudiantes." });
    }
    catch (error) { this.update({ notice: this.error(error) }); }
    finally { this.update({ busy: false }); }
  }
  private async contextFor(customerId: string) {
    const result = purchaseContextSchema.parse(await this.send({ operation: "customer", customer_id: customerId }));
    if (result.customer_id !== customerId || result.currency_code !== this.state.bootstrap?.session?.currency_code) throw new Error("context_mismatch");
    return result;
  }
  async select(customer: Customer) {
    if (!this.operable() || customer.customer_type !== "student") return;
    this.update({ busy: true, purchaserMode:null, customer:null, purchaseContext: null, cart:[], tender:null, cash:"", notice: "" });
    try { this.update({ purchaserMode:"student", customer, purchaseContext: await this.contextFor(customer.customer_id), cart: [], tender: null, cash: "", phase: "items" }); }
    catch (error) { this.update({ customer: null, notice: this.error(error) }); }
    finally { this.update({ busy: false }); }
  }
  quantity(productId: string, delta: number) {
    if (!this.operable() || this.state.phase !== "items" || !this.hasPurchaser() || !this.state.bootstrap?.catalog?.products.some((p) => p.product_id === productId)) return;
    const cart = [...this.state.cart]; const index = cart.findIndex((l) => l.product_id === productId);
    const quantity = (cart[index]?.quantity ?? 0) + delta;
    if (quantity > 20 || (index < 0 && cart.length >= 30) || quantity < 0) return;
    if (index < 0 && quantity > 0) cart.push({ product_id: productId, quantity });
    else if (quantity === 0) cart.splice(index, 1);
    else cart[index] = { product_id: productId, quantity };
    this.update({ cart });
  }
  total() { return this.state.cart.reduce((n, l) => n + BigInt(this.state.bootstrap!.catalog!.products.find((p) => p.product_id === l.product_id)!.price_minor) * BigInt(l.quantity), 0n); }
  setTender(tender: "cash" | "student_wallet") { if (this.operable()&&this.hasPurchaser()&&(tender==="cash"||(tender==="student_wallet"&&this.state.purchaserMode==="student"))) this.update({ tender, cash:this.state.tender===tender?this.state.cash:"" }); }
  setCash(cash: string) { if (this.operable()) this.update({ cash }); }
  async review() {
    if (!this.operable() || !this.hasPurchaser() || !this.state.cart.length) return;
    this.update({ busy: true, purchaseContext: null, notice: "" });
    try { this.update({ purchaseContext: this.state.purchaserMode==="anonymous"?null:await this.contextFor(this.state.customer!.customer_id), phase: "payment" }); }
    catch (error) { this.update({ notice: this.error(error) }); }
    finally { this.update({ busy: false }); }
  }
  back = () => { if (this.operable()) this.update({ phase: "items" }); };
  async checkout() {
    if (!this.operable() || !this.hasPurchaser() || !this.state.cart.length || this.state.phase !== "payment") return;
    const total = this.total();
    const issue = paymentIssue(this.state.purchaseContext, total, this.state.tender, this.state.cash,this.state.purchaserMode==="anonymous");
    if (issue || this.state.tender===null) { this.update({ notice: issue ?? "Selecciona un método de pago." }); return; }
    const request = checkoutSchema.parse({ request_key: this.key(), register_session_id: this.state.bootstrap!.session!.session_id,
      cafeteria_customer_id: this.state.purchaserMode==="anonymous"?null:this.state.customer!.customer_id, expected_total_minor: total.toString(),
      items: this.state.cart.map((line) => { const p = this.state.bootstrap!.catalog!.products.find((p) => p.product_id === line.product_id)!;
        return { ...line, expected_product_version: p.version, expected_unit_price_minor: p.price_minor }; }),
      tender: this.state.tender === "cash" ? { type: "cash", cash_received_minor: parseCash(this.state.cash)! } : { type: "student_wallet" } });
    const pending: Pending = { actor: this.state.context.actor.person_id, auth_user: this.state.context.authenticated_user_id, pov: this.state.context.pov?.session_id ?? null, request };
    try { if (!this.storage) throw new Error("journal_missing"); this.storage.setItem(storageKey, JSON.stringify(pending)); }
    catch { this.update({ notice: "No se pudo guardar la clave de recuperación. No se realizó el cobro." }); return; }
    this.update({ pending });
    await this.retry();
  }
  async retry() {
    const pending = this.state.pending;
    if (!pending || this.state.registerPending || this.state.busy || this.state.recoveryBlocked || !this.sameOwner(pending)) return;
    this.update({ busy: true, notice: "" });
    let refreshAfter = false;
    try {
      const receipt = receiptSchema.parse(await this.send({ operation: "checkout", request: pending.request }));
      if (receipt.register_session_id !== pending.request.register_session_id || receipt.cafeteria_customer_id !== pending.request.cafeteria_customer_id ||
        receipt.total_minor !== pending.request.expected_total_minor || receipt.tender_type !== pending.request.tender.type ||
        receipt.items.length !== pending.request.items.length || receipt.items.some((i) => !pending.request.items.some((p) => p.product_id === i.product_id &&
          p.quantity === i.quantity && p.expected_unit_price_minor === i.unit_price_minor && p.expected_product_version === i.product_version)) ||
        (pending.request.tender.type === "cash" && receipt.cash_received_minor !== pending.request.tender.cash_received_minor)) throw new Error("receipt_mismatch");
      this.update({ receipt, phase: "completed", cart: [], purchaserMode:receipt.cafeteria_customer_id===null?"anonymous":"student" });
      if(receipt.cafeteria_customer_id===null){this.update({purchaseContext:null});}
      else try { this.update({ purchaseContext: await this.contextFor(receipt.cafeteria_customer_id) }); }
      catch { this.update({ purchaseContext: null, notice: "Compra confirmada. No se pudo actualizar el contexto del estudiante." }); }
    } catch (error) {
      if (error instanceof PosRequestError && error.definite) {
        try { this.storage!.removeItem(storageKey); this.update({ pending: null, purchaserMode:null, customer:null, purchaseContext: null, cart: [], tender:null, cash:"", phase: pending.request.cafeteria_customer_id===null?"entry":"identity" }); refreshAfter = true; }
        catch { this.update({ recoveryBlocked: true }); }
        this.update({ notice: error.message });
      } else this.update({ notice: "El resultado del cobro no está confirmado. Reintenta la misma venta; no inicies otra." });
    } finally { this.update({ busy: false }); }
    if (refreshAfter) await this.refresh();
  }
  // Demo departure discards only unsent UI state or a confirmed receipt journal.
  // It never sends a financial request and never removes an uncertain journal.
  discardForDemoDeparture(): boolean {
    if (!this.started || !this.storage || this.state.busy || this.state.registerPending || this.state.recoveryBlocked || (this.state.pending && !this.state.receipt)) return false;
    try { this.storage?.removeItem(storageKey); }
    catch { return false; }
    this.update({ pending: null, receipt: null, cart: [], tender: null, cash: "", purchaserMode: null, customer: null, purchaseContext: null, customers: [], phase: "entry" });
    return true;
  }
  async reset() {
    if (this.state.busy || this.state.registerPending || this.state.recoveryBlocked || (this.state.pending && !this.state.receipt)) return;
    try { this.storage?.removeItem(storageKey); }
    catch { this.update({ recoveryBlocked: true, notice: "No se pudo cerrar el seguimiento de la venta." }); return; }
    this.update({ pending: null, receipt: null, purchaserMode:null, customer: null, purchaseContext: null, cart: [], customers: [], tender: null, cash: "", phase: "entry", notice: "" });
    await this.refresh();
  }
  async openRegister(registerId: string, cash: string) {
    const amount = parseCash(cash);
    if (amount === null || this.state.bootstrap?.session || !this.state.bootstrap?.registers.some((r) => r.register_id === registerId)) return;
    await this.beginRegister({ operation: "open_register", register_id: registerId, opening_cash_minor: amount, request_key: this.key() });
  }
  async closeRegister(cash: string) {
    const amount = parseCash(cash), session = this.state.bootstrap?.session;
    if (amount === null || !session) return;
    await this.beginRegister({ operation: "close_register", session_id: session.session_id, expected_version: session.version,
      counted_cash_minor: amount, request_key: this.key() });
  }
  private async beginRegister(request: RegisterOperation) {
    if (this.state.busy || this.state.pending || this.state.registerPending || this.state.recoveryBlocked || this.state.cart.length || this.state.receipt) return;
    const registerPending = { actor: this.state.context.actor.person_id, auth_user: this.state.context.authenticated_user_id, pov: this.state.context.pov?.session_id ?? null, request };
    try { if (!this.storage) throw new Error("journal_missing"); this.storage.setItem(registerStorageKey, JSON.stringify(registerPending)); }
    catch { this.update({ notice: "No se pudo guardar la clave de recuperación. La caja no se modificó." }); return; }
    this.update({ registerPending }); await this.retryRegister();
  }
  async retryRegister() {
    const pending = this.state.registerPending;
    if (!pending || this.state.busy || this.state.recoveryBlocked || !this.sameOwner(pending)) return;
    this.update({ busy: true, notice: "" });
    let confirmed = false;
    try {
      const result = registerResultSchema.parse(await this.send(pending.request))[0];
      if (pending.request.operation === "close_register" && (result.session_id !== pending.request.session_id || result.status !== "closed")) throw new Error("register_mismatch");
      this.storage!.removeItem(registerStorageKey);
      this.update({ registerPending: null, phase: "entry", purchaserMode:null, customer: null, purchaseContext: null, customers: [], cash: "", tender: null, notice: result.status === "closed" ? "Caja cerrada y efectivo contado registrado." : "Caja abierta." });
      confirmed = true;
    } catch (error) {
      if (error instanceof PosRequestError && error.definite) {
        try { this.storage!.removeItem(registerStorageKey); this.update({ registerPending: null, notice: error.message }); confirmed = true; }
        catch { this.update({ recoveryBlocked: true, notice: "No se pudo cerrar el seguimiento de caja." }); }
      } else this.update({ notice: "El resultado de caja no está confirmado. Reintenta la misma operación; no inicies otra." });
    }
    finally { this.update({ busy: false }); }
    if (confirmed) await this.refresh();
  }

}
