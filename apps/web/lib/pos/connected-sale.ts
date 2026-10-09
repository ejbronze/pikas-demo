import { z } from "zod";
import type { PosAccessContext } from "./access-context";
import { bootstrapSchema, checkoutSchema, customerSchema, parseCash, paymentIssue, purchaseContextSchema, receiptSchema,
  type Bootstrap, type Customer, type PosOperation, type PurchaseContext, type Receipt } from "./contracts";

export class PosRequestError extends Error {
  constructor(message: string, public definite = false) { super(message); }
}
const messages: Record<string, string> = {
  PRODUCT_STALE: "El precio o producto cambió. Actualiza la venta.", TOTAL_STALE: "El total cambió. Actualiza la venta.",
  INSUFFICIENT_BALANCE: "Saldo PIKAS insuficiente.", WALLET_FROZEN: "Saldo PIKAS no disponible.",
  TRANSACTION_LIMIT_EXCEEDED: "Límite por compra excedido.", DAILY_LIMIT_EXCEEDED: "Límite diario excedido.",
  SESSION_CLOSED: "La caja ya está cerrada.", NO_ACTIVE_SERVICE: "No hay servicio de venta activo.",
  pos_access_required: "El acceso POS ya no está disponible. Verifica tu sesión.", pos_authority_required: "No tienes autoridad para esta operación.",
  register_not_ready: "No hay una caja abierta y autorizada.", CUSTOMER_INELIGIBLE: "El estudiante ya no está habilitado para comprar.",
};
export async function requestPos(operation: PosOperation): Promise<unknown> {
  if (!navigator.onLine) throw new PosRequestError("Conéctate para continuar. No se permiten ventas sin conexión.");
  const response = await fetch("/api/pos", { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(operation.operation === "checkout" ? { "Idempotency-Key": operation.request.request_key } : {}) },
    body: JSON.stringify(operation), signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok) throw new PosRequestError(messages[body.error] ?? "No se pudo confirmar la operación.", body.definite === true);
  return body.result;
}
const pendingSchema = z.object({ actor: z.uuid(), pov: z.uuid().nullable(), request: checkoutSchema }).strict();
type Pending = z.infer<typeof pendingSchema>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const storageKey = "pikas:connected-pos:pending:v1";
export type SaleState = {
  context: PosAccessContext; bootstrap: Bootstrap | null; phase: "entry" | "identity" | "items" | "payment" | "completed";
  busy: boolean; notice: string; customers: Customer[]; customer: Customer | null; purchaseContext: PurchaseContext | null;
  cart: { product_id: string; quantity: number }[]; tender: "student_wallet" | "cash"; cash: string;
  receipt: Receipt | null; pending: Pending | null; recoveryBlocked: boolean;
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
      purchaseContext: null, cart: [], tender: "student_wallet", cash: "", receipt: null, pending: null, recoveryBlocked: false };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<SaleState>) { this.state = { ...this.state, ...value }; this.listeners.forEach((fn) => fn()); }
  private sameOwner(pending: Pending) {
    // A renewed POV for the same effective cashier may recover an old sale. The DB still verifies
    // the original register session's scope; a different actor or ordinary/POV mode cannot retry it.
    return pending.actor === this.state.context.actor.person_id && Boolean(pending.pov) === Boolean(this.state.context.pov);
  }
  async start(storage: Storage) {
    if (this.started) return;
    this.started = true; this.storage = storage;
    try {
      const saved = storage.getItem(storageKey);
      if (saved) {
        const pending = pendingSchema.parse(JSON.parse(saved));
        this.update({ pending, recoveryBlocked: !this.sameOwner(pending), notice: "Hay una venta pendiente de confirmar." });
      }
    } catch { this.update({ recoveryBlocked: true, notice: "La recuperación de la venta no está disponible. No inicies una venta nueva." }); }
    await this.refresh();
  }
  async refresh() {
    if (this.state.busy || (this.state.cart.length && !this.state.pending && !this.state.receipt)) return;
    this.update({ busy: true });
    try {
      const bootstrap = bootstrapSchema.parse(await this.send({ operation: "bootstrap" }));
      this.update({ bootstrap, context: bootstrap.context });
      if (this.state.pending && !this.sameOwner(this.state.pending)) this.update({ recoveryBlocked: true });
    } catch (error) { this.update({ bootstrap: null, notice: this.error(error) }); }
    finally { this.update({ busy: false }); }
  }
  private error(error: unknown) { return error instanceof PosRequestError ? error.message : "No se pudo confirmar la operación. Verifica la conexión."; }
  private operable() { return !this.state.busy && !this.state.pending && !this.state.recoveryBlocked && this.state.bootstrap?.blocked === null; }
  identify = () => { if (this.operable()) this.update({ phase: "identity", notice: "" }); };
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
    this.update({ busy: true, purchaseContext: null, notice: "" });
    try { this.update({ customer, purchaseContext: await this.contextFor(customer.customer_id), cart: [], tender: "student_wallet", cash: "", phase: "items" }); }
    catch (error) { this.update({ customer: null, notice: this.error(error) }); }
    finally { this.update({ busy: false }); }
  }
  quantity(productId: string, delta: number) {
    if (!this.operable() || this.state.phase !== "items" || !this.state.purchaseContext || !this.state.bootstrap?.catalog?.products.some((p) => p.product_id === productId)) return;
    const cart = [...this.state.cart]; const index = cart.findIndex((l) => l.product_id === productId);
    const quantity = (cart[index]?.quantity ?? 0) + delta;
    if (quantity > 20 || (index < 0 && cart.length >= 30) || quantity < 0) return;
    if (index < 0 && quantity > 0) cart.push({ product_id: productId, quantity });
    else if (quantity === 0) cart.splice(index, 1);
    else cart[index] = { product_id: productId, quantity };
    this.update({ cart });
  }
  total() { return this.state.cart.reduce((n, l) => n + BigInt(this.state.bootstrap!.catalog!.products.find((p) => p.product_id === l.product_id)!.price_minor) * BigInt(l.quantity), 0n); }
  setTender(tender: "cash" | "student_wallet") { if (this.operable()) this.update({ tender }); }
  setCash(cash: string) { if (this.operable()) this.update({ cash }); }
  async review() {
    if (!this.operable() || !this.state.customer || !this.state.cart.length) return;
    this.update({ busy: true, purchaseContext: null, notice: "" });
    try { this.update({ purchaseContext: await this.contextFor(this.state.customer.customer_id), phase: "payment" }); }
    catch (error) { this.update({ notice: this.error(error) }); }
    finally { this.update({ busy: false }); }
  }
  back = () => { if (this.operable()) this.update({ phase: "items" }); };
  async checkout() {
    if (!this.operable() || !this.state.customer || !this.state.purchaseContext || !this.state.cart.length || this.state.phase !== "payment") return;
    const total = this.total();
    const issue = paymentIssue(this.state.purchaseContext, total, this.state.tender, this.state.cash);
    if (issue) { this.update({ notice: issue }); return; }
    const request = checkoutSchema.parse({ request_key: this.key(), register_session_id: this.state.bootstrap!.session!.session_id,
      cafeteria_customer_id: this.state.customer.customer_id, expected_total_minor: total.toString(),
      items: this.state.cart.map((line) => { const p = this.state.bootstrap!.catalog!.products.find((p) => p.product_id === line.product_id)!;
        return { ...line, expected_product_version: p.version, expected_unit_price_minor: p.price_minor }; }),
      tender: this.state.tender === "cash" ? { type: "cash", cash_received_minor: parseCash(this.state.cash)! } : { type: "student_wallet" } });
    const pending: Pending = { actor: this.state.context.actor.person_id, pov: this.state.context.pov?.session_id ?? null, request };
    try { if (!this.storage) throw new Error("journal_missing"); this.storage.setItem(storageKey, JSON.stringify(pending)); }
    catch { this.update({ notice: "No se pudo guardar la clave de recuperación. No se realizó el cobro." }); return; }
    this.update({ pending });
    await this.retry();
  }
  async retry() {
    const pending = this.state.pending;
    if (!pending || this.state.busy || this.state.recoveryBlocked || !this.sameOwner(pending)) return;
    this.update({ busy: true, notice: "" });
    let refreshAfter = false;
    try {
      const receipt = receiptSchema.parse(await this.send({ operation: "checkout", request: pending.request }));
      if (receipt.register_session_id !== pending.request.register_session_id || receipt.cafeteria_customer_id !== pending.request.cafeteria_customer_id ||
        receipt.total_minor !== pending.request.expected_total_minor || receipt.tender_type !== pending.request.tender.type ||
        receipt.items.length !== pending.request.items.length || receipt.items.some((i) => !pending.request.items.some((p) => p.product_id === i.product_id &&
          p.quantity === i.quantity && p.expected_unit_price_minor === i.unit_price_minor && p.expected_product_version === i.product_version)) ||
        (pending.request.tender.type === "cash" && receipt.cash_received_minor !== pending.request.tender.cash_received_minor)) throw new Error("receipt_mismatch");
      this.update({ receipt, phase: "completed", cart: [] });
      try { this.update({ purchaseContext: await this.contextFor(receipt.cafeteria_customer_id) }); }
      catch { this.update({ purchaseContext: null, notice: "Compra confirmada. No se pudo actualizar el contexto del estudiante." }); }
    } catch (error) {
      if (error instanceof PosRequestError && error.definite) {
        try { this.storage!.removeItem(storageKey); this.update({ pending: null, purchaseContext: null, cart: [], phase: "identity" }); refreshAfter = true; }
        catch { this.update({ recoveryBlocked: true }); }
        this.update({ notice: error.message });
      } else this.update({ notice: "El resultado del cobro no está confirmado. Reintenta la misma venta; no inicies otra." });
    } finally { this.update({ busy: false }); }
    if (refreshAfter) await this.refresh();
  }
  async reset() {
    if (this.state.busy || this.state.recoveryBlocked || (this.state.pending && !this.state.receipt)) return;
    try { this.storage?.removeItem(storageKey); }
    catch { this.update({ recoveryBlocked: true, notice: "No se pudo cerrar el seguimiento de la venta." }); return; }
    this.update({ pending: null, receipt: null, customer: null, purchaseContext: null, cart: [], customers: [], tender: "student_wallet", cash: "", phase: "entry", notice: "" });
    await this.refresh();
  }
}
