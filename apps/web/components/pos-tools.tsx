"use client";
import { useState } from "react";
import {
  businessDay,
  parseMoney,
  refundedMinor,
  type FinancialEvent,
  type PosPurchaseRecord,
} from "@pikas/data-access";
import { usePosHistory as useDemo } from "./demo-provider";
export const posMoney = (minor: number) =>
  new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(
    minor / 100,
  );
export type PurchaseStatus = "Completada" | "Reembolso parcial" | "Reembolsada";
export const purchaseStatus = (
  purchase: PosPurchaseRecord,
  events: readonly FinancialEvent[],
): PurchaseStatus => {
  const refunded = refundedMinor(purchase.id, events);
  return refunded >= purchase.totalMinor
    ? "Reembolsada"
    : refunded > 0
      ? "Reembolso parcial"
      : "Completada";
};
const printReceipt = (target: "sale" | "refund" = "sale") => {
  document.body.dataset.printTarget = target;
  const cleanup = () => {
    delete document.body.dataset.printTarget;
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
};
function RefundReceipt({
  purchase,
  event,
}: {
  purchase: PosPurchaseRecord;
  event: FinancialEvent;
}) {
  return (
    <section
      className="pos-printable-receipt pos-refund-receipt card space-y-4 p-5"
      aria-label="Recibo de reembolso"
    >
      <div className="border-b pb-3">
        <p className="label">PIKAS · Cafetería PIKAS Central</p>
        <h2 className="mt-1 text-2xl font-black">Recibo de reembolso</h2>
        <p className="mt-1 text-sm text-slate-500">
          {new Date(event.createdAt).toLocaleString("es-DO")}
        </p>
        <p className="text-sm text-slate-500">
          Refund ID <span className="font-mono">{event.id}</span>
        </p>
      </div>
      <p>
        Venta original: <span className="font-mono">{purchase.id}</span>
      </p>
      <div className="border-y py-3">
        <div className="flex justify-between text-lg font-black">
          <span>Total reembolsado</span>
          <strong>{posMoney(event.amountMinor)}</strong>
        </div>
      </div>
      <div className="grid gap-1 text-sm">
        <p>
          Destino:{" "}
          <strong>
            {event.destination === "wallet" ? "Saldo PIKAS" : "Efectivo"}
          </strong>
        </p>
        <p>Motivo: {event.reason}</p>
        <p>Cliente: {purchase.studentName}</p>
        <p>Procesado por: {event.actorName}</p>
        {event.approvedByName ? (
          <p>Aprobado por: {event.approvedByName}</p>
        ) : null}
        <p>
          Registro: {event.registerId} · Ubicación: {event.locationId}
        </p>
      </div>
      <button
        className="btn pos-receipt-actions"
        onClick={() => printReceipt("refund")}
      >
        Imprimir recibo de reembolso
      </button>
    </section>
  );
}
export function PurchaseDetail({
  purchase,
  admin = false,
}: {
  purchase: PosPurchaseRecord;
  admin?: boolean;
}) {
  const { state, refundPos, connection } = useDemo();
  const [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [refundEventId, setRefundEventId] = useState<string | null>(null),
    [key, setKey] = useState(() => crypto.randomUUID());
  const events = state.events.filter(
      (e) => e.originalPurchaseId === purchase.id && e.type === "refund",
    ),
    remaining = purchase.totalMinor - refundedMinor(purchase.id, state.events),
    status = purchaseStatus(purchase, state.events),
    refundAmount =
      parseMoney(amount) ?? (state.posPolicy.partialRefunds ? 0 : remaining);
  const allowed = admin || state.posPolicy.allowCashierRefunds;
  return (
    <section
      data-printable-receipt="sale"
      className="pos-printable-receipt card pos-receipt space-y-4 p-5"
      aria-label="Detalle de transacción"
    >
      <div className="border-b pb-3">
        <p className="label">PIKAS · Cafetería PIKAS Central</p>
        <h2 className="mt-1 text-2xl font-black">Venta completada</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={`pos-receipt-status pos-receipt-status-${status === "Completada" ? "complete" : status === "Reembolso parcial" ? "partial" : "refunded"}`}
          >
            {status}
          </span>
          <span className="text-sm text-slate-500">
            {new Date(purchase.createdAt).toLocaleString("es-DO")}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          Transacción <span className="font-mono">{purchase.id}</span>
        </p>
      </div>
      <div>
        <h3 className="label">Items</h3>
        <ul className="mt-2 divide-y">
          {purchase.items.map((item, index) => (
            <li
              className="flex justify-between gap-3 py-2"
              key={`${item.itemId}-${index}`}
            >
              <span>
                {item.quantity} × {item.name}
              </span>
              <strong>{posMoney(item.quantity * item.unitPriceMinor)}</strong>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-y py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-lg font-black">Total original</span>
          <strong className="pos-receipt-total">
            {posMoney(purchase.totalMinor)}
          </strong>
        </div>
        {refundedMinor(purchase.id, state.events) > 0 ? (
          <div className="mt-2 grid gap-1 text-sm">
            <p className="flex justify-between">
              <span>Reembolsado</span>
              <strong>
                {posMoney(refundedMinor(purchase.id, state.events))}
              </strong>
            </p>
            <p className="flex justify-between">
              <span>Importe neto</span>
              <strong>{posMoney(Math.max(0, remaining))}</strong>
            </p>
          </div>
        ) : null}
      </div>
      <div>
        <h3 className="label">Pago</h3>
        <p className="mt-2 font-bold">
          {purchase.paymentMethod === "cash" ? "Efectivo" : "Saldo PIKAS"}
        </p>
        {purchase.paymentMethod === "cash" ? (
          <div className="mt-2 grid gap-1 text-sm">
            <p className="flex justify-between">
              <span>Recibido</span>
              <strong>{posMoney(purchase.cashReceivedMinor ?? 0)}</strong>
            </p>
            <p className="pos-receipt-change flex justify-between">
              <span>Cambio / Devuelta</span>
              <strong>{posMoney(purchase.changeProvidedMinor ?? 0)}</strong>
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Compra descontada del saldo PIKAS.
          </p>
        )}
      </div>
      <div className="grid gap-1 border-t pt-3 text-sm text-slate-500">
        <p>
          Cliente:{" "}
          <strong className="text-[color:var(--foreground)]">
            {purchase.studentName} ·{" "}
            {purchase.studentCode ?? purchase.studentId ?? "Sin cuenta"}
          </strong>
        </p>
        <p>
          Cajero: {purchase.employeeLabel} · Caja: {purchase.posStationId}
        </p>
        <p>Ubicación: {purchase.locationId}</p>
      </div>
      {events.length ? (
        <div className="border-t pt-3">
          <h3 className="label">Transacciones relacionadas</h3>
          {events.map((event) => (
            <div
              className="mt-2 rounded-xl bg-emerald-50 p-3 text-emerald-950"
              key={event.id}
            >
              <p className="font-black">
                Venta original · Reembolsado {posMoney(event.amountMinor)}
              </p>
              <p className="break-all text-sm">
                Reembolso {event.id} · {event.reason}
              </p>
              <p className="text-sm">
                Procesado por {event.actorName}
                {event.approvedByName
                  ? ` · Aprobado por ${event.approvedByName}`
                  : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 pos-receipt-actions">
        <button className="btn" onClick={() => printReceipt("sale")}>
          {status === "Completada" ? "Imprimir recibo" : "Reimprimir recibo"}
        </button>
        {!allowed && remaining > 0 ? (
          <p className="pos-policy-notice">
            {state.posPolicy.requireApproval
              ? "Reembolso requiere administrador"
              : "Reembolsos no habilitados para cajeros"}
          </p>
        ) : null}
      </div>
      {allowed && remaining > 0 ? (
        <form
          className="pos-refund-entry card space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            setReview(true);
          }}
        >
          <h3 className="font-black">
            Reembolsar · Disponible {posMoney(remaining)}
          </h3>
          {state.posPolicy.requireApproval && !admin ? (
            <p>
              Requiere aprobación. El administrador debe entrar en su cuenta y
              procesar este ID en Transacciones.
            </p>
          ) : (
            <>
              {state.posPolicy.partialRefunds ? (
                <label className="block font-bold">
                  Monto del reembolso (RD$)
                  <input
                    className="field mt-2"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={String(remaining / 100)}
                  />
                </label>
              ) : (
                <p>Reembolso completo</p>
              )}
              <label className="block font-bold">
                Motivo
                <input
                  className="field mt-2"
                  required={state.posPolicy.requireReason}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                className="btn"
                disabled={
                  connection !== "Online" ||
                  (amount !== "" &&
                    (parseMoney(amount) === null || parseMoney(amount) === 0))
                }
              >
                Revisar reembolso
              </button>
            </>
          )}
        </form>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {review ? (
        <div
          className="pos-refund-review"
          role="dialog"
          aria-label="Revisar reembolso"
        >
          <h3 className="text-xl font-black">Revisar reembolso</h3>
          <p>
            Venta original: <span className="font-mono">{purchase.id}</span>
          </p>
          <p>Cliente: {purchase.studentName}</p>
          <p>
            Destino:{" "}
            <strong>
              {purchase.paymentMethod === "cash" ? "Efectivo" : "Saldo PIKAS"}
            </strong>
          </p>
          <p>
            Importe: <strong>{posMoney(refundAmount)}</strong>
          </p>
          <p>Motivo: {reason || "Sin motivo indicado"}</p>
          <div className="flex gap-2">
            <button
              className="btn"
              disabled={busy || refundAmount <= 0 || connection !== "Online"}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                const result = await refundPos(
                  purchase.id,
                  refundAmount,
                  reason,
                  key,
                );
                setNotice(result.ok ? "Reembolso completado." : result.message);
                if (result.ok) {
                  setRefundEventId(key);
                  setReview(false);
                  setAmount("");
                  setReason("");
                  setKey(crypto.randomUUID());
                }
                setBusy(false);
              }}
            >
              Confirmar reembolso
            </button>
            <button className="btn-secondary" onClick={() => setReview(false)}>
              Volver
            </button>
          </div>
        </div>
      ) : null}
      {refundEventId &&
      state.events.some((e) => e.idempotencyKey === refundEventId)
        ? (() => {
            const event = state.events.find(
              (e) => e.idempotencyKey === refundEventId,
            );
            return event ? (
              <div data-printable-receipt="refund">
                <RefundReceipt purchase={purchase} event={event} />
              </div>
            ) : null;
          })()
        : null}
    </section>
  );
}
export function PosHistory({ admin = false }: { admin?: boolean }) {
  const { state } = useDemo();
  const [query, setQuery] = useState(""),
    [day, setDay] = useState(""),
    [cashier, setCashier] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const purchases = state.purchases.filter(
    (p) =>
      p.organizationId === "cafeteria-demo" && p.locationId === "principal",
  );
  const rows = purchases.filter(
    (p) =>
      (!day || businessDay(p.createdAt) === day) &&
      (!cashier || p.cashierId === cashier) &&
      `${p.id} ${p.studentName} ${p.studentId} ${p.studentCode ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const purchase = purchases.find((p) => p.id === selected);
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-black">Historial POS</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          className="field"
          aria-label="Buscar transacción"
          placeholder="ID, nombre o código"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input
          className="field"
          aria-label="Fecha de transacción"
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
        <select
          className="field"
          aria-label="Cajero"
          value={cashier}
          onChange={(e) => setCashier(e.target.value)}
        >
          <option value="">Todos los cajeros</option>
          {[
            ...new Map(
              purchases.map((p) => [p.cashierId, p.employeeLabel]),
            ).entries(),
          ].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="card divide-y p-4">
        {rows.length ? (
          rows.map((p) => {
            const rowStatus = purchaseStatus(p, state.events);
            return (
              <button
                className="pos-history-row flex min-h-16 w-full flex-wrap justify-between gap-2 py-3 text-left"
                key={p.id}
                onClick={() => setSelected(p.id)}
              >
                <span className="min-w-0">
                  <strong className="block truncate">{p.studentName}</strong>
                  <span className="mt-1 block text-sm">
                    {p.studentAssociation === "general_sale"
                      ? "Cash — General sale"
                      : p.paymentMethod === "cash"
                        ? "Cash — Student-linked"
                        : "Cashless / PIKAS account"}
                  </span>
                  <small className="mt-1 block text-slate-500">
                    {new Date(p.createdAt).toLocaleString("es-DO")} ·{" "}
                    {p.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                  </small>
                  <small className="block font-mono text-slate-400">
                    {p.id}
                  </small>
                  <span
                    className={`pos-receipt-status pos-receipt-status-${rowStatus === "Completada" ? "complete" : rowStatus === "Reembolso parcial" ? "partial" : "refunded"}`}
                  >
                    {rowStatus}
                  </span>
                </span>
                <strong className="text-lg">{posMoney(p.totalMinor)}</strong>
              </button>
            );
          })
        ) : (
          <p>No hay transacciones para estos filtros.</p>
        )}
      </div>
      {purchase ? (
        <>
          <PurchaseDetail key={purchase.id} purchase={purchase} admin={admin} />
          <button className="btn-secondary" onClick={() => setSelected(null)}>
            Cerrar detalle
          </button>
        </>
      ) : null}
      <details className="card p-4">
        <summary className="cursor-pointer py-2 font-bold">
          Recargas, reembolsos y cancelaciones
        </summary>
        {state.events
          .filter(
            (e) =>
              e.organizationId === "cafeteria-demo" &&
              e.locationId === "principal" &&
              (!day || businessDay(e.createdAt) === day) &&
              (!cashier || e.actorId === cashier) &&
              `${e.id} ${e.originalPurchaseId ?? ""} ${state.students.find((s) => s.id === e.studentId)?.preferredName ?? ""}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          )
          .map((e) => (
            <p className="break-words border-t py-3" key={e.id}>
              {e.type === "refund"
                ? "Reembolso"
                : e.type === "void"
                  ? "Cancelación"
                  : "Recarga"}{" "}
              · {posMoney(e.amountMinor)} · {e.actorName} ·{" "}
              {new Date(e.createdAt).toLocaleString("es-DO")} · {e.id}
            </p>
          ))}
      </details>
    </section>
  );
}
