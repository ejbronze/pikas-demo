"use client";

import { useEffect, useState } from "react";
import { sessionFetch } from "../lib/auth/session-fetch";
import { formatMinor } from "../lib/pos/contracts";
import { approvalResultSchema, overrideLabels, overrideReasonSchema, refundabilitySchema, refundReasons, refundRequestSchema,
  refundResultSchema, type Refundability, type RefundRequest, type RefundResult } from "../lib/pos/refunds";

type Override = keyof typeof overrideLabels;
const rejectionText: Record<string, string> = {
  REFUND_EXCEEDS_REMAINING: "La cantidad supera lo que queda por reembolsar. Actualiza el recibo.",
  CASH_INSUFFICIENT: "No hay suficiente efectivo esperado en esta caja para entregar el reembolso.",
  SESSION_CLOSED: "La caja actual no está abierta. Abre una caja antes de reembolsar en efectivo.",
  APPROVAL_INVALID: "La autorización no coincide con este reembolso. Solicítala de nuevo.",
  APPROVAL_EXPIRED: "La autorización venció. Solicítala de nuevo.", APPROVAL_ALREADY_USED: "La autorización ya se usó.",
  REFUND_ITEMS_UNAVAILABLE: "Esta compra tiene reembolsos anteriores por monto; no admite reembolso por artículo.",
  NOT_REFUNDABLE: "Esta compra no admite reembolso.", IDEMPOTENCY_CONFLICT: "Ya existe un reembolso distinto con esta solicitud.",
};
const tenderLabel = (t: string) => t === "cash" ? "Efectivo" : t === "student_wallet" ? "PIKAS Cash" : "No reembolsable";
const minutes = (s: string) => `${Math.floor(Number(s) / 60)} min ${Number(s) % 60} s`;

async function post(body: object, key?: string, path = "/api/pos") {
  const response = await sessionFetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
  let payload: Record<string, unknown> = {};
  try { payload = await response.json(); } catch { /* treated as uncertain */ }
  return { status: response.status, payload };
}

