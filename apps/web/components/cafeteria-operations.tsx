'use client';
import { ReconciliationDifference } from './reconciliation-difference';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { closeResultSchema, historyRequestSchema, money, purchaseDetailSchema, purchaseSchema, sessionDetailSchema, sessionHistorySchema, type CloseRequest, type PurchaseDetail, type PurchaseHistory, type SessionDetail, type SessionHistory } from '../lib/cafeteria/operations';
import { parseCash } from '../lib/pos/contracts';
import { z } from 'zod';
const date = (s: string) => new Date(s).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });
const tender = (s: string) => ({ cash: 'Efectivo', student_wallet: 'PIKAS Cash', staff_credit: 'Crédito de personal' })[s] ?? s;
async function request(body: unknown) { const response = await fetch('/api/cafeteria/operations', { method: 'POST', headers: { 'Content-Type': 'application/json', ...((body as CloseRequest).request_key ? { 'Idempotency-Key': (body as CloseRequest).request_key } : {}) }, body: JSON.stringify(body) }); if (!response.ok) {
    const payload = await response.json();
    throw Object.assign(Error('No se pudo confirmar la operación con tus permisos actuales.'), { definite: payload.definite === true });
} return (await response.json()).result; }
function Sale({ sale, onSelect }: {
    sale: PurchaseHistory;
    onSelect: (id: string) => void;
}) { return <article className="rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><button className="font-bold underline" onClick={() => onSelect(sale.id)}>Recibo #{sale.receipt_number}</button><strong>{money(sale.total_minor, sale.currency)}</strong></div><p>{date(sale.purchased_at)} · {sale.register_name}</p><p>{sale.operator_name} · {sale.customer_name} · {tender(sale.tender)}</p><p className="break-all text-xs text-slate-500">{sale.id}</p></article>; }
function Summary({ session: s }: {
    session: SessionHistory;
}) {
    return <><dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[
            ['Caja', `${s.register_name} · ${s.register_code}`], ['Apertura', `${date(s.opened_at)} · ${s.operator_name}`], ['Estado', s.status === 'open' ? 'Abierta' : 'Cerrada'], ['Fondo inicial', money(s.summary.opening_minor, s.currency)], ['Ventas en efectivo', money(s.summary.cash_sales_minor, s.currency)], ['Cobros de cuentas de personal', money(s.summary.cash_settlements_minor, s.currency)], ['Reembolsos en efectivo', money(s.summary.cash_refunds_minor, s.currency)], ['Efectivo esperado', money(s.summary.expected_minor, s.currency)], ['Ventas', String(s.summary.purchase_count)], ['Efectivo contado', s.counted_minor === null ? 'Pendiente' : money(s.counted_minor, s.currency)], ['Conciliación', <ReconciliationDifference key="difference" minor={s.difference_minor} />], ['Cierre', s.closed_at ? `${date(s.closed_at)} · ${s.closed_by}` : 'Pendiente'],
        ].map(([label, value]) => <div key={String(label)} className="min-w-0"><dt className="text-sm text-slate-500">{label}</dt><dd className="break-words font-bold">{value}</dd></div>)}</dl><p className="mt-3 break-all text-xs">Sesión: {s.id}</p>{s.reason && <p>Motivo: {({operator_unavailable:'Operador no disponible',operator_suspended:'Operador suspendido',auth_access_lost:'Acceso perdido',administrative_recovery:'Recuperación administrativa',other:'Otro'} as Record<string,string>)[s.reason] ?? s.reason}{s.note ? ` · ${s.note}` : ''}</p>}{s.status === 'closed' && !s.close_snapshot && <p className="mt-3 text-sm">Cierre histórico: esperado derivado de movimientos históricos; sin captura de conciliación al cierre.</p>}</>;
}
function CloseSession({ session, cafeteriaId, actorId, onClosed }: {
    session: SessionHistory;
    cafeteriaId: string;
    actorId: string;
    onClosed: (confirmed: boolean) => void;
}) {
    const router = useRouter();
    const key = `pikas:register-close:${actorId}:${cafeteriaId}`;
    const [counted, setCounted] = useState(''), [reason, setReason] = useState<CloseRequest['reason']>('administrative_recovery'), [note, setNote] = useState(''), [review, setReview] = useState(false), [pending, setPending] = useState<CloseRequest | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const lock = useRef(false);
    useEffect(() => { queueMicrotask(() => { try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
            const stored = historyRequestSchema.parse(JSON.parse(raw));
            if (stored.operation !== 'close' || stored.cafeteria_id !== cafeteriaId)
                throw Error();
            setPending(stored);
        }
        setReady(true);
    }
    catch {
        setMessage('No se puede recuperar la solicitud. El cierre está bloqueado.');
    } }); }, [key, cafeteriaId]);
    const submit = async () => { if (lock.current || !ready)
        return; lock.current = true; setBusy(true); try {
        const amount = parseCash(counted);
        if (!pending && amount === null)
            throw Error('Ingresa un conteo válido.');
        const body = pending ?? historyRequestSchema.parse({ operation: 'close', cafeteria_id: cafeteriaId, session_id: session.id, version: session.version, counted_minor: amount, expected_minor: session.summary.expected_minor, reason, note, request_key: crypto.randomUUID() }) as CloseRequest;
        sessionStorage.setItem(key, JSON.stringify(body));
        setPending(body);
        const result = closeResultSchema.parse(await request(body));
        if (result.request_key !== body.request_key || result.session.id !== body.session_id || result.session.status !== 'closed')
            throw Error();
        sessionStorage.removeItem(key);
        setPending(null);
        setReview(false);
        setMessage('');
        router.refresh();
        onClosed(true);
    }
    catch (error) {
        if (!pending && error instanceof Error && 'definite' in error && error.definite) {
            sessionStorage.removeItem(key);
            setPending(null);
            setReview(false);
            onClosed(false);
        }
        setMessage(error instanceof Error ? `${error.message} Conservamos la misma solicitud si quedó pendiente; recupera el acceso y reintenta.` : 'Cierre sin confirmar.');
    }
    finally {
        lock.current = false;
        setBusy(false);
    } };
    if (!pending && (session.status === 'closed' || session.operator_id === actorId))
        return message ? <p role="status">{message}</p> : null;
    return <section className="mt-5 space-y-3 rounded-xl border border-amber-300 p-4"><h3 className="text-lg font-black">Cierre administrativo excepcional</h3><p>Recuperación de una sesión de otro operador. El cierre es permanente; conserva ventas y atribución originales.</p>{pending ? <><p role="alert">Hay un cierre sin confirmar para la sesión {pending.session_id}. No cambies su clave ni datos.</p><button className="btn" disabled={!ready || busy} onClick={() => void submit()}>{busy ? 'Confirmando…' : 'Recuperar mismo cierre'}</button></> : <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (review)
        void submit();
    else
        setReview(true); }}><fieldset disabled={!ready || busy || review} className="space-y-3"><label className="block font-bold">Efectivo contado<input required className="field mt-1" inputMode="decimal" value={counted} onChange={e => setCounted(e.target.value)}/></label><label className="block font-bold">Motivo<select className="field mt-1" value={reason} onChange={e => setReason(e.target.value as CloseRequest['reason'])}><option value="administrative_recovery">Recuperación administrativa</option><option value="operator_unavailable">Operador no disponible</option><option value="operator_suspended">Operador suspendido</option><option value="auth_access_lost">Acceso perdido</option><option value="other">Otro</option></select></label><label className="block font-bold">Nota<textarea className="field mt-1" maxLength={1000} required={reason === 'other'} value={note} onChange={e => setNote(e.target.value)}/></label></fieldset>{review && <div role="status"><p>Esperado actual: {money(session.summary.expected_minor, session.currency)}. Contado: {parseCash(counted) === null ? 'Inválido' : money(parseCash(counted)!, session.currency)}.</p><p>Si cambia el esperado antes de confirmar, el cierre se rechaza y debes revisar el conteo actualizado.</p><p>¿Confirmas el cierre permanente de esta sesión?</p></div>}<div className="flex flex-wrap gap-3"><button className="btn" disabled={!ready || busy || parseCash(counted) === null}>{busy ? 'Confirmando…' : review ? 'Confirmar cierre permanente' : 'Revisar cierre'}</button>{review && <button type="button" className="btn-secondary" onClick={() => setReview(false)}>Volver al conteo</button>}</div></form>}{message && <p role="status">{message}</p>}</section>;
}
export function CafeteriaOperations({ cafeteriaId, actorId, kind, sandbox }: {
    cafeteriaId: string;
    actorId: string;
    kind: 'transactions' | 'sessions';
    sandbox: boolean;
}) {
    const [offset, setOffset] = useState(0), [rows, setRows] = useState<(PurchaseHistory | SessionHistory)[]>([]), [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<PurchaseDetail | SessionDetail | null>(null), [sale, setSale] = useState<PurchaseDetail | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0), [activityOffset, setActivityOffset] = useState(0);
    useEffect(() => { let live = true; queueMicrotask(() => { setLoading(true); setError(''); }); if (sandbox) {
        queueMicrotask(() => setLoading(false));
        return;
    } void request({ operation: 'read', cafeteria_id: cafeteriaId, kind, offset, target_id: null }).then(r => { if (live)
        setRows(kind === 'transactions' ? z.array(purchaseSchema).parse(r.data) : z.array(sessionHistorySchema).parse(r.data)); }).catch(() => { if (live)
        setError('No se pudo cargar el historial con tus permisos actuales.'); }).finally(() => { if (live)
        setLoading(false); }); return () => { live = false; }; }, [cafeteriaId, kind, offset, revision, sandbox]);
    useEffect(() => { let live = true; queueMicrotask(() => { setDetail(null); setSale(null); }); if (!selected || sandbox)
        return; void request({ operation: 'read', cafeteria_id: cafeteriaId, kind: kind === 'transactions' ? 'transaction' : 'session', offset: activityOffset, target_id: selected }).then(r => { if (live)
        setDetail(kind === 'transactions' ? purchaseDetailSchema.parse(r.data) : sessionDetailSchema.parse(r.data)); }).catch(() => { if (live)
        setError('No se pudo cargar el detalle.'); }); return () => { live = false; }; }, [selected, cafeteriaId, kind, revision, activityOffset, sandbox]);
    const loadSale = async (id: string) => { try {
        const r = await request({ operation: 'read', cafeteria_id: cafeteriaId, kind: 'transaction', offset: 0, target_id: id });
        setSale(purchaseDetailSchema.parse(r.data));
    }
    catch {
        setError('No se pudo cargar la transacción.');
    } };
    const receipt = sale ?? (detail && 'items' in detail ? detail : null);
    const Heading = kind === 'transactions' ? 'h1' : 'h2';
    return <section className="mt-5 space-y-4"><header className="flex flex-wrap justify-between gap-3"><Heading className="text-2xl font-black">{kind === 'transactions' ? 'Transacciones' : 'Historial de caja'}</Heading><button className="btn-secondary" onClick={() => setRevision(r => r + 1)}>Actualizar historial</button></header><p className="text-sm">Horas de Santo Domingo. Operaciones confirmadas; PIKAS Cash no aumenta el efectivo físico.</p>{sandbox ? <p className="card p-4" role="status">El POV sandbox administrativo no concede acceso a operaciones financieras. Esta frontera de autoridad se conserva.</p> : <>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{loading ? <p role="status">Cargando historial…</p> : <>{!rows.length && !error && <p className="card p-4">Todavía no hay {kind === 'transactions' ? 'transacciones' : 'sesiones'}.</p>}<div className="space-y-3">{rows.slice(0, 25).map(row => 'receipt_number' in row ? <Sale key={row.id} sale={row} onSelect={id => { setActivityOffset(0); setSelected(id); }}/> : <article className="card space-y-2 p-4" key={row.id}><button className="font-bold underline" onClick={() => { setActivityOffset(0); setSelected(row.id); }}>{row.register_name} · {row.status === 'open' ? 'Abierta' : 'Cerrada'}</button><p>{date(row.opened_at)} · {row.operator_name}</p><p>Esperado {money(row.summary.expected_minor, row.currency)} · Contado {row.counted_minor === null ? 'Pendiente' : money(row.counted_minor, row.currency)} · <ReconciliationDifference minor={row.difference_minor} /></p><p className="break-all text-xs">{row.id}</p></article>)}</div><div className="flex gap-3"><button className="btn-secondary" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - 25)); setSelected(null); }}>Anterior</button><button className="btn-secondary" disabled={rows.length <= 25} onClick={() => { setOffset(offset + 25); setSelected(null); }}>Siguiente</button></div></>}{selected && !detail && <p role="status">Cargando detalle…</p>}{detail && <section className="card space-y-4 p-4 sm:p-6"><div className="flex justify-between gap-3"><h3 className="text-xl font-black">Detalle {kind === 'sessions' ? 'de sesión' : 'de transacción'}</h3><button className="btn-secondary" onClick={() => setSelected(null)}>Cerrar detalle</button></div>{'summary' in detail && <><Summary session={detail}/><CloseSession key={detail.id} session={detail} cafeteriaId={cafeteriaId} actorId={actorId} onClosed={confirmed => {setNotice(confirmed ? 'Cierre permanente confirmado.' : 'El cierre no se realizó. Revisa el estado y el esperado actualizados.'); setRevision(r => r + 1);}}/><h3 className="font-bold">Ventas de la sesión</h3>{detail.purchases.slice(0, 25).map(p => <Sale key={p.id} sale={p} onSelect={id => void loadSale(id)}/>)}{!detail.purchases.length && <p>Sin ventas.</p>}<div className="flex gap-3"><button className="btn-secondary" disabled={!activityOffset} onClick={() => setActivityOffset(Math.max(0, activityOffset - 25))}>Ventas anteriores</button><button className="btn-secondary" disabled={detail.purchases.length <= 25} onClick={() => setActivityOffset(activityOffset + 25)}>Más ventas</button></div>{detail.cash_movements.map(m => <p className="break-words" key={m.id}>{m.kind === 'refund' ? 'Reembolso' : 'Cobro de cuenta'} · {date(m.occurred_at)} · {money(m.amount_minor, detail.currency)} · {m.id}</p>)}</>}</section>}{receipt && <section className="card space-y-3 p-4"><h3 className="text-xl font-black">Recibo #{receipt.receipt_number}</h3><p>{date(receipt.purchased_at)} · {receipt.customer_name} · {receipt.operator_name}</p><p>{receipt.register_name} · {tender(receipt.tender)}</p><p className="break-all text-xs">Compra {receipt.id} · Sesión {receipt.session_id}</p>{receipt.items.map((item, i) => <p key={i}>{item.quantity} × {item.name} · {money(item.unit_price_minor, receipt.currency)} = {money(item.line_total_minor, receipt.currency)}</p>)}<strong>Total {money(receipt.total_minor, receipt.currency)}</strong>{receipt.cash_received_minor !== null && <p>Recibido {money(receipt.cash_received_minor, receipt.currency)} · Cambio {money(receipt.change_minor!, receipt.currency)}</p>}{receipt.receipt && <p>Recibo original conservado · {String(receipt.receipt.cafeteria_name ?? '')} · {String(receipt.receipt.school_name ?? '')}</p>}</section>}</>}</section>;
}