export function PosRefunds({ actorId, currency }: { actorId: string; currency: string }) {
  const journalKey = `pikas:pos-refund:${actorId}`;
  const money = (n: string | bigint) => formatMinor(n, currency);
  const [number, setNumber] = useState("");
  const [purchase, setPurchase] = useState<Refundability | null>(null);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [overrides, setOverrides] = useState<Override[] | null>(null);
  const [issuanceKey, setIssuanceKey] = useState("");
  const [approverEmail, setApproverEmail] = useState("");
  const [approverPassword, setApproverPassword] = useState("");
  const [pending, setPending] = useState<RefundRequest | null>(null);
  const [result, setResult] = useState<RefundResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { queueMicrotask(() => { try { const raw = sessionStorage.getItem(journalKey); if (raw) setPending(refundRequestSchema.parse(JSON.parse(raw))); } catch { setMessage("No se puede recuperar el reembolso pendiente. No inicies otro hasta confirmar su resultado."); } }); }, [journalKey]);

  const lookup = async (value = number) => {
    setBusy(true); setMessage("");
    try {
      const { status, payload } = await post({ operation: "refund_lookup", purchase_number: value.trim() });
      const parsed = refundabilitySchema.safeParse(payload.result);
      if (status !== 200 || !parsed.success) { setPurchase(null); setMessage(status === 409 ? "No se encontró ese recibo en esta cafetería." : "No se pudo consultar el recibo con tus permisos actuales."); return; }
      setPurchase(parsed.data);
    } finally { setBusy(false); }
  };
  const remainingOf = (i: Refundability["items"][number]) => i.quantity - i.refunded_quantity;
  const selected = purchase?.items.filter((i) => (qty[i.purchase_item_id] ?? 0) > 0) ?? [];
  const amount = selected.reduce((sum, i) => sum + BigInt(i.unit_price_minor) * BigInt(qty[i.purchase_item_id]), 0n);
  const reasonReady = reason !== "" && (reason !== "other" || notes.trim().length >= 3);

  const submit = async (request: RefundRequest) => {
    setBusy(true); setMessage("");
    try { sessionStorage.setItem(journalKey, JSON.stringify(request)); } catch { setBusy(false); setMessage("No se pudo preparar el reembolso. No se envió."); return; }
    setPending(request);
    try {
      const { status, payload } = await post({ operation: "refund", request }, request.request_key);
      const parsed = refundResultSchema.safeParse(payload.result);
      if (status === 200 && parsed.success && parsed.data.purchase_id === request.purchase_id) {
        sessionStorage.removeItem(journalKey); setPending(null); setResult(parsed.data); setOverrides(null); setOpen(false);
        if (purchase) await lookup(purchase.purchase_number);
        return;
      }
      if (payload.definite === true) {
        sessionStorage.removeItem(journalKey); setPending(null);
        if (payload.error === "REFUND_APPROVAL_REQUIRED") {
          setOverrides((Array.isArray(payload.override_reasons) ? payload.override_reasons : []).filter((r): r is Override => overrideReasonSchema.safeParse(r).success));
          setIssuanceKey(crypto.randomUUID()); return;
        }
        setMessage(rejectionText[String(payload.error)] ?? "No se realizó el reembolso. Revisa los datos y tus permisos."); return;
      }
      setMessage("Resultado pendiente de confirmar. Reintenta el mismo reembolso; no inicies otro.");
    } catch { setMessage("Resultado pendiente de confirmar. Reintenta el mismo reembolso; no inicies otro."); }
    finally { setBusy(false); }
  };
  const base = (): Omit<RefundRequest, "request_key" | "approval_id"> | null => purchase && selected.length && reasonReady ? {
    purchase_id: purchase.purchase_id, items: selected.map((i) => ({ purchase_item_id: i.purchase_item_id, quantity: qty[i.purchase_item_id] })),
    reason: reason as RefundRequest["reason"], notes: notes.trim() } : null;
  const authorize = async () => {
    const request = base(); if (!request || busy) return;
    setBusy(true); setMessage("");
    const password = approverPassword; setApproverPassword("");
    try {
      const { status, payload } = await post({ ...request, issuance_key: issuanceKey, approver_email: approverEmail.trim(), approver_password: password }, issuanceKey, "/api/pos/refund-approval");
      const parsed = approvalResultSchema.safeParse(payload.result);
      if (status !== 200 || !parsed.success) {
        setBusy(false);
        setMessage(status === 401 ? "Credenciales de autorización incorrectas." : status === 403 ? "Esa persona no puede autorizar reembolsos en esta cafetería." : "No se pudo obtener la autorización. Inténtalo de nuevo.");
        return;
      }
      setBusy(false);
      await submit({ ...request, request_key: crypto.randomUUID(), approval_id: parsed.data.approval_id });
    } catch { setBusy(false); setMessage("No se pudo obtener la autorización. Inténtalo de nuevo."); }
  };

  return <section className="card mx-auto max-w-3xl space-y-4 p-6" aria-label="Reembolsos">
    <h1 className="text-3xl font-black">Reembolsos</h1>
    <p className="text-sm">Busca el recibo. El efectivo sale de esta caja; PIKAS Cash vuelve al monedero del estudiante. El recibo original no cambia.</p>
    {pending ? <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-4"><p>Hay un reembolso pendiente de confirmar. Reintentar conserva la misma solicitud.</p><button className="btn" disabled={busy} onClick={() => void submit(pending)}>Reintentar mismo reembolso</button></div> : null}
    <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
      <input className="field min-w-0 flex-1" aria-label="Número de recibo" inputMode="numeric" placeholder="Número de recibo" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))} />
      <button className="btn-secondary" disabled={busy || !number || Boolean(pending)}>Buscar recibo</button>
    </form>
    {message && !open ? <p role="status">{message}</p> : null}
    {result ? <p role="status" className="rounded-xl bg-emerald-50 p-4 font-bold">Reembolso #{result.refund_ordinal} confirmado · {money(result.amount_minor)} · {tenderLabel(result.tender_type)}{result.approver_role ? " · autorizado" : ""}. Pendiente en el recibo: {money(result.remaining_after_minor)}.</p> : null}
    {purchase ? <article className="space-y-3 border-t pt-4" aria-label="Estado del recibo">
      <h2 className="text-xl font-black">Recibo #{purchase.purchase_number} · {purchase.customer_name}</h2>
      <p>{tenderLabel(purchase.tender_type)} · Total {money(purchase.total_minor)} · Reembolsado {money(purchase.refunded_minor)} · <strong>Disponible {money(purchase.remaining_minor)}</strong></p>
      <p className="text-sm text-slate-600">Venta hace {minutes(purchase.sale_age_seconds)}{purchase.actor_role === "pos_cashier" ? ` · Hoy: ${purchase.cashier_used_count}/${purchase.cashier_count_limit} reembolsos, ${money(purchase.cashier_used_amount_minor)} de ${money(purchase.cashier_amount_limit_minor)}` : ""}</p>
      <ul className="divide-y">{purchase.items.map((i) => <li key={i.purchase_item_id} className="flex flex-wrap justify-between gap-2 py-2"><span>{i.quantity} × {i.name}</span><span>{i.refunded_quantity ? `${i.refunded_quantity} reembolsado(s) · ` : ""}{remainingOf(i)} disponible(s)</span></li>)}</ul>
      {purchase.refunds.length ? <p className="text-sm">Reembolsos anteriores: {purchase.refunds.map((r) => `#${r.refund_ordinal} ${money(r.amount_minor)}`).join(" · ")}</p> : null}
      <button className="btn" disabled={busy || Boolean(pending) || !purchase.itemizable || purchase.remaining_minor === "0"} onClick={() => { setQty({}); setReason(""); setNotes(""); setOverrides(null); setResult(null); setMessage(""); setOpen(true); }}>Reembolsar</button>
      {!purchase.itemizable ? <p className="text-sm">{purchase.tender_type === "cash" || purchase.tender_type === "student_wallet" ? rejectionText.REFUND_ITEMS_UNAVAILABLE : rejectionText.NOT_REFUNDABLE}</p> : null}
    </article> : null}
    {open && purchase ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="refund-title" className="max-h-[92vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <h2 id="refund-title" className="text-2xl font-black">Reembolso · Recibo #{purchase.purchase_number}</h2>
        {overrides === null ? <>
          <fieldset className="space-y-2" disabled={busy}><legend className="font-bold">Artículos a reembolsar</legend>
            {purchase.items.map((i) => remainingOf(i) > 0 ? <label key={i.purchase_item_id} className="flex flex-wrap items-center justify-between gap-2"><span>{i.name} · {money(i.unit_price_minor)} c/u</span>
              <input type="number" min={0} max={remainingOf(i)} className="field w-24" aria-label={`Cantidad a reembolsar de ${i.name}`} value={qty[i.purchase_item_id] ?? 0}
                onChange={(e) => setQty({ ...qty, [i.purchase_item_id]: Math.max(0, Math.min(remainingOf(i), Math.trunc(Number(e.target.value) || 0))) })} /></label> : null)}
          </fieldset>
          <label className="block font-bold">Motivo<select className="field mt-1 w-full" aria-label="Motivo del reembolso" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}><option value="">Selecciona un motivo</option>{refundReasons.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          {reason === "other" ? <label className="block font-bold">Explica el motivo<textarea className="field mt-1 w-full" aria-label="Explica el motivo" maxLength={500} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} /></label> : null}
          <p className="rounded-xl bg-slate-100 p-3 font-bold" role="status">{amount > 0n ? (purchase.tender_type === "cash" ? `Entrega ${money(amount)} en efectivo desde esta caja.` : `Se devolverán ${money(amount)} al PIKAS Cash de ${purchase.customer_name}.`) : "Selecciona al menos un artículo."}</p>
          <div className="flex flex-wrap gap-3"><button className="btn" disabled={busy || !base()} onClick={() => { const request = base(); if (request) void submit({ ...request, request_key: crypto.randomUUID(), approval_id: null }); }}>{busy ? "Confirmando…" : `Confirmar reembolso de ${money(amount)}`}</button><button className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button></div>
        </> : <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void authorize(); }}>
          <p className="font-bold">Este reembolso de {money(amount)} requiere autorización:</p>
          <ul className="list-disc pl-5">{overrides.map((r) => <li key={r}>{overrideLabels[r]}</li>)}</ul>
          <p className="text-sm">Un supervisor POS o administrador de cafetería ingresa sus credenciales aquí. Tu sesión de cajero continúa y quedas registrado como quien inicia el reembolso.</p>
          <label className="block">Correo de quien autoriza<input className="field mt-1 w-full" aria-label="Correo de quien autoriza" type="email" autoComplete="off" value={approverEmail} disabled={busy} onChange={(e) => setApproverEmail(e.target.value)} /></label>
          <label className="block">Contraseña de quien autoriza<input className="field mt-1 w-full" aria-label="Contraseña de quien autoriza" type="password" autoComplete="off" value={approverPassword} disabled={busy} onChange={(e) => setApproverPassword(e.target.value)} /></label>
          <div className="flex flex-wrap gap-3"><button className="btn" disabled={busy || !approverEmail || approverPassword.length < 4}>{busy ? "Autorizando…" : "Autorizar y reembolsar"}</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => { setOverrides(null); setApproverPassword(""); }}>Volver</button></div>
        </form>}
        {message ? <p role="alert">{message}</p> : null}
      </div>
    </div> : null}
  </section>;
}
